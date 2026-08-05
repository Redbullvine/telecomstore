import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXPECTED_PROJECT_REF,
  AUTH_ENV_NAME,
  AUTH_ENV_VALUE,
  CONFIRMATION_PHRASE,
  evaluateAuthorization,
  validateApprovedSource,
  checkProductionHost,
  checkSnapshotDir,
  planReconciliation,
  resolveConfirmation,
  redact,
} from "../scripts/lib/production-gate.mjs";
import { runGuardedProduction } from "../scripts/import-petra-production.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

// --- sanitized fake approved records (BAINTU final-package shape) ------------
function approvedRecords() {
  return [
    {
      source_row: 11, public_sku: "FT-100TOOL", manufacturer_mpn: "FT-100TOOL", brand: "Ideal",
      title: "Impact Punch Down Tool 110/66", short_description: "Impact Punch Down Tool 110/66",
      category: "Telecom Tools", gtin: "000012345014", price_mode: "request_quote", public_price: null,
      image_rights_status: "pending", publish_supplier_image: false, opening_approved: true,
      _private_supplier_sku: "FKTFT100TOOL", _private_raw_supplier_title: "IMPACT PUNCH DOWN TL",
      _private_raw_supplier_description: "Impact punch down tool for 110 and 66 blocks.",
    },
    {
      source_row: 12, public_sku: "N201-BL", manufacturer_mpn: "N201-BL", brand: "Tripp Lite by Eaton",
      title: "Cat6 Patch Cable 10ft Blue", short_description: "Cat6 Patch Cable 10ft Blue",
      category: "Network Cabling & Connectors", gtin: "000098765027", price_mode: "request_quote", public_price: null,
      image_rights_status: "pending", publish_supplier_image: false, opening_approved: true,
      _private_supplier_sku: "TRPN201BL", _private_raw_supplier_title: "CAT6 PATCH CBL 10FT BLU",
      _private_raw_supplier_description: "Snagless molded Cat6 RJ45 ethernet patch cable.",
    },
  ];
}

function writeSource(records, name = "approved.json") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prod-gate-"));
  const p = path.join(dir, name);
  fs.writeFileSync(p, JSON.stringify(records, null, 2));
  return { dir, p };
}

// Existing live products (the four curated 3M items, sanitized).
const LIVE = [
  { id: "live-1", sku: "80-6110-4831-7", manufacturer_mpn: null, gtin: null, brand: "3M", title: "TC1 Straight Half-Tap Module", category: "Copper Splicing", price: null, status: "quote" },
  { id: "live-2", sku: "80-6110-4831-8", manufacturer_mpn: null, gtin: null, brand: "3M", title: "SD1 Dry Straight Half-Tap Module", category: "Copper Splicing", price: null, status: "quote" },
];

// --- fake DB -----------------------------------------------------------------
function makeFakeDb({ existing = LIVE, failOn = null } = {}) {
  const queries = [];
  let ids = 0;
  const client = {
    connectCalls: 0,
    async connect() { client.connectCalls++; },
    async end() {},
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (failOn && failOn.test(sql)) throw new Error("injected failure supplier_cost=999 postgresql://user:pw@db.x.supabase.co/x");
      const s = sql.trim().toLowerCase();
      if (/^(begin|commit|rollback)/.test(s)) return { rows: [] };
      if (s.startsWith("select id, sku")) return { rows: existing };
      if (s.includes("count(*)")) return { rows: [{ n: existing.length }] };
      if (s.startsWith("select id from public.suppliers")) return { rows: [{ id: "sup-1" }] };
      if (/^insert into public\.(suppliers|supplier_catalog_runs|supplier_products|products)/.test(s)) return { rows: [{ id: `id-${++ids}` }] };
      return { rows: [] };
    },
  };
  return { client, queries };
}

function baseOpts(overrides = {}) {
  const { p } = writeSource(approvedRecords());
  const { client, queries } = makeFakeDb(overrides.db || {});
  return {
    queries,
    opts: {
      argv: ["--dry-run", "--source", p, "--project-ref", EXPECTED_PROJECT_REF,
             "--db-url", `postgresql://postgres:x@db.${EXPECTED_PROJECT_REF}.supabase.co:5432/postgres`],
      env: { [AUTH_ENV_NAME]: AUTH_ENV_VALUE },
      stdinIsTTY: false,
      clientFactory: () => client,
      log: () => {},
      repoRoot: path.join(here, ".."),
      ...overrides.opts,
    },
  };
}

// ============================================================================
// Gate refusals (no connection may occur when a gate fails)
// ============================================================================
test("production mode is disabled by default (no mode flag)", async () => {
  let factoryCalled = false;
  const r = await runGuardedProduction({ argv: [], env: {}, clientFactory: () => { factoryCalled = true; } });
  assert.equal(r.ok, false);
  assert.equal(r.stage, "mode");
  assert.equal(factoryCalled, false, "no DB client may be created");
});

test("wrong environment authorization is rejected before any connection", async () => {
  let factoryCalled = false;
  const { p } = writeSource(approvedRecords());
  const r = await runGuardedProduction({
    argv: ["--apply-production", "--source", p, "--project-ref", EXPECTED_PROJECT_REF],
    env: { [AUTH_ENV_NAME]: "yes please" },
    clientFactory: () => { factoryCalled = true; },
  });
  assert.equal(r.stage, "authorization");
  assert.match(r.reason, /env_authorization/);
  assert.equal(factoryCalled, false);
});

test("wrong project reference is rejected", async () => {
  const { p } = writeSource(approvedRecords());
  const r = await runGuardedProduction({
    argv: ["--apply-production", "--source", p, "--project-ref", "someotherproject12345"],
    env: { [AUTH_ENV_NAME]: AUTH_ENV_VALUE },
    clientFactory: () => {},
  });
  assert.equal(r.stage, "authorization");
  assert.match(r.reason, /project_ref_mismatch/);
});

test("apply-production refuses to run in CI", async () => {
  const { p } = writeSource(approvedRecords());
  const r = await runGuardedProduction({
    argv: ["--apply-production", "--source", p, "--project-ref", EXPECTED_PROJECT_REF],
    env: { [AUTH_ENV_NAME]: AUTH_ENV_VALUE, CI: "true" },
    clientFactory: () => {},
  });
  assert.equal(r.stage, "ci_guard");
});

test("a non-production DB host is rejected even with full authorization", async () => {
  assert.equal(checkProductionHost(`postgresql://u:p@db.${EXPECTED_PROJECT_REF}.supabase.co:5432/postgres`, EXPECTED_PROJECT_REF).ok, true);
  assert.equal(checkProductionHost("postgresql://u:p@db.wrongref.supabase.co:5432/postgres", EXPECTED_PROJECT_REF).ok, false);
  assert.equal(checkProductionHost("postgresql://u:p@127.0.0.1:55322/postgres", EXPECTED_PROJECT_REF).ok, false);
  assert.equal(checkProductionHost("", EXPECTED_PROJECT_REF).ok, false);
});

// ============================================================================
// Source validation gates
// ============================================================================
test("an unapproved record is rejected", () => {
  const recs = approvedRecords();
  recs[0].opening_approved = false;
  const v = validateApprovedSource(recs);
  assert.equal(v.ok, false);
  assert.ok(v.failures.some((f) => f.includes("opening_approved_not_true")));
});

test("a non-null public price is rejected", () => {
  const recs = approvedRecords();
  recs[1].public_price = 19.99;
  const v = validateApprovedSource(recs);
  assert.ok(v.failures.some((f) => f.includes("public_price_not_null")));
});

test("an image-publication request is rejected", () => {
  const recs = approvedRecords();
  recs[0].publish_supplier_image = true;
  const v = validateApprovedSource(recs);
  assert.ok(v.failures.some((f) => f.includes("publish_supplier_image_not_false")));
});

test("a supplier-cost field anywhere in the source is rejected", () => {
  const recs = approvedRecords();
  recs[0]._private_supplier_cost = 9.51;
  const v = validateApprovedSource(recs);
  assert.ok(v.failures.some((f) => f.includes("forbidden_key")));
  // also when nested
  const recs2 = approvedRecords();
  recs2[1].meta = { pricing: { msrp: 29.99 } };
  assert.equal(validateApprovedSource(recs2).ok, false);
});

test("supplier fields outside an explicit _private prefix are rejected", () => {
  const recs = approvedRecords();
  recs[0].supplier_sku = "LEAKED";
  const v = validateApprovedSource(recs);
  assert.ok(v.failures.some((f) => f.includes("supplier_field_not_private")));
});

test("duplicate public SKUs within the source are rejected", () => {
  const recs = [...approvedRecords(), approvedRecords()[0]];
  const v = validateApprovedSource(recs);
  assert.ok(v.failures.some((f) => f.includes("duplicate_public_sku")));
});

test("a JWT-like value anywhere in the source is rejected", () => {
  const recs = approvedRecords();
  recs[0].note = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0";
  assert.equal(validateApprovedSource(recs).ok, false);
});

// ============================================================================
// Reconciliation: existing-product protection
// ============================================================================
test("existing live products absent from the source are never planned for change", () => {
  const plan = planReconciliation(approvedRecords(), LIVE);
  assert.equal(plan.conflicts.length, 0);
  assert.equal(plan.inserts.length, 2);
  assert.equal(plan.updates.length + plan.unchanged.length, 0);
  const touchedIds = [...plan.updates, ...plan.unchanged].map((u) => u.productId);
  for (const live of LIVE) assert.ok(!touchedIds.includes(live.id));
});

test("a duplicate public SKU with different identity stops the import", () => {
  const existing = [...LIVE, { id: "x-1", sku: "FT-100TOOL", manufacturer_mpn: "DIFFERENT-MPN", gtin: null, brand: "Other", title: "Other", category: "Other", price: null, status: "available" }];
  const plan = planReconciliation(approvedRecords(), existing);
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0].reason, "sku_identity_conflict");
});

test("a GTIN owned by another product stops the import", () => {
  const existing = [...LIVE, { id: "x-2", sku: "OTHER-SKU", manufacturer_mpn: "OTHER", gtin: "000012345014", brand: "Other", title: "Other", category: "Other", price: null, status: "available" }];
  const plan = planReconciliation(approvedRecords(), existing);
  assert.ok(plan.conflicts.some((c) => c.reason === "gtin_belongs_to_other_product"));
});

test("a matching-identity rerun is idempotent (planned as unchanged)", () => {
  const recs = approvedRecords();
  const existing = recs.map((r, i) => ({ id: `p-${i}`, sku: r.public_sku, manufacturer_mpn: r.manufacturer_mpn, gtin: r.gtin, brand: r.brand, title: r.title, category: r.category, price: null, status: "available" }));
  const plan = planReconciliation(recs, existing);
  assert.equal(plan.inserts.length, 0);
  assert.equal(plan.conflicts.length, 0);
  assert.equal(plan.unchanged.length, recs.length);
});

// ============================================================================
// Flow-level behavior with a fake client (no real DB anywhere)
// ============================================================================
test("dry-run performs reads only: no BEGIN, no INSERT, no UPDATE", async () => {
  const { opts, queries } = baseOpts();
  const r = await runGuardedProduction(opts);
  assert.equal(r.ok, true);
  assert.equal(r.stage, "dry-run");
  assert.equal(r.dryRun.image_inserts, 0);
  assert.equal(r.dryRun.public_prices_all_null, true);
  for (const q of queries) assert.doesNotMatch(q.sql.trim().toLowerCase(), /^(begin|insert|update|delete)/, `write query in dry-run: ${q.sql.slice(0, 60)}`);
});

test("non-interactive apply without a confirmation file is refused before BEGIN", async () => {
  const snapDir = fs.mkdtempSync(path.join(os.tmpdir(), "snap-"));
  const { opts, queries } = baseOpts();
  opts.argv = opts.argv.map((t) => (t === "--dry-run" ? "--apply-production" : t)).concat(["--snapshot-dir", snapDir]);
  const r = await runGuardedProduction(opts);
  assert.equal(r.ok, false);
  assert.equal(r.stage, "confirmation");
  assert.equal(r.reason, "non_interactive_requires_confirmation_file");
  for (const q of queries) assert.doesNotMatch(q.sql.trim().toLowerCase(), /^(begin|insert|update)/);
});

test("a wrong confirmation phrase (interactive) is refused", async () => {
  const snapDir = fs.mkdtempSync(path.join(os.tmpdir(), "snap-"));
  const { opts } = baseOpts();
  opts.argv = opts.argv.map((t) => (t === "--dry-run" ? "--apply-production" : t)).concat(["--snapshot-dir", snapDir]);
  opts.stdinIsTTY = true;
  opts.promptFn = async () => "import the catalog"; // wrong phrase
  const r = await runGuardedProduction(opts);
  assert.equal(r.stage, "confirmation");
  assert.equal(r.reason, "interactive_phrase_mismatch");
});

test("a wrong-content confirmation file is refused (file mechanism, wrong phrase)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "conf-"));
  const wrong = path.join(dir, "confirm.txt");
  fs.writeFileSync(wrong, "IMPORT THE CATALOG NOW");
  const r = await resolveConfirmation({ stdinIsTTY: false, confirmationFile: wrong });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "confirmation_file_phrase_mismatch");
});

test("snapshot dir inside the repository is refused for apply", () => {
  const repo = path.join(here, "..");
  assert.equal(checkSnapshotDir(path.join(repo, "tmp", "snap"), repo).ok, false);
  assert.equal(checkSnapshotDir(os.tmpdir(), repo).ok, true);
  assert.equal(checkSnapshotDir("", repo).ok, false);
});

test("identity conflicts stop an apply run before any transaction", async () => {
  const conflicting = [...LIVE, { id: "x-1", sku: "FT-100TOOL", manufacturer_mpn: "DIFFERENT", gtin: null, brand: "o", title: "o", category: "o", price: null, status: "available" }];
  const snapDir = fs.mkdtempSync(path.join(os.tmpdir(), "snap-"));
  const { opts, queries } = baseOpts({ db: { existing: conflicting } });
  opts.argv = opts.argv.map((t) => (t === "--dry-run" ? "--apply-production" : t)).concat(["--snapshot-dir", snapDir]);
  opts.stdinIsTTY = true;
  opts.promptFn = async () => CONFIRMATION_PHRASE;
  const r = await runGuardedProduction(opts);
  assert.equal(r.ok, false);
  assert.equal(r.stage, "identity_conflicts");
  for (const q of queries) assert.doesNotMatch(q.sql.trim().toLowerCase(), /^begin/);
});

test("a mid-transaction failure rolls back the complete import", async () => {
  const snapDir = fs.mkdtempSync(path.join(os.tmpdir(), "snap-"));
  const { opts, queries } = baseOpts({ db: { failOn: /insert into public\.supplier_product_snapshots/i } });
  opts.argv = opts.argv.map((t) => (t === "--dry-run" ? "--apply-production" : t)).concat(["--snapshot-dir", snapDir]);
  opts.stdinIsTTY = true;
  opts.promptFn = async () => CONFIRMATION_PHRASE;
  const r = await runGuardedProduction(opts);
  assert.equal(r.ok, false);
  assert.equal(r.stage, "apply_transaction");
  assert.equal(r.rolled_back, true);
  const sqls = queries.map((q) => q.sql.trim().toLowerCase());
  assert.ok(sqls.some((s) => s.startsWith("begin")));
  assert.ok(sqls.some((s) => s.startsWith("rollback")), "rollback must be issued");
  assert.ok(!sqls.some((s) => s.startsWith("commit")), "commit must not be issued");
});

test("a fully-gated apply against the fake DB inserts products but zero images", async () => {
  const snapDir = fs.mkdtempSync(path.join(os.tmpdir(), "snap-"));
  const { opts, queries } = baseOpts();
  opts.argv = opts.argv.map((t) => (t === "--dry-run" ? "--apply-production" : t)).concat(["--snapshot-dir", snapDir]);
  opts.stdinIsTTY = true;
  opts.promptFn = async () => CONFIRMATION_PHRASE;
  const r = await runGuardedProduction(opts);
  assert.equal(r.ok, true);
  assert.equal(r.stage, "applied");
  assert.equal(r.counts.inserted, 2);
  assert.equal(r.counts.image_inserts, 0);
  assert.ok(
    !queries.some((q) => /^(insert|update|delete)/i.test(q.sql.trim()) && /product_images/i.test(q.sql)),
    "no product_images write may exist (the read-only snapshot count is allowed)"
  );
  assert.ok(fs.existsSync(path.join(snapDir, "preflight-snapshot.json")), "preflight snapshot persisted outside repo");
});

// ============================================================================
// Logging and hygiene
// ============================================================================
test("redacted logging masks connection strings, JWTs, and cost values", () => {
  const noisy = 'db=postgresql://postgres:secretpw@db.x.supabase.co:5432/x supplier_cost: 9.51 "msrp": 29.99 tok=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0';
  const clean = redact(noisy);
  assert.doesNotMatch(clean, /secretpw/);
  assert.doesNotMatch(clean, /9\.51/);
  assert.doesNotMatch(clean, /29\.99/);
  assert.doesNotMatch(clean, /eyJhbGciOi/);
});

test("rollback failure reports are redacted", async () => {
  const snapDir = fs.mkdtempSync(path.join(os.tmpdir(), "snap-"));
  const { opts } = baseOpts({ db: { failOn: /insert into public\.supplier_product_snapshots/i } });
  opts.argv = opts.argv.map((t) => (t === "--dry-run" ? "--apply-production" : t)).concat(["--snapshot-dir", snapDir]);
  opts.stdinIsTTY = true;
  opts.promptFn = async () => CONFIRMATION_PHRASE;
  const r = await runGuardedProduction(opts);
  assert.doesNotMatch(JSON.stringify(r), /user:pw@/);
  assert.doesNotMatch(JSON.stringify(r), /supplier_cost=999/);
});

test("normal npm test opens no real connection: gates precede client creation", async () => {
  // With every gate failing early, an exploding factory must never be invoked.
  const r = await runGuardedProduction({ argv: ["--apply-production"], env: {}, clientFactory: () => { throw new Error("must not connect"); } });
  assert.equal(r.ok, false);
  assert.notEqual(r.stage, "apply_transaction");
});

test("the local importer still cannot name a production mode", async () => {
  const { MODES } = await import("../scripts/lib/db-guard.mjs");
  assert.equal(MODES.has("apply-production"), false);
});

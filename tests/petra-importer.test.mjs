import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { evaluateConnection, assertLocalConnection, assertMode, MODES } from "../scripts/lib/db-guard.mjs";
import { validateBatch } from "../scripts/lib/import-batch.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, "fixtures", "opening-catalog-3.sample.json");
const scriptPath = path.join(here, "..", "scripts", "import-petra-catalog.mjs");
const candidates = () => JSON.parse(fs.readFileSync(fixture, "utf8"));

// --------------------------------------------------------------------------
// Connection / mode guards
// --------------------------------------------------------------------------
test("production Supabase hosts are refused", () => {
  assert.equal(evaluateConnection("postgresql://u:p@db.abcdefgh.supabase.co:5432/postgres").ok, false);
  assert.equal(evaluateConnection("postgresql://u:p@aws-0-us-east-1.pooler.supabase.com:6543/postgres").ok, false);
  assert.throws(() => assertLocalConnection("postgresql://u:p@db.abcdefgh.supabase.co:5432/postgres"), /Refusing to connect/);
});

test("a production project reference anywhere in the string is refused", () => {
  const r = evaluateConnection("postgresql://u:p@127.0.0.1:55322/postgres?ref=abcdefghijklmnop", {
    productionProjectRef: "abcdefghijklmnop",
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "production_project_ref_present");
});

test("only local hosts are accepted", () => {
  for (const h of ["localhost", "127.0.0.1", "host.docker.internal"]) {
    assert.equal(evaluateConnection(`postgresql://postgres:postgres@${h}:55322/postgres`).ok, true);
  }
  assert.equal(evaluateConnection("postgresql://u:p@10.0.0.5:5432/postgres").ok, false);
});

test("mode must be explicit and valid", () => {
  assert.throws(() => assertMode(""), /Invalid or missing mode/);
  assert.throws(() => assertMode("production"), /Invalid or missing mode/);
  assert.ok(MODES.has("dry-run") && MODES.has("apply-local"));
  assert.equal(MODES.has("apply-production"), false);
});

// --------------------------------------------------------------------------
// Batch validation / partitioning (pure)
// --------------------------------------------------------------------------
test("all clean fixture records are approved", () => {
  const p = validateBatch(candidates());
  assert.equal(p.counts.approved, 3);
  assert.equal(p.counts.rejected, 0);
  assert.equal(p.counts.duplicate, 0);
  assert.equal(p.counts.manual_review, 0);
});

test("public SKU equals the manufacturer MPN and is separate from supplier SKU", () => {
  const p = validateBatch(candidates());
  for (const { candidate } of p.approved) {
    assert.equal(candidate.public.sku, candidate.public.manufacturer_mpn);
    assert.notEqual(candidate.public.sku, candidate.private.supplier_sku);
  }
});

test("a record whose public SKU is not the MPN goes to manual review", () => {
  const c = candidates();
  c[0].public.sku = "SOMETHING-ELSE";
  const p = validateBatch(c);
  assert.equal(p.manualReview.some((m) => m.reason === "public_sku_not_mpn"), true);
});

test("a record whose public SKU equals the supplier SKU goes to manual review", () => {
  const c = candidates();
  c[0].public.sku = c[0].public.manufacturer_mpn = c[0].private.supplier_sku;
  const p = validateBatch(c);
  assert.equal(p.manualReview.some((m) => m.reason === "public_sku_equals_supplier_sku"), true);
});

test("duplicate public SKU and duplicate supplier SKU are caught, not published", () => {
  const c = candidates();
  const dupPublic = JSON.parse(JSON.stringify(c[0]));
  const dupSupplier = JSON.parse(JSON.stringify(c[1]));
  dupSupplier.public.sku = dupSupplier.public.manufacturer_mpn = "OTHER-MPN"; // same supplier_sku as c[1]
  const p = validateBatch([...c, dupPublic, dupSupplier]);
  assert.equal(p.duplicate.some((d) => d.reason === "duplicate_public_sku"), true);
  assert.equal(p.duplicate.some((d) => d.reason === "duplicate_supplier_sku"), true);
});

test("records with a null price stay quote-only; a non-null price is rejected", () => {
  const p = validateBatch(candidates());
  for (const { candidate } of p.approved) {
    assert.equal(candidate.public.public_price, null);
    assert.equal(candidate.public.price_mode, "request_quote");
  }
  const c = candidates();
  c[0].public.public_price = 29.99;
  assert.equal(validateBatch(c).rejected.some((r) => r.reason === "public_price_not_null"), true);
});

test("missing required public fields are rejected", () => {
  for (const field of ["manufacturer_mpn", "title", "brand", "category"]) {
    const c = candidates();
    c[0].public[field] = "";
    assert.equal(validateBatch(c).counts.rejected >= 1, true, `${field} should reject`);
  }
});

test("a clearly non-telecom record is rejected as a final gate", () => {
  const c = candidates();
  c[0].public.title = "12V 7A Sealed Lead Acid Battery";
  c[0].public.category = "Network Equipment";
  const p = validateBatch(c);
  assert.equal(p.rejected.some((r) => r.reason === "not_clearly_telecom"), true);
});

// --------------------------------------------------------------------------
// Candidate privacy (no supplier cost / private fields in the public block)
// --------------------------------------------------------------------------
test("no supplier cost exists anywhere and private fields stay in the private block", () => {
  const raw = fs.readFileSync(fixture, "utf8");
  assert.doesNotMatch(raw, /supplier_cost|wholesale|"cost"|\bmap_price\b|\bmsrp\b/i);
  for (const c of candidates()) {
    for (const k of Object.keys(c.public)) {
      assert.doesNotMatch(k, /supplier_sku|supplier_quantity|supplier_image|cost/i);
    }
    assert.ok("supplier_sku" in c.private && "supplier_image_url" in c.private);
    assert.equal(c.public.public_price, null);
  }
});

// --------------------------------------------------------------------------
// CLI: default mode is dry-run and performs no DB writes / prints no secrets
// --------------------------------------------------------------------------
test("CLI defaults to dry-run with zero database writes and no connection", () => {
  const out = execFileSync(process.execPath, [scriptPath, "--source", fixture], {
    encoding: "utf8",
    // Provide a would-be production URL: dry-run must ignore it and never connect.
    env: { ...process.env, PETRA_DB_URL: "postgresql://u:secretpw@db.prod.supabase.co:5432/postgres" },
  });
  const j = JSON.parse(out);
  assert.equal(j.mode, "dry-run");
  assert.equal(j.database_writes, 0);
  assert.equal(j.approved, 3);
  assert.doesNotMatch(out, /secretpw|password|service_role/i);
});

test("importer sources contain no hardcoded production connection or JWT key", () => {
  for (const f of ["import-petra-catalog.mjs", "lib/db-guard.mjs", "lib/import-batch.mjs"]) {
    const s = fs.readFileSync(path.join(here, "..", "scripts", f), "utf8");
    // A real leak is a JWT (anon/service_role key) or a connection string whose
    // host is a hosted Supabase project -- not the words appearing in comments.
    assert.doesNotMatch(s, /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, "no JWT key");
    assert.doesNotMatch(s, /@[a-z0-9.-]*supabase\.(co|com)/i, "no hosted-supabase connection string");
  }
});

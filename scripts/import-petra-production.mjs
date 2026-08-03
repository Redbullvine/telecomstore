#!/usr/bin/env node
// ============================================================================
// import-petra-production.mjs -- GUARDED production catalog importer (PREPARED,
// NOT AUTHORIZED). This wrapper exists so a FUTURE, explicitly authorized run
// can import the reviewed catalog. Nothing in this repository authorizes it.
//
// It is intentionally separate from scripts/import-petra-catalog.mjs: the
// local importer's mode set can never name a production mode (tested), so
// production capability lives only behind this wrapper's gates.
//
// EVERY safeguard must pass before any connection is opened:
//   1. --apply-production (or --dry-run) given explicitly; no default action.
//   2. env  TELECOMSTORE_PRODUCTION_IMPORT=AUTHORIZE_REVIEWED_TELECOM_CATALOG
//   3. --project-ref exactly equals the expected production project reference.
//   4. every source record has opening_approved=true.
//   5. every record: price_mode=request_quote, public_price=null,
//      publish_supplier_image=false, image_rights_status=pending.
//   6. source contains no cost/MAP/MSRP/credential/JWT and no supplier fields
//      outside an explicit _private prefix.
//   7. a complete read-only dry-run (snapshot + reconciliation plan) always
//      precedes any write; identity conflicts stop the run before BEGIN.
//   8. --apply-production additionally requires: not CI, a snapshot dir
//      OUTSIDE the repository, and the exact typed confirmation phrase
//      (interactive) or a one-time confirmation file (non-interactive).
//      That file is NOT created by this repository.
//
// The apply phase is one transaction; any error rolls back everything.
// No public product_images rows are ever inserted. Logs are redacted.
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import readline from "node:readline";
import { createRequire } from "node:module";
import {
  EXPECTED_PROJECT_REF,
  evaluateAuthorization,
  validateApprovedSource,
  checkProductionHost,
  checkSnapshotDir,
  planReconciliation,
  resolveConfirmation,
  redact,
} from "./lib/production-gate.mjs";

const require = createRequire(import.meta.url);

export function parseArgs(argv) {
  const a = { mode: null, source: null, projectRef: null, dbUrl: null, snapshotDir: null, confirmationFile: null };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--apply-production") a.mode = "apply";
    else if (t === "--dry-run") a.mode = "dry-run";
    else if (t === "--source") a.source = argv[++i];
    else if (t === "--project-ref") a.projectRef = argv[++i];
    else if (t === "--db-url") a.dbUrl = argv[++i];
    else if (t === "--snapshot-dir") a.snapshotDir = argv[++i];
    else if (t === "--confirmation-file") a.confirmationFile = argv[++i];
  }
  return a;
}

// Read-only preflight snapshot (design: preserved OUTSIDE the repo by the
// future authorized run via --snapshot-dir).
async function takeSnapshot(client) {
  const count = async (sql) => (await client.query(sql)).rows[0]?.n ?? null;
  return {
    migration_count: await count("select count(*)::int n from supabase_migrations.schema_migrations"),
    products: await count("select count(*)::int n from public.products"),
    suppliers: await count("select count(*)::int n from public.suppliers"),
    supplier_products: await count("select count(*)::int n from public.supplier_products"),
    product_supplier_offers: await count("select count(*)::int n from public.product_supplier_offers"),
    inventory_levels: await count("select count(*)::int n from public.inventory_levels"),
    product_images: await count("select count(*)::int n from public.product_images"),
    public_rpc_count: await count("select count(*)::int n from public.get_public_product_catalog()"),
    existing_products: (await client.query(
      "select id, sku, manufacturer_mpn, gtin, brand, title, category, price, status from public.products"
    )).rows,
  };
}

async function applyPlan(client, plan, sourceMeta) {
  const counts = { inserted: 0, updated: 0, unchanged: plan.unchanged.length, snapshots: 0, offers: 0, image_inserts: 0 };

  const sup = await client.query("select id from public.suppliers where lower(code)=lower($1) limit 1", ["petra"]);
  const supplierId = sup.rows.length
    ? sup.rows[0].id
    : (await client.query("insert into public.suppliers (code, name, active) values ($1,$2,true) returning id", ["petra", "Petra Industries"])).rows[0].id;

  const run = await client.query(
    `insert into public.supplier_catalog_runs
       (supplier_id, source_filename, source_sha256, encoding, source_row_count, schema_version, status)
     values ($1,$2,$3,'utf-8',$4,'petra-production-v1','received') returning id`,
    [supplierId, sourceMeta.filename, sourceMeta.sha256, sourceMeta.total]
  );
  const runId = run.rows[0].id;

  const upsertSupplierSide = async (r, productId) => {
    const sp = await client.query(
      `insert into public.supplier_products
         (supplier_id, supplier_sku, manufacturer_mpn, gtin, brand, supplier_title, current_catalog_run_id, last_seen_at, source_hash)
       values ($1,$2,$3,$4,$5,$6,$7, now(), $8)
       on conflict (supplier_id, supplier_sku) do update set
         manufacturer_mpn=excluded.manufacturer_mpn, gtin=excluded.gtin, brand=excluded.brand,
         supplier_title=excluded.supplier_title, current_catalog_run_id=excluded.current_catalog_run_id, last_seen_at=now()
       returning id`,
      [supplierId, r._private_supplier_sku, r.manufacturer_mpn, r.gtin || null, r.brand, r._private_raw_supplier_title || null, runId, sourceMeta.sha256]
    );
    const supplierProductId = sp.rows[0].id;
    await client.query(
      `insert into public.supplier_product_snapshots
         (supplier_id, catalog_run_id, supplier_product_id, source_row_number, currency_code, raw_payload, source_hash)
       values ($1,$2,$3,$4,'USD',$5::jsonb,$6)`,
      [supplierId, runId, supplierProductId, r.source_row ?? null,
       JSON.stringify({ supplier_sku: r._private_supplier_sku, raw_title: r._private_raw_supplier_title ?? null, raw_description: r._private_raw_supplier_description ?? null }),
       sourceMeta.sha256]
    );
    counts.snapshots++;
    await client.query(
      `insert into public.product_supplier_offers
         (product_id, supplier_product_id, preferred_supplier, active, fulfillment_enabled, sourcing_priority)
       values ($1,$2,true,true,false,100)
       on conflict (supplier_product_id) do update set product_id=excluded.product_id, active=true`,
      [productId, supplierProductId]
    );
    counts.offers++;
  };

  for (const { record: r } of plan.inserts) {
    const ins = await client.query(
      `insert into public.products
         (sku, brand, title, category, short_description, long_description, manufacturer_mpn, gtin,
          currency_code, price, quantity_available, status, specifications, search_keywords, published_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'USD',null,null,'available','{}'::jsonb,$9::text[], now())
       returning id`,
      [r.public_sku, r.brand, r.title, r.category, r.short_description || r.title, r._private_raw_supplier_description || null,
       r.manufacturer_mpn, r.gtin || null, [r.brand, r.category, r.manufacturer_mpn].filter(Boolean).map((s) => String(s).toLowerCase())]
    );
    counts.inserted++;
    await upsertSupplierSide(r, ins.rows[0].id);
  }
  for (const { record: r, productId } of plan.updates) {
    await client.query(
      `update public.products set brand=$2, title=$3, category=$4, short_description=$5,
         manufacturer_mpn=$6, gtin=$7, price=null, status='available' where id=$1`,
      [productId, r.brand, r.title, r.category, r.short_description || r.title, r.manufacturer_mpn, r.gtin || null]
    );
    counts.updated++;
    await upsertSupplierSide(r, productId);
  }
  for (const { record: r, productId } of plan.unchanged) {
    await upsertSupplierSide(r, productId); // keep supplier linkage fresh; curated row untouched
  }
  // Deliberately NO public.product_images inserts: Petra image rights pending.
  return counts;
}

export async function runGuardedProduction(opts = {}) {
  const {
    argv = [], env = {}, stdinIsTTY = false, promptFn = null,
    clientFactory = null, log = () => {}, repoRoot = process.cwd(),
  } = opts;
  const a = parseArgs(argv);
  const fail = (stage, reason, extra = {}) => ({ ok: false, stage, reason, ...extra });

  // Gate 1: explicit mode; production behavior is DISABLED by default.
  if (!a.mode) return fail("mode", "production_mode_disabled_by_default");
  // Gate: apply-production may never run in CI.
  if (a.mode === "apply" && (env.CI || env.GITHUB_ACTIONS)) return fail("ci_guard", "apply_refused_in_ci");

  // Gates 2 + 3: environment authorization and exact project reference.
  const auth = evaluateAuthorization({ env, projectRef: a.projectRef });
  if (auth.length) return fail("authorization", auth.join(","));

  // Gates 4-6: reviewed-source validation.
  if (!a.source || !fs.existsSync(a.source)) return fail("source", "source_file_missing");
  const buf = fs.readFileSync(a.source);
  let records;
  try { records = JSON.parse(buf.toString("utf8")); } catch { return fail("source", "source_not_json"); }
  const v = validateApprovedSource(records);
  if (!v.ok) return fail("source_validation", "approved_source_invalid", { failures: v.failures.slice(0, 10), failure_count: v.failures.length });

  // Gate: DB host must be the authorized project's direct host.
  const dbUrl = a.dbUrl || env.PETRA_PRODUCTION_DB_URL || "";
  const host = checkProductionHost(dbUrl, a.projectRef);
  if (!host.ok) return fail("db_host", host.reason);

  // Gate: apply requires a snapshot dir OUTSIDE the repository.
  if (a.mode === "apply") {
    const sd = checkSnapshotDir(a.snapshotDir, repoRoot);
    if (!sd.ok) return fail("snapshot_dir", sd.reason);
  }

  if (typeof clientFactory !== "function") return fail("client", "no_client_factory");
  const client = clientFactory();
  await client.connect();
  try {
    // Gate 7: complete read-only dry-run before any write.
    const snapshot = await takeSnapshot(client);
    const plan = planReconciliation(records, snapshot.existing_products);
    const dryRun = {
      source_count: records.length,
      approved_count: records.length,
      rejected_count: 0,
      duplicate_count: v.counts.duplicates,
      existing_product_conflicts: plan.conflicts.length,
      new_inserts: plan.inserts.length,
      safe_updates: plan.updates.length,
      unchanged_records: plan.unchanged.length,
      image_inserts: 0,
      public_prices_all_null: records.every((r) => r.public_price === null),
      preflight_counts: {
        migration_count: snapshot.migration_count, products: snapshot.products, suppliers: snapshot.suppliers,
        supplier_products: snapshot.supplier_products, product_supplier_offers: snapshot.product_supplier_offers,
        inventory_levels: snapshot.inventory_levels, product_images: snapshot.product_images,
        public_rpc_count: snapshot.public_rpc_count,
      },
    };
    log(redact(JSON.stringify({ dry_run: dryRun }, null, 2)));

    // Gates 10 + 11: any identity conflict stops the import before BEGIN.
    if (plan.conflicts.length) {
      return fail("identity_conflicts", "conflicting_products_block_import", { conflicts: plan.conflicts, dryRun });
    }
    if (a.mode === "dry-run") return { ok: true, stage: "dry-run", dryRun };

    // Persist the preflight snapshot outside the repository.
    fs.mkdirSync(a.snapshotDir, { recursive: true });
    fs.writeFileSync(path.join(a.snapshotDir, "preflight-snapshot.json"), JSON.stringify(snapshot, null, 2) + "\n");

    // Gate 20: exact typed confirmation immediately before BEGIN.
    const conf = await resolveConfirmation({ stdinIsTTY, promptFn, confirmationFile: a.confirmationFile });
    if (!conf.ok) return fail("confirmation", conf.reason, { dryRun });

    // Gates 12-15: one transaction; full rollback on any failure; no images.
    try {
      await client.query("begin");
      const counts = await applyPlan(client, plan, {
        filename: path.basename(a.source),
        sha256: crypto.createHash("sha256").update(buf).digest("hex"),
        total: records.length,
      });
      await client.query("commit");
      return { ok: true, stage: "applied", dryRun, counts };
    } catch (err) {
      try { await client.query("rollback"); } catch { /* ignore */ }
      return fail("apply_transaction", redact(err.message), { rolled_back: true, dryRun });
    }
  } finally {
    await client.end();
  }
}

// --- CLI ---------------------------------------------------------------------
async function main() {
  const argv = process.argv.slice(2);
  const promptFn = (q) =>
    new Promise((resolve) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question(q, (ans) => { rl.close(); resolve(ans); });
    });
  const result = await runGuardedProduction({
    argv,
    env: process.env,
    stdinIsTTY: Boolean(process.stdin.isTTY),
    promptFn,
    clientFactory: () => {
      const { Client } = require("pg");
      return new Client({ connectionString: process.env.PETRA_PRODUCTION_DB_URL || parseArgs(argv).dbUrl });
    },
    log: (m) => console.log(m),
    repoRoot: path.resolve(path.dirname(new URL(import.meta.url).pathname), ".."),
  });
  console.log(redact(JSON.stringify(result, null, 2)));
  if (!result.ok) process.exitCode = 1;
}

const invoked = process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("import-petra-production.mjs");
if (invoked) main();

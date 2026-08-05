#!/usr/bin/env node
// ============================================================================
// import-petra-catalog.mjs -- transactional Petra catalog loader.
//
// Modes (an explicit mode is REQUIRED; there is no implicit production mode):
//   --dry-run      (default) validate + partition, NO connection, NO writes
//   --apply-local  one rollback-safe transaction into a LOCAL Supabase DB only
//
// Safety:
//   * assertLocalConnection() refuses supabase.co / production refs / any host
//     not in {localhost,127.0.0.1,host.docker.internal,::1}.
//   * Whole import is one transaction; any error -> ROLLBACK + nonzero exit +
//     failed-stage report; no partial catalog is left behind.
//   * Public products carry NULL price and NULL quantity (quote-only). Supplier
//     cost is never read or written. Supplier SKU/quantity/image stay private.
//   * No public product_images are inserted (image rights pending).
//   * Idempotent: reruns upsert, producing zero duplicate products.
//   * No credentials or secrets are printed.
//
// Usage:
//   node scripts/import-petra-catalog.mjs --dry-run --source tmp/catalog-prep/opening-catalog-287.json
//   PETRA_DB_URL=... node scripts/import-petra-catalog.mjs --apply-local --source <file>
// ============================================================================

import fs from "node:fs";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { assertMode, assertLocalConnection } from "./lib/db-guard.mjs";
import { validateBatch } from "./lib/import-batch.mjs";

const require = createRequire(import.meta.url);

function parseArgs(argv) {
  const a = { mode: null, source: null, dbUrl: null };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--dry-run") a.mode = "dry-run";
    else if (t === "--apply-local") a.mode = "apply-local";
    else if (t === "--source") a.source = argv[++i];
    else if (t === "--db-url") a.dbUrl = argv[++i];
  }
  if (!a.mode) a.mode = "dry-run"; // default is dry-run, never production
  return a;
}

// Local default password is the well-known Supabase-local default, not a
// production secret. Production hosts are refused by assertLocalConnection.
function resolveConnString(args) {
  return (
    args.dbUrl ||
    process.env.PETRA_DB_URL ||
    `postgresql://postgres:postgres@127.0.0.1:${process.env.PETRA_DB_PORT || 55322}/postgres`
  );
}

function loadCandidates(source) {
  if (!source || !fs.existsSync(source)) {
    const e = new Error(`Source file not found: ${source || "(none)"}`);
    e.code = "SOURCE_MISSING";
    throw e;
  }
  const buf = fs.readFileSync(source);
  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  const data = JSON.parse(buf.toString("utf8"));
  if (!Array.isArray(data)) {
    const e = new Error("Source must be a JSON array of candidates.");
    e.code = "SOURCE_SHAPE";
    throw e;
  }
  return { candidates: data, sha256, filename: source.split(/[\\/]/).pop() };
}

function searchKeywords(pub) {
  return [pub.brand, pub.category, pub.manufacturer_mpn]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase());
}

async function resolveSupplier(client) {
  const found = await client.query("select id from public.suppliers where lower(code)=lower($1) limit 1", ["petra"]);
  if (found.rows.length) return found.rows[0].id;
  const ins = await client.query(
    "insert into public.suppliers (code, name, active) values ($1,$2,true) returning id",
    ["petra", "Petra Industries"]
  );
  return ins.rows[0].id;
}

async function resolveStorageLocation(client) {
  const name = "Petra Local Import";
  const found = await client.query("select id from public.storage_locations where name=$1 limit 1", [name]);
  if (found.rows.length) return found.rows[0].id;
  const ins = await client.query(
    "insert into public.storage_locations (name, notes) values ($1,$2) returning id",
    [name, "Private supplier-sourced quantities for the Petra opening import."]
  );
  return ins.rows[0].id;
}

async function applyLocal(connString, approved, meta) {
  const { Client } = require("pg");
  const client = new Client({ connectionString: connString });
  const counts = { inserted: 0, updated: 0, skipped: 0, snapshots: 0, offers: 0, inventory: 0 };
  let stage = "connect";
  const forceFail = process.env.PETRA_FORCE_FAIL === "1"; // test-only rollback hook
  await client.connect();
  try {
    await client.query("begin");

    stage = "supplier";
    const supplierId = await resolveSupplier(client);

    stage = "storage_location";
    const locationId = await resolveStorageLocation(client);

    stage = "catalog_run";
    const runIns = await client.query(
      `insert into public.supplier_catalog_runs
        (supplier_id, source_filename, source_sha256, encoding, source_row_count, schema_version, status)
       values ($1,$2,$3,$4,$5,$6,'received') returning id`,
      [supplierId, meta.filename, meta.sha256, "utf-8", meta.total, "petra-opening-v1"]
    );
    const runId = runIns.rows[0].id;

    stage = "records";
    let i = 0;
    for (const { candidate } of approved) {
      i++;
      const pub = candidate.public;
      const priv = candidate.private;

      // supplier_products (private, upsert by supplier_sku)
      const spRes = await client.query(
        `insert into public.supplier_products
           (supplier_id, supplier_sku, manufacturer_mpn, gtin, brand, supplier_title,
            supplier_category, supplier_quantity, supplier_available, supplier_image_url,
            current_catalog_run_id, last_seen_at, source_hash)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now(), $12)
         on conflict (supplier_id, supplier_sku) do update set
           manufacturer_mpn=excluded.manufacturer_mpn, gtin=excluded.gtin, brand=excluded.brand,
           supplier_title=excluded.supplier_title, supplier_category=excluded.supplier_category,
           supplier_quantity=excluded.supplier_quantity, supplier_available=excluded.supplier_available,
           supplier_image_url=excluded.supplier_image_url, current_catalog_run_id=excluded.current_catalog_run_id,
           last_seen_at=now()
         returning id`,
        [
          supplierId,
          priv.supplier_sku,
          pub.manufacturer_mpn,
          pub.gtin,
          pub.brand,
          priv.supplier_title,
          priv.supplier_category,
          Number.isFinite(priv.supplier_quantity) ? priv.supplier_quantity : 0,
          !!priv.supplier_available,
          priv.supplier_image_url,
          runId,
          meta.sha256,
        ]
      );
      const supplierProductId = spRes.rows[0].id;

      // snapshot (private raw payload; NO cost / MAP / MSRP carried)
      await client.query(
        `insert into public.supplier_product_snapshots
           (supplier_id, catalog_run_id, supplier_product_id, source_row_number,
            supplier_quantity, supplier_available, currency_code, raw_payload, source_hash)
         values ($1,$2,$3,$4,$5,$6,'USD',$7::jsonb,$8)`,
        [
          supplierId,
          runId,
          supplierProductId,
          candidate.source_row,
          Number.isFinite(priv.supplier_quantity) ? priv.supplier_quantity : 0,
          !!priv.supplier_available,
          JSON.stringify({
            supplier_sku: priv.supplier_sku,
            supplier_title: priv.supplier_title,
            supplier_category: priv.supplier_category,
            supplier_quantity: priv.supplier_quantity,
            supplier_image_url: priv.supplier_image_url,
            source_row: candidate.source_row,
          }),
          meta.sha256,
        ]
      );
      counts.snapshots++;

      if (forceFail && i === 2) {
        throw new Error("PETRA_FORCE_FAIL: simulated failure to verify rollback");
      }

      // curated public product (resolve-or-create by public SKU = MPN)
      stage = "products";
      const existing = await client.query("select id from public.products where sku=$1 limit 1", [pub.sku]);
      let productId;
      if (existing.rows.length) {
        productId = existing.rows[0].id;
        await client.query(
          `update public.products set
             brand=$2, title=$3, category=$4, short_description=$5, long_description=$6,
             manufacturer_mpn=$7, gtin=$8, slug=$9, currency_code='USD',
             price=null, quantity_available=null, status='available',
             specifications='{}'::jsonb, search_keywords=$10::text[], published_at=now()
           where id=$1`,
          [productId, pub.brand, pub.title, pub.category, pub.short_description, pub.long_description,
           pub.manufacturer_mpn, pub.gtin, pub.slug || null, searchKeywords(pub)]
        );
        counts.updated++;
      } else {
        const insP = await client.query(
          `insert into public.products
             (sku, brand, title, category, short_description, long_description,
              manufacturer_mpn, gtin, slug, currency_code, price, quantity_available,
              status, specifications, search_keywords, published_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'USD',null,null,'available','{}'::jsonb,$10::text[], now())
           returning id`,
          [pub.sku, pub.brand, pub.title, pub.category, pub.short_description, pub.long_description,
           pub.manufacturer_mpn, pub.gtin, pub.slug || null, searchKeywords(pub)]
        );
        productId = insP.rows[0].id;
        counts.inserted++;
      }
      stage = "records";

      // supplier offer link (private)
      await client.query(
        `insert into public.product_supplier_offers
           (product_id, supplier_product_id, preferred_supplier, active, fulfillment_enabled, sourcing_priority)
         values ($1,$2,true,true,false,100)
         on conflict (supplier_product_id) do update set product_id=excluded.product_id, active=true`,
        [productId, supplierProductId]
      );
      counts.offers++;

      // private inventory (only when quantity is a valid non-negative number)
      if (Number.isFinite(priv.supplier_quantity) && priv.supplier_quantity >= 0) {
        await client.query(
          `insert into public.inventory_levels (product_id, storage_location_id, on_hand, reserved, damaged)
           values ($1,$2,$3,0,0)
           on conflict (product_id, storage_location_id) do update set on_hand=excluded.on_hand`,
          [productId, locationId, priv.supplier_quantity]
        );
        counts.inventory++;
      } else {
        counts.skipped++;
      }

      // NOTE: no public product_images insert — Petra image rights are pending.
    }

    stage = "finalize";
    await client.query(
      `update public.supplier_catalog_runs set
         status='loaded', accepted_row_count=$2, rejected_row_count=$3,
         validation_summary=$4::jsonb, completed_at=now()
       where id=$1`,
      [runId, meta.approved, meta.total - meta.approved, JSON.stringify(meta.partitionCounts)]
    );

    await client.query("commit");
    return { ok: true, runId, counts };
  } catch (err) {
    try {
      await client.query("rollback");
    } catch {
      /* ignore rollback failure */
    }
    err.stage = stage;
    throw err;
  } finally {
    await client.end();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertMode(args.mode);

  const { candidates, sha256, filename } = loadCandidates(args.source);
  const part = validateBatch(candidates);
  const meta = {
    filename,
    sha256,
    total: candidates.length,
    approved: part.counts.approved,
    partitionCounts: part.counts,
  };

  const base = {
    mode: args.mode,
    source: filename,
    total_reviewed: candidates.length,
    ...part.counts,
    category_breakdown: part.approved.reduce((acc, { candidate }) => {
      const c = candidate.public.category;
      acc[c] = (acc[c] || 0) + 1;
      return acc;
    }, {}),
  };

  if (args.mode === "dry-run") {
    console.log(JSON.stringify({ ...base, database_writes: 0, note: "dry-run: no DB connection, no writes" }, null, 2));
    return;
  }

  // apply-local
  const connString = resolveConnString(args);
  assertLocalConnection(connString, { productionProjectRef: process.env.PRODUCTION_PROJECT_REF || "" });

  try {
    const result = await applyLocal(connString, part.approved, meta);
    console.log(
      JSON.stringify(
        {
          ...base,
          applied: true,
          run_id: result.runId,
          inserted: result.counts.inserted,
          updated: result.counts.updated,
          skipped_inventory: result.counts.skipped,
          snapshots: result.counts.snapshots,
          offers: result.counts.offers,
          inventory_levels: result.counts.inventory,
          public_product_images_inserted: 0,
        },
        null,
        2
      )
    );
  } catch (err) {
    console.error(JSON.stringify({ ok: false, failed_stage: err.stage || "unknown", error: err.message }, null, 2));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message, code: err.code || null }, null, 2));
  process.exitCode = 1;
});

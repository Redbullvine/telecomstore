#!/usr/bin/env node
// Full private supplier-layer importer. There is deliberately no production
// mode and no public product, offer, publication, price, or image write.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { assertLocalConnection, assertMode } from "./lib/db-guard.mjs";
import { restrictionType, validateMarketplaceImport } from "./lib/marketplace-import.mjs";

const require = createRequire(import.meta.url);

function args(argv) {
  const parsed = { mode: "dry-run", plan: "tmp/petra-marketplace-dry-run/private-import-plan.json", summary: "tmp/petra-marketplace-dry-run/summary.json", dbUrl: null };
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--dry-run") parsed.mode = "dry-run";
    else if (argv[index] === "--apply-local") parsed.mode = "apply-local";
    else if (argv[index] === "--plan") parsed.plan = argv[++index];
    else if (argv[index] === "--summary") parsed.summary = argv[++index];
    else if (argv[index] === "--db-url") parsed.dbUrl = argv[++index];
  }
  return parsed;
}

function readJson(file, label) {
  const resolved = path.resolve(file);
  if (!resolved.toLowerCase().startsWith(path.resolve("tmp").toLowerCase() + path.sep)) {
    throw new Error(`${label} must remain below the ignored tmp directory`);
  }
  if (!fs.existsSync(resolved)) throw new Error(`${label} not found`);
  return JSON.parse(fs.readFileSync(resolved, "utf8"));
}

async function resolveSupplier(client) {
  const existing = await client.query("select id from public.suppliers where lower(code)=lower($1) limit 1", ["petra"]);
  if (existing.rows.length) return existing.rows[0].id;
  const inserted = await client.query(
    "insert into public.suppliers (code, name, active) values ($1,$2,true) returning id",
    ["petra", "Petra Industries"]
  );
  return inserted.rows[0].id;
}

async function applyLocal(connectionString, records, summary, counts) {
  const { Client } = require("pg");
  const client = new Client({ connectionString });
  let stage = "connect";
  await client.connect();
  try {
    await client.query("begin");
    stage = "schema";
    await client.query("select 1 from public.supplier_restrictions, public.pricing_reviews, public.supplier_product_quarantine, public.marketplace_publications limit 0");
    stage = "supplier";
    const supplierId = await resolveSupplier(client);
    const prior = await client.query(
      "select id from public.supplier_catalog_runs where supplier_id=$1 and source_sha256=$2 and status='loaded' limit 1",
      [supplierId, summary.source.sha256]
    );
    if (prior.rows.length) {
      await client.query("rollback");
      return { already_loaded: true, run_id: prior.rows[0].id, supplier_products: 0, snapshots: 0, restrictions: 0, quarantine: 0, pricing_reviews: 0 };
    }

    stage = "catalog_run";
    const run = await client.query(
      `insert into public.supplier_catalog_runs
       (supplier_id, source_filename, source_sha256, supplier_exported_at, encoding,
        source_row_count, accepted_row_count, rejected_row_count, schema_version,
        status, validation_summary, completed_at)
       values ($1,$2,$3,$4,'xlsx',$5,$5,0,'marketplace-v1','validated',$6::jsonb,null)
       returning id`,
      [supplierId, summary.source.filename, summary.source.sha256, summary.source.generated_at, records.length, JSON.stringify(counts)]
    );
    const runId = run.rows[0].id;
    const written = { already_loaded: false, run_id: runId, supplier_products: 0, snapshots: 0, restrictions: 0, quarantine: 0, pricing_reviews: 0 };

    for (let index = 0; index < records.length; index++) {
      const record = records[index];
      stage = `supplier_product_${index + 1}`;
      const supplierProduct = await client.query(
        `insert into public.supplier_products
         (supplier_id, supplier_sku, manufacturer_mpn, gtin, brand, supplier_title,
          supplier_description, supplier_specs, supplier_category, supplier_subcategory,
          supplier_subcategory_2, supplier_subcategory_3, supplier_quantity,
          supplier_available, discontinued, refurbished, supplier_image_url,
          unpacked_weight, shipping_weight, weight_unit, length, width, height,
          dimension_unit, warranty, country_of_origin, marketplace_department_slug,
          current_catalog_run_id, last_seen_at, source_hash)
         values ($1,$2,$3,null,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'lb',$19,$20,$21,'in',$22,$23,$24,$25,now(),$26)
         on conflict (supplier_id, supplier_sku) do update set
          manufacturer_mpn=excluded.manufacturer_mpn, gtin=null, brand=excluded.brand,
          supplier_title=excluded.supplier_title, supplier_description=excluded.supplier_description,
          supplier_specs=excluded.supplier_specs, supplier_category=excluded.supplier_category,
          supplier_subcategory=excluded.supplier_subcategory,
          supplier_subcategory_2=excluded.supplier_subcategory_2,
          supplier_subcategory_3=excluded.supplier_subcategory_3,
          supplier_quantity=excluded.supplier_quantity, supplier_available=excluded.supplier_available,
          discontinued=excluded.discontinued, refurbished=excluded.refurbished,
          supplier_image_url=excluded.supplier_image_url, unpacked_weight=excluded.unpacked_weight,
          shipping_weight=excluded.shipping_weight, length=excluded.length, width=excluded.width,
          height=excluded.height, warranty=excluded.warranty,
          country_of_origin=excluded.country_of_origin,
          marketplace_department_slug=excluded.marketplace_department_slug,
          current_catalog_run_id=excluded.current_catalog_run_id, last_seen_at=now(),
          source_hash=excluded.source_hash
         returning id`,
        [supplierId, record.supplier_sku, record.manufacturer_mpn || null, record.brand || null,
          record.supplier_title || null, record.supplier_description || null, record.supplier_specs || null,
          record.product_class || null, record.subcategory || null, record.subcategory_2 || null,
          record.subcategory_3 || null, record.quantity, record.in_stock, record.discontinued,
          record.refurbished, record.image_url || null, record.unpacked_weight, record.estimated_ship_weight,
          record.length, record.width, record.height, record.warranty || null,
          record.country_of_origin || null, record.department, runId, record.source_hash]
      );
      const supplierProductId = supplierProduct.rows[0].id;
      written.supplier_products++;

      stage = `snapshot_${index + 1}`;
      await client.query(
        `insert into public.supplier_product_snapshots
         (supplier_id, catalog_run_id, supplier_product_id, source_row_number,
          supplier_cost, map_price, msrp, currency_code, supplier_quantity,
          supplier_available, discontinued, refurbished, returnable, po_eta_date,
          source_hash, raw_payload)
         values ($1,$2,$3,$4,$5,$6,$7,'USD',$8,$9,$10,$11,$12,$13,$14,$15::jsonb)`,
        [supplierId, runId, supplierProductId, record.source_row_number, record.supplier_cost,
          record.map_price, record.msrp, record.quantity, record.in_stock, record.discontinued,
          record.refurbished, record.returnable, record.po_eta_date || null, record.source_hash,
          JSON.stringify(record.raw_payload)]
      );
      written.snapshots++;

      if (record.restricted) {
        await client.query(
          `insert into public.supplier_restrictions
           (supplier_product_id, catalog_run_id, restriction_type, review_status, source_evidence, active)
           values ($1,$2,$3,'blocked',$4,true)`,
          [supplierProductId, runId, restrictionType(record.restriction_evidence), record.restriction_evidence]
        );
        written.restrictions++;
      }
      if (record.identity_conflict) {
        await client.query(
          `insert into public.supplier_product_quarantine
           (supplier_product_id, catalog_run_id, reason, evidence, status)
           values ($1,$2,'identity_conflict',$3::jsonb,'quarantined')`,
          [supplierProductId, runId, JSON.stringify({ gtin_status: record.gtin_status, manufacturer_mpn_present: Boolean(record.manufacturer_mpn) })]
        );
        written.quarantine++;
      }
      await client.query(
        `insert into public.pricing_reviews
         (supplier_product_id, catalog_run_id, status, reason, supplier_cost,
          map_price, msrp, margin_floor_30, margin_floor_20, candidate_price,
          gross_profit, gross_margin, approval_status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending')`,
        [supplierProductId, runId, record.pricing_status, record.pricing_reason,
          record.supplier_cost, record.map_price, record.msrp, record.margin_floor_30,
          record.margin_floor_20, record.price_candidate, record.gross_profit, record.gross_margin]
      );
      written.pricing_reviews++;
      if (process.env.PETRA_MARKETPLACE_FORCE_FAIL === "1" && index === 1) throw new Error("forced rollback test");
    }

    stage = "removed_supplier_products";
    await client.query(
      `update public.supplier_products set supplier_available=false, supplier_quantity=0, updated_at=now()
       where supplier_id=$1 and current_catalog_run_id is distinct from $2`,
      [supplierId, runId]
    );
    stage = "finalize";
    await client.query(
      `update public.supplier_catalog_runs set status='loaded', completed_at=now(), validation_summary=$2::jsonb where id=$1`,
      [runId, JSON.stringify({ ...counts, gtin_fallback_matching_enabled: false, public_writes: 0 })]
    );
    await client.query("commit");
    return written;
  } catch (error) {
    try { await client.query("rollback"); } catch { /* best effort */ }
    error.stage = stage;
    throw error;
  } finally {
    await client.end();
  }
}

async function main() {
  const options = args(process.argv.slice(2));
  assertMode(options.mode);
  const records = readJson(options.plan, "private plan");
  const summary = readJson(options.summary, "summary");
  const validation = validateMarketplaceImport(records, summary);
  if (!validation.ok) throw new Error(`private import validation failed: ${validation.errors.join("; ")}`);
  const report = { mode: options.mode, ...validation.counts, gtin_fallback_matching_enabled: false, public_product_writes: 0, public_price_writes: 0, public_image_writes: 0 };
  if (options.mode === "dry-run") {
    console.log(JSON.stringify({ ...report, database_writes: 0 }, null, 2));
    return;
  }
  const connectionString = options.dbUrl || process.env.PETRA_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  assertLocalConnection(connectionString, { productionProjectRef: process.env.PRODUCTION_PROJECT_REF || "" });
  const result = await applyLocal(connectionString, records, summary, validation.counts);
  console.log(JSON.stringify({ ...report, applied_local: true, write_result: result }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, failed_stage: error.stage || "validation", error: error.message }, null, 2));
  process.exitCode = 1;
});

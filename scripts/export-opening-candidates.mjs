#!/usr/bin/env node
// ============================================================================
// export-opening-candidates.mjs -- build the full telecom opening candidate set
//
// Reads a Petra CSV export, transforms + validates every row, keeps only the
// telecom-selectable candidates, and emits a public/private-separated candidate
// file for the transactional loader. NO database access. NO supplier cost in
// any output. Deterministic.
//
// Usage:
//   node scripts/export-opening-candidates.mjs <source.csv> [--out tmp/catalog-prep]
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
  findHeaderLineIndex,
  validateColumns,
  transformRow,
  detectDuplicates,
  isSelectable,
  expandAbbreviations,
  normalizeWhitespace,
} from "./lib/petra-transform.mjs";

const require = createRequire(import.meta.url);
const Papa = require("papaparse");

function toCsv(rows, columns) {
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return [columns.join(","), ...rows.map((r) => columns.map((c) => esc(r[c])).join(","))].join("\n") + "\n";
}

// Public/private candidate record. Supplier cost is never carried.
export function toCandidate(record) {
  const title = expandAbbreviations(record.curated.title) || record.curated.title;
  return {
    source_row: record.sourceRow,
    supplier_source: "petra",
    public: {
      sku: record.curated.proposed_public_sku, // == manufacturer MPN
      manufacturer_mpn: record.curated.manufacturer_mpn,
      brand: record.curated.brand,
      title,
      short_description: title,
      long_description: record.curated.long_description || "",
      category: record.curated.category,
      gtin: record.curated.gtin,
      slug: record.curated.slug,
      price_mode: "request_quote",
      public_price: null,
      currency_code: "USD",
      status_intent: "available", // required for RPC visibility
      availability_intent: "quote_only",
    },
    private: {
      supplier_sku: record.supplier.supplier_sku,
      supplier_title: record.supplier.supplier_title,
      supplier_category: record.supplier.supplier_category,
      supplier_quantity: record.supplier.supplier_quantity,
      supplier_available: record.supplier.supplier_available,
      supplier_image_url: record.supplier.supplier_image_url,
      image_rights_status: "pending",
      publish_supplier_image: false,
    },
    review_flags: record.review_flags ?? record.flags ?? [],
  };
}

function main() {
  const argv = process.argv.slice(2);
  const src = argv[0];
  let outDir = "tmp/catalog-prep";
  for (let i = 1; i < argv.length; i++) if (argv[i] === "--out") outDir = argv[++i];
  if (!src || !fs.existsSync(src)) {
    console.error(`Source file not found: ${src || "(none)"}`);
    process.exit(2);
  }

  const raw = fs.readFileSync(src, "utf8");
  const lines = raw.split(/\r?\n/);
  const headerIdx = findHeaderLineIndex(lines);
  if (headerIdx === -1) {
    console.error("Could not locate the Petra column header.");
    process.exit(1);
  }
  const parsed = Papa.parse(lines.slice(headerIdx).join("\n"), { header: true, skipEmptyLines: "greedy" });
  const colCheck = validateColumns(parsed.meta.fields || []);
  if (!colCheck.ok) {
    console.error(`Missing required columns: ${colCheck.missing.join(", ")}`);
    process.exit(1);
  }

  const rows = parsed.data.filter((r) => (r["PETRA SKU"] || "").trim());
  const records = rows.map((r, i) => transformRow(r, i));
  detectDuplicates(records);

  const selectable = records.filter(isSelectable);
  const candidates = selectable.map(toCandidate);

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "opening-catalog-287.json"), JSON.stringify(candidates, null, 2) + "\n");
  fs.writeFileSync(
    path.join(outDir, "opening-catalog-287.csv"),
    toCsv(
      candidates.map((c) => ({
        source_row: c.source_row,
        public_sku: c.public.sku,
        manufacturer_mpn: c.public.manufacturer_mpn,
        supplier_sku: c.private.supplier_sku,
        brand: c.public.brand,
        title: c.public.title,
        category: c.public.category,
        gtin: c.public.gtin || "",
        price_mode: c.public.price_mode,
        public_price: c.public.public_price === null ? "" : c.public.public_price,
        image_rights_status: c.private.image_rights_status,
        publish_supplier_image: c.private.publish_supplier_image,
      })),
      ["source_row", "public_sku", "manufacturer_mpn", "supplier_sku", "brand", "title", "category", "gtin", "price_mode", "public_price", "image_rights_status", "publish_supplier_image"]
    )
  );

  const cats = {};
  for (const c of candidates) cats[c.public.category] = (cats[c.public.category] || 0) + 1;
  console.log(JSON.stringify({ source_rows: records.length, telecom_selectable: candidates.length, categories: cats }, null, 2));
  console.log(`\nWrote opening-catalog-287.json / .csv to ${outDir}/`);
}

// Only run as CLI (allow importing toCandidate in tests).
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("export-opening-candidates.mjs")) {
  main();
}

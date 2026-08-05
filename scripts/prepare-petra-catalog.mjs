#!/usr/bin/env node
// ============================================================================
// prepare-petra-catalog.mjs  --  SAFE DRY-RUN Petra catalog preparation
//
// Reads a Petra "All Products with Quantity on Hand" CSV export, validates and
// normalizes it, keeps supplier-controlled values strictly separate from
// curated storefront values, detects duplicates, applies an explicit pricing
// rule (else request-quote), selects a telecom opening catalog, and writes
// review artifacts to an ignored local directory.
//
// GUARANTEES:
//   * No database connection of any kind.
//   * No network access.
//   * No credentials, tokens, or supplier wholesale cost written to any output.
//   * Deterministic output for a given input (no timestamps, no randomness).
//
// Usage:
//   node scripts/prepare-petra-catalog.mjs <source.csv> [--out tmp/catalog-prep]
//   node scripts/prepare-petra-catalog.mjs <source.csv> --min 25 --max 50
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
  findHeaderLineIndex,
  validateColumns,
  transformRow,
  detectDuplicates,
  selectOpeningCatalog,
  isSelectable,
} from "./lib/petra-transform.mjs";

const require = createRequire(import.meta.url);
const Papa = require("papaparse");

function parseArgs(argv) {
  const args = { _: [], out: "tmp/catalog-prep", min: 25, max: 50 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") args.out = argv[++i];
    else if (a === "--min") args.min = Number(argv[++i]);
    else if (a === "--max") args.max = Number(argv[++i]);
    else args._.push(a);
  }
  return args;
}

// Minimal CSV writer with RFC-4180 quoting. Never emits raw newlines unquoted.
function toCsv(rows, columns) {
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const out = [columns.join(",")];
  for (const r of rows) out.push(columns.map((c) => esc(r[c])).join(","));
  return out.join("\n") + "\n";
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const src = args._[0];
  if (!src) {
    console.error("Usage: node scripts/prepare-petra-catalog.mjs <source.csv> [--out dir] [--min N] [--max N]");
    process.exit(2);
  }
  if (!fs.existsSync(src)) {
    console.error(`Source file not found: ${src}`);
    process.exit(2);
  }

  const raw = fs.readFileSync(src, "utf8");
  const lines = raw.split(/\r?\n/);
  const headerIdx = findHeaderLineIndex(lines);
  if (headerIdx === -1) {
    console.error("Could not locate the Petra column header (needs 'PETRA SKU' and 'VENDOR SKU').");
    process.exit(1);
  }

  const body = lines.slice(headerIdx).join("\n");
  const parsed = Papa.parse(body, { header: true, skipEmptyLines: "greedy" });
  const fields = parsed.meta.fields || [];
  const colCheck = validateColumns(fields);
  if (!colCheck.ok) {
    console.error(`Missing required columns: ${colCheck.missing.join(", ")}`);
    process.exit(1);
  }

  const dataRows = parsed.data.filter((r) => (r["PETRA SKU"] || "").trim());
  const records = dataRows.map((r, i) => transformRow(r, i));
  const duplicates = detectDuplicates(records);

  const selected = selectOpeningCatalog(records, { min: args.min, max: args.max });
  const selectedRows = new Set(selected.map((r) => r.sourceRow));

  // --- Partition for reporting ---
  const rejected = records.filter((r) => !isSelectable(r) && !selectedRows.has(r.sourceRow));
  // Manual review is scoped to the proposed opening catalog: these are the
  // concrete sign-off tasks standing between the dry run and a real import.
  const needsReview = (r) =>
    r.flags.includes("request_quote") ||
    r.flags.includes("image_rights_review") ||
    r.flags.includes("public_sku_review") ||
    r.flags.includes("missing_gtin") ||
    r.flags.some((f) => f.startsWith("gtin_"));
  const manualReview = selected.filter(needsReview);

  // --- Build public opening-catalog records (NO cost, NO supplier internals) --
  const publicCatalog = selected.map((r, i) => ({
    id: `petra-${String(i + 1).padStart(4, "0")}`,
    proposed_public_sku: r.curated.proposed_public_sku,
    supplier_sku: r.supplier.supplier_sku, // kept for traceability; NOT products.sku
    brand: r.curated.brand,
    title: r.curated.title,
    category: r.curated.category,
    condition: r.curated.condition,
    manufacturer_mpn: r.curated.manufacturer_mpn,
    gtin: r.curated.gtin,
    slug: r.curated.slug,
    short_description: r.curated.short_description,
    long_description: r.curated.long_description,
    price: r.curated.price,
    currency_code: r.curated.currency_code,
    pricing_mode: r.curated.pricing_mode,
    status: r.curated.status,
    image_source_url: r.curated.image_ref,
    image_rights: r.curated.image_rights,
    supplier_available: r.supplier.supplier_available,
    review_flags: r.flags,
  }));

  // --- Deterministic summary (no timestamps) ---
  const categories = {};
  for (const p of publicCatalog) categories[p.category] = (categories[p.category] || 0) + 1;
  const summary = {
    source_filename: path.basename(src),
    source_data_rows: records.length,
    accepted_selectable: records.filter(isSelectable).length,
    rejected_count: rejected.length,
    duplicate_pairs: duplicates.length,
    manual_review_count: manualReview.length,
    selected_for_opening_catalog: publicCatalog.length,
    categories,
    with_usable_image: publicCatalog.filter((p) => p.image_source_url).length,
    request_quote: publicCatalog.filter((p) => p.pricing_mode === "request_quote").length,
    proposed_retail: publicCatalog.filter((p) => p.pricing_mode === "retail").length,
    images_pending_rights_review: publicCatalog.filter((p) => p.image_rights === "rights_review_required").length,
    // Actionable sign-off tasks for the SELECTED opening catalog only.
    opening_review_tasks: {
      image_rights: publicCatalog.filter((p) => p.image_rights === "rights_review_required").length,
      missing_or_invalid_gtin: publicCatalog.filter((p) => !p.gtin).length,
      public_sku_assignment: publicCatalog.filter((p) => p.review_flags.includes("public_sku_review")).length,
      request_quote: publicCatalog.filter((p) => p.pricing_mode === "request_quote").length,
    },
    // Full-catalog context (not all actionable now).
    supplier_rows_with_supplier_image: records.filter((r) => r.curated.image_ref).length,
  };

  // --- Write artifacts (all under the ignored prep dir) ---
  const outDir = args.out;
  fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(path.join(outDir, "opening-catalog.json"), JSON.stringify(publicCatalog, null, 2) + "\n");
  fs.writeFileSync(
    path.join(outDir, "opening-catalog.csv"),
    toCsv(publicCatalog, [
      "id",
      "proposed_public_sku",
      "supplier_sku",
      "brand",
      "title",
      "category",
      "condition",
      "manufacturer_mpn",
      "gtin",
      "price",
      "currency_code",
      "pricing_mode",
      "status",
      "image_rights",
      "supplier_available",
    ])
  );
  fs.writeFileSync(
    path.join(outDir, "rejected-products.csv"),
    toCsv(
      rejected.map((r) => ({
        source_row: r.sourceRow,
        supplier_sku: r.supplier.supplier_sku,
        brand: r.curated.brand,
        title: r.curated.title,
        reasons: r.flags.join("|"),
      })),
      ["source_row", "supplier_sku", "brand", "title", "reasons"]
    )
  );
  fs.writeFileSync(
    path.join(outDir, "duplicate-report.csv"),
    toCsv(
      duplicates.map((d) => ({ type: d.type, key: d.key, first_row: d.rows[0], duplicate_row: d.rows[1] })),
      ["type", "key", "first_row", "duplicate_row"]
    )
  );
  fs.writeFileSync(
    path.join(outDir, "manual-review.csv"),
    toCsv(
      manualReview.map((r) => ({
        source_row: r.sourceRow,
        supplier_sku: r.supplier.supplier_sku,
        proposed_public_sku: r.curated.proposed_public_sku,
        brand: r.curated.brand,
        title: r.curated.title,
        category: r.curated.category || "(none)",
        pricing_mode: r.curated.pricing_mode,
        review_flags: r.flags.join("|"),
      })),
      ["source_row", "supplier_sku", "proposed_public_sku", "brand", "title", "category", "pricing_mode", "review_flags"]
    )
  );
  fs.writeFileSync(path.join(outDir, "import-summary.json"), JSON.stringify(summary, null, 2) + "\n");

  // --- Console report (safe fields only) ---
  console.log("=== Petra catalog dry-run (no DB, no writes to production) ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nArtifacts written to: ${outDir}/`);
}

main();

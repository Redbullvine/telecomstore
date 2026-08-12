// ============================================================================
// Build the published General Merchandise Shop catalog from a Petra workbook.
//
//   node scripts/build-general-merchandise-catalog.mjs --source "Petra_Products.xlsx"
//
// Writes:
//   public/data/marketplace-catalog.json        published, public-contract only
//   docs/general-merchandise-build-report.md    aggregate counts (tracked)
//   tmp/general-merchandise/private-review.csv  cost/MAP/MSRP/supplier SKU
//                                               (gitignored — never publish)
//
// The workbook itself stays untracked. Every record is passed through
// assertPublicRecordClean() before it is written, so the build fails closed
// rather than publishing a supplier-private field.
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { buildCatalog, DEPARTMENT_NAMES } from "./lib/general-merchandise.mjs";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const ROOT = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const sourcePath = path.resolve(ROOT, arg("--source", "Petra_Products.xlsx"));
const outputPath = path.resolve(ROOT, arg("--out", "public/data/marketplace-catalog.json"));
const reportPath = path.resolve(ROOT, arg("--report", "docs/general-merchandise-build-report.md"));
const privateDir = path.resolve(ROOT, arg("--private-out", "tmp/general-merchandise"));

if (!fs.existsSync(sourcePath)) {
  console.error(`Source workbook not found: ${sourcePath}`);
  process.exit(1);
}
if (!/\.xlsx$/i.test(sourcePath)) {
  console.error("The source must be an .xlsx workbook.");
  process.exit(1);
}

// The Petra export carries two report-preamble lines before the column header.
const workbook = XLSX.readFile(sourcePath, { raw: true, cellDates: false });
const sheetName = workbook.SheetNames[0];
const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { range: 2, defval: null, raw: true })
  .filter((row) => String(row["VENDOR SKU"] ?? "").trim() || String(row["PETRA SKU"] ?? "").trim());

const sourceBytes = fs.readFileSync(sourcePath);
const sourceSha256 = crypto.createHash("sha256").update(sourceBytes).digest("hex");

// Only products with a REAL photo are published (Danny, 2026-08-12). The
// workbook lists an image URL for every row, but 82 are absent from the supplier
// bucket, so the allowlist produced by scripts/audit-shop-images.mjs is the
// authority. The build fails closed if that audit is missing rather than
// publishing products whose images were never verified.
const auditPath = path.resolve(ROOT, "scripts/data/shop-image-audit.json");
if (!fs.existsSync(auditPath)) {
  console.error("Image audit not found. Run: node scripts/audit-shop-images.mjs");
  console.error("It records which supplier images actually exist, and the shop publishes only those.");
  process.exit(1);
}
const audit = JSON.parse(fs.readFileSync(auditPath, "utf8"));
const availableImages = new Set(audit.available_files || []);

const { built: allBuilt, skipped } = buildCatalog(rows);
const withoutPhoto = [];
const built = allBuilt.filter((item) => {
  const file = String(item.record.image_url || "").replace("/shop-images/", "");
  if (file && availableImages.has(file)) return true;
  withoutPhoto.push({ sku: item.record.sku, file: file || "(none)" });
  return false;
});
const records = built.map((item) => item.record);

// --- Aggregate counts --------------------------------------------------------

const byDepartment = {};
for (const record of records) {
  byDepartment[record.department_slug] = (byDepartment[record.department_slug] || 0) + 1;
}
const priced = records.filter((record) => record.public_price !== null);
const clearance = records.filter((record) => record.clearance);
const withImage = records.filter((record) => record.image_url);
const withGtin = records.filter((record) => record.gtin);
const inStock = records.filter((record) => /^In stock/.test(record.availability));
const mapFloor = built.filter((item) => item.priceBasis === "map_floor");
const flagCounts = {};
for (const item of built) {
  for (const flag of item.flags) flagCounts[flag] = (flagCounts[flag] || 0) + 1;
}
const skipReasons = {};
for (const item of skipped) skipReasons[item.reason] = (skipReasons[item.reason] || 0) + 1;

// MSRP is review evidence only: report how many published prices sit above the
// manufacturer's suggested retail so the overage is visible, never hidden.
let aboveMsrp = 0;
built.forEach((item, index) => {
  const row = rows[item.sourceRow - 1] || {};
  const msrp = Number(String(row["MSRP"] ?? "").replace(/[$,\s]/g, ""));
  if (Number.isFinite(msrp) && msrp > 0 && item.record.public_price !== null && item.record.public_price > msrp) {
    aboveMsrp += 1;
  }
  void index;
});

// --- Published artifact ------------------------------------------------------

// The shop filters the whole catalog client-side, so the list payload must stay
// small. Two reductions, both lossless:
//   1. meta_title / meta_description / image_alt are dropped. Each is just the
//      title or short description plus a fixed suffix, and sanitizeMarketplace-
//      Product() derives them on read, so shipping them would be ~0.7 MB of
//      duplicated text.
//   2. long_description (the spec bullets) moves to a details file that is
//      fetched only when a product page is opened — 1.17 MB the grid never uses.
const LIST_OMITTED = new Set(["long_description", "meta_title", "meta_description", "image_alt"]);
const listRecords = records.map((record) => {
  const trimmed = {};
  for (const [key, value] of Object.entries(record)) {
    if (!LIST_OMITTED.has(key)) trimmed[key] = value;
  }
  return trimmed;
});

const payload = {
  // Metadata is deliberately non-identifying: no filename, no supplier terms.
  generated_from: "supplier catalog workbook",
  source_sha256: sourceSha256,
  schema: "marketplace-public-v1",
  pricing_rule: "cost + 60% of the cost-to-MSRP spread; minimum 15% / $1.00 margin where it fits under MSRP; MAP is a hard floor",
  product_count: listRecords.length,
  departments: Object.keys(byDepartment).sort(),
  products: listRecords,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 0)}\n`, "utf8");

// A tiny bundled summary so the storefront homepage can advertise the shop with
// real counts without fetching the 2 MB catalog. Kept in src/data because it is
// imported at build time, and it holds no product rows.
const summaryPath = path.resolve(ROOT, "src/data/marketplace-summary.json");
const summary = {
  product_count: records.length,
  clearance_count: clearance.length,
  departments: Object.entries(byDepartment)
    .map(([slug, count]) => ({ slug, name: DEPARTMENT_NAMES[slug] || slug, count }))
    .sort((a, b) => b.count - a.count),
};
fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

const detailsPath = path.resolve(path.dirname(outputPath), "marketplace-details.json");
const details = {};
for (const record of records) {
  if (record.long_description) details[record.slug] = record.long_description;
}
fs.writeFileSync(detailsPath, `${JSON.stringify({ schema: "marketplace-details-v1", details }, null, 0)}\n`, "utf8");

// --- Private review file (gitignored) ---------------------------------------

fs.mkdirSync(privateDir, { recursive: true });
const csvEscape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
const privateRows = [
  ["public_sku", "supplier_sku", "dealer_cost", "map", "msrp", "public_price", "price_basis", "department", "available", "discontinued"].join(","),
];
for (const item of built) {
  const row = rows[item.sourceRow - 1] || {};
  privateRows.push([
    csvEscape(item.record.sku),
    csvEscape(row["PETRA SKU"]),
    csvEscape(row["PRICE"]),
    csvEscape(row["MAP"]),
    csvEscape(row["MSRP"]),
    csvEscape(item.record.public_price ?? ""),
    csvEscape(item.priceBasis ?? ""),
    csvEscape(item.record.department_slug),
    csvEscape(row["AVAILABLE"]),
    csvEscape(item.flags.includes("discontinued") ? "Y" : "N"),
  ].join(","));
}
fs.writeFileSync(path.join(privateDir, "private-review.csv"), `${privateRows.join("\n")}\n`, "utf8");

// --- Tracked report (aggregates only) ---------------------------------------

const pct = (count) => `${((count / Math.max(records.length, 1)) * 100).toFixed(1)}%`;
const departmentTable = Object.entries(byDepartment)
  .sort((a, b) => b[1] - a[1])
  .map(([slug, count]) => `| ${DEPARTMENT_NAMES[slug] || slug} | \`${slug}\` | ${count} |`)
  .join("\n");
const flagTable = Object.entries(flagCounts)
  .sort((a, b) => b[1] - a[1])
  .map(([flag, count]) => `| \`${flag}\` | ${count} |`)
  .join("\n");

const report = `# General Merchandise Shop build report

Generated by \`scripts/build-general-merchandise-catalog.mjs\`. Aggregate counts
only — the workbook, supplier SKUs, dealer costs, and MAP/MSRP values stay in
the gitignored private review file.

- Source rows read: **${rows.length}**
- Published products: **${records.length}**
- Source SHA-256: \`${sourceSha256}\`
- Sheet: \`${sheetName}\`

## Publication state

| Measure | Count | Share |
| --- | --- | --- |
| Priced (\`price_mode: fixed\`) | ${priced.length} | ${pct(priced.length)} |
| Request-a-quote | ${records.length - priced.length} | ${pct(records.length - priced.length)} |
| Priced at the MAP floor | ${mapFloor.length} | ${pct(mapFloor.length)} |
| In stock now | ${inStock.length} | ${pct(inStock.length)} |
| Clearance (Deals) | ${clearance.length} | ${pct(clearance.length)} |
| With a product image | ${withImage.length} | ${pct(withImage.length)} |
| With a checksum-valid GTIN | ${withGtin.length} | ${pct(withGtin.length)} |
| GTIN recovered by restoring Excel's dropped leading zero | ${flagCounts.gtin_leading_zero_restored || 0} | ${pct(flagCounts.gtin_leading_zero_restored || 0)} |
| Refurbished condition | ${records.filter((record) => record.condition === "refurbished").length} | — |

## Google Shopping readiness

Every published record carries the Merchant Center essentials: \`title\`,
\`short_description\`, \`image_url\`, \`brand\`, \`condition\`, \`price\`,
\`availability\`, \`google_product_category\` (top-level taxonomy only, which is
safe to assert) and a full \`product_type\` path. **${withGtin.length}** records
carry a verified GTIN and **${records.filter((record) => !record.gtin && record.manufacturer_mpn).length}**
rely on brand + MPN identification instead.

## Departments

| Department | Slug | Products |
| --- | --- | --- |
${departmentTable}

## Pricing note

The published price is **dealer cost x 2**, raised to MAP where MAP is higher
(authorized 2026-08-10). **${aboveMsrp}** published prices land above the
manufacturer's suggested retail price in the source workbook. MSRP is not
published and is recorded only in the private review file; this count is here so
the overage is reviewable rather than silent.

## Row flags

| Flag | Rows |
| --- | --- |
${flagTable}

## Skipped rows

${Object.entries(skipReasons).map(([reason, count]) => `- \`${reason}\`: ${count}`).join("\n") || "- none"}

## Excluded for having no photo

Only products whose supplier image is confirmed to exist are published. The
workbook supplies an image URL for every row, but **${audit.missing_count}** of
them are absent from the supplier bucket (HTTP 403), so **${withoutPhoto.length}**
products were withheld. Regenerate the allowlist with
\`node scripts/audit-shop-images.mjs\`.
`;

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, report, "utf8");

const bytes = fs.statSync(outputPath).size;
const detailBytes = fs.statSync(detailsPath).size;
console.log(`Read ${rows.length} source rows from ${sheetName}.`);
console.log(`Pricing: ${payload.pricing_rule}.`);
console.log(`Excluded ${withoutPhoto.length} products with no verified photo (image audit: ${audit.available} available, ${audit.missing_count} missing).`);
console.log(`Published ${records.length} products (${priced.length} priced, ${clearance.length} clearance, ${withImage.length} with images).`);
console.log(`Departments: ${Object.entries(byDepartment).sort((a, b) => b[1] - a[1]).map(([slug, count]) => `${slug}=${count}`).join(", ")}`);
console.log(`Skipped ${skipped.length} rows: ${Object.entries(skipReasons).map(([reason, count]) => `${reason}=${count}`).join(", ") || "none"}`);
console.log(`${aboveMsrp} published prices exceed the source MSRP (see the report).`);
console.log(`Wrote ${path.relative(ROOT, outputPath)} (${(bytes / 1048576).toFixed(2)} MB list)`);
console.log(`Wrote ${path.relative(ROOT, detailsPath)} (${(detailBytes / 1048576).toFixed(2)} MB, fetched only on product pages)`);
console.log(`Wrote ${path.relative(ROOT, reportPath)}`);
console.log(`Wrote private review CSV under ${path.relative(ROOT, privateDir)} (gitignored)`);

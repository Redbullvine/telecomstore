import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import Papa from "papaparse";
import { summarizeMarketplace, transformMarketplaceRows } from "./lib/petra-marketplace.mjs";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
const arg = (name) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const source = path.resolve(arg("--source") || "");
const prior = arg("--prior") ? path.resolve(arg("--prior")) : null;
const outputDir = path.resolve(arg("--output") || "tmp/petra-marketplace-dry-run");
const reportPath = path.resolve(arg("--report") || "docs/petra-marketplace-dry-run-report.md");

if (!source || !fs.existsSync(source)) throw new Error("A readable --source workbook is required");
if (!/\.xlsx$/i.test(source)) throw new Error("The authoritative source must be an .xlsx workbook");
if (source.toLowerCase().startsWith(process.cwd().toLowerCase() + path.sep)) throw new Error("The private workbook must remain outside the repository");
if (!outputDir.toLowerCase().startsWith(path.resolve("tmp").toLowerCase() + path.sep)) throw new Error("Private dry-run output must stay below the ignored tmp directory");

function loadRows(file) {
  if (/\.xlsx$/i.test(file)) {
    const workbook = XLSX.readFile(file, { raw: true, cellDates: false });
    return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { range: 2, defval: null, raw: true });
  }
  const csv = fs.readFileSync(file, "utf8").split(/\r?\n/).slice(2).join("\n");
  const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true });
  if (parsed.errors.length) throw new Error(parsed.errors.map((error) => error.message).join("; "));
  return parsed.data;
}

function generatedAt(file) {
  const workbook = XLSX.readFile(file, { raw: true });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, range: "A1:D2", raw: true });
  const serial = Number(rows?.[1]?.[1]);
  const time = String(rows?.[1]?.[3] || "").toLowerCase();
  const day = Number.isFinite(serial) ? new Date((serial - 25569) * 86400000).toISOString().slice(0, 10) : null;
  const match = time.match(/^(\d{1,2}):(\d{2}):(\d{2})(am|pm)$/);
  if (!day || !match) return null;
  let hour = Number(match[1]) % 12;
  if (match[4] === "pm") hour += 12;
  return `${day}T${String(hour).padStart(2, "0")}:${match[2]}:${match[3]}-05:00`;
}

function delta(previous, current) {
  if (!previous) return null;
  const key = (row) => String(row["PETRA SKU"] || "").trim().toUpperCase();
  const money = (value) => Number(String(value ?? "").replace(/[$,]/g, "")) || 0;
  const text = (value) => String(value ?? "").trim();
  const before = new Map(previous.map((row) => [key(row), row]));
  const after = new Map(current.map((row) => [key(row), row]));
  const common = [...after.keys()].filter((sku) => before.has(sku));
  return {
    additions: [...after.keys()].filter((sku) => !before.has(sku)).length,
    removals: [...before.keys()].filter((sku) => !after.has(sku)).length,
    cost_changes: common.filter((sku) => money(before.get(sku).PRICE) !== money(after.get(sku).PRICE)).length,
    map_changes: common.filter((sku) => money(before.get(sku).MAP) !== money(after.get(sku).MAP)).length,
    msrp_changes: common.filter((sku) => money(before.get(sku).MSRP) !== money(after.get(sku).MSRP)).length,
    newly_in_stock: common.filter((sku) => !(money(before.get(sku).AVAILABLE) > 0) && money(after.get(sku).AVAILABLE) > 0).length,
    newly_out_of_stock: common.filter((sku) => money(before.get(sku).AVAILABLE) > 0 && !(money(after.get(sku).AVAILABLE) > 0)).length,
    newly_discontinued: common.filter((sku) => !/discontinued/i.test(text(before.get(sku).NOTES1)) && /discontinued/i.test(text(after.get(sku).NOTES1))).length,
    image_changes: common.filter((sku) => text(before.get(sku)["IMAGE URL"]) !== text(after.get(sku)["IMAGE URL"])).length,
  };
}

const rows = loadRows(source);
const supplierSkus = rows.map((row) => String(row["PETRA SKU"] || "").trim().toUpperCase());
if (rows.length !== 2587) throw new Error(`Expected 2,587 supplier rows, received ${rows.length}`);
if (supplierSkus.some((sku) => !sku) || new Set(supplierSkus).size !== rows.length) throw new Error("Every row must have one unique PETRA SKU");

const records = transformMarketplaceRows(rows);
const summary = summarizeMarketplace(records, {
  filename: path.basename(source),
  generated_at: generatedAt(source),
  sha256: await import("node:crypto").then(({ default: crypto }) => crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex")),
});
summary.refresh_delta = prior && fs.existsSync(prior) ? delta(loadRows(prior), rows) : null;
summary.gtin_fallback_matching_enabled = summary.invalid_or_missing_gtin_total === 0;

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, "private-import-plan.json"), `${JSON.stringify(records, null, 2)}\n`);
fs.writeFileSync(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);

const departments = Object.entries(summary.department_totals).map(([name, count]) => `| ${name} | ${count.toLocaleString()} |`).join("\n");
const pricing = Object.entries(summary.pricing_status_totals).map(([name, count]) => `| ${name} | ${count.toLocaleString()} |`).join("\n");
const gtinQuality = Object.entries(summary.gtin_status_totals).map(([name, count]) => `| ${name} | ${count.toLocaleString()} |`).join("\n");
const refresh = summary.refresh_delta ? Object.entries(summary.refresh_delta).map(([name, count]) => `| ${name.replaceAll("_", " ")} | ${count.toLocaleString()} |`).join("\n") : "| No prior snapshot supplied | — |";
const report = `# Petra Marketplace private dry-run report

Source snapshot: ${summary.source.generated_at}
Rows reconciled: ${summary.total_imported.toLocaleString()}
Unique supplier SKUs: ${summary.unique_supplier_skus.toLocaleString()}

No database, public-product, public-price, or image-publication writes were performed.

## Departments

| Department | Rows |
| --- | ---: |
${departments}

## Publication safeguards

| Check | Count |
| --- | ---: |
| Positive inventory | ${summary.in_stock_total.toLocaleString()} |
| Zero inventory (hidden) | ${summary.zero_stock_total.toLocaleString()} |
| Discontinued | ${summary.discontinued_total.toLocaleString()} |
| Discontinued with inventory (Deals review) | ${summary.discontinued_in_stock_total.toLocaleString()} |
| Restricted | ${summary.restricted_total.toLocaleString()} |
| Identity conflicts | ${summary.identity_conflict_total.toLocaleString()} |
| Unmapped departments | ${summary.unmapped_department_total.toLocaleString()} |
| Public browse candidates before manual approval | ${summary.public_browse_candidate_total.toLocaleString()} |
| Valid supplier image URLs | ${summary.image_total.toLocaleString()} |

## GTIN data quality

| Result | Rows |
| --- | ---: |
${gtinQuality}
| public browse candidates with a valid GTIN | ${summary.public_candidates_with_valid_gtin_total.toLocaleString()} |

GTIN fallback matching is **disabled for this snapshot**. The export contains widespread truncation/rounding, so even values that happen to pass a checksum cannot be treated as authoritative. Raw values are retained only inside the ignored private dry-run artifact for later remediation.

## Pricing review

| Status | Count |
| --- | ---: |
${pricing}

These are review classifications, not approved public prices. Even price_ready records still require market review and Danny's approval before publication.

## Refresh delta versus the prior private snapshot

| Change | Rows |
| --- | ---: |
${refresh}

All calculations remain private. No supplier cost, MAP, MSRP, margin, supplier SKU, supplier identity, or raw feed value is included in this report.
`;
fs.writeFileSync(reportPath, report);
console.log(JSON.stringify(summary, null, 2));

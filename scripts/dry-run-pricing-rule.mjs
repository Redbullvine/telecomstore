// ============================================================================
// Pricing rule dry run — REPORT ONLY. Writes nothing, changes nothing.
//
//   node scripts/dry-run-pricing-rule.mjs --source "Petra_Products.xlsx"
//
// Applies the authorized Telecom Store rule
//
//     Our Price = Cost + ((MSRP - Cost) * 0.65)
//
// to every row of the supplier workbook and reports the outcome. Petra's Cost,
// MSRP, and MAP are read only. No catalog, feed, or database is touched, so this
// is safe to run before approval.
//
// Optional: --private-out <dir> also writes a per-SKU CSV for review. That file
// contains dealer cost and MSRP, so it must stay under the gitignored tmp/ tree.
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { telecomStorePrice, PRICE_POSITION } from "./lib/general-merchandise.mjs";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const ROOT = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const sourcePath = path.resolve(ROOT, arg("--source", "Petra_Products.xlsx"));
if (!fs.existsSync(sourcePath)) {
  console.error(`Source workbook not found: ${sourcePath}`);
  process.exit(1);
}

const workbook = XLSX.readFile(sourcePath, { raw: true, cellDates: false });
const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { range: 2, defval: null, raw: true })
  .filter((row) => String(row["VENDOR SKU"] ?? "").trim() || String(row["PETRA SKU"] ?? "").trim());

const num = (input) => {
  const cleaned = String(input ?? "").replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

const priced = [];
const blockedByMap = [];
const msrpNotAboveCost = [];
const missingInputs = [];
const invalidInputs = [];
let belowCost = 0;

// Comparison against what is published today (the superseded cost x 2 rule).
let increases = 0;
let decreases = 0;
let unchanged = 0;

for (const row of rows) {
  const sku = String(row["VENDOR SKU"] ?? "").trim() || String(row["PETRA SKU"] ?? "").trim();
  const cost = num(row["PRICE"]);
  const msrp = num(row["MSRP"]);
  const map = num(row["MAP"]);
  const result = telecomStorePrice({ cost: row["PRICE"], msrp: row["MSRP"], map: row["MAP"] });

  if (result.status !== "priced") {
    const record = { sku, cost, msrp, map, reason: result.reason };
    if (result.reason === "msrp_not_above_cost") msrpNotAboveCost.push(record);
    else if (result.reason === "missing_cost" || result.reason === "missing_msrp") missingInputs.push(record);
    else invalidInputs.push(record);
    continue;
  }

  const price = result.publicPrice;
  if (price < cost) belowCost += 1;
  // Gross margin as a share of the selling price.
  const marginPct = ((price - cost) / price) * 100;
  const entry = { sku, cost, msrp, map, price, basis: result.basis, marginPct, marginDollars: price - cost };
  priced.push(entry);
  if (result.basis === "map_floor") blockedByMap.push(entry);

  const previous = Math.round((cost * 2 + Number.EPSILON) * 100) / 100;
  const previousWithMap = map !== null && map > previous ? map : previous;
  if (price > previousWithMap + 0.005) increases += 1;
  else if (price < previousWithMap - 0.005) decreases += 1;
  else unchanged += 1;
}

priced.sort((a, b) => a.marginPct - b.marginPct);
const lowest = priced[0];
const highest = priced[priced.length - 1];
const median = priced[Math.floor(priced.length / 2)];
const totalMarginDollars = priced.reduce((sum, item) => sum + item.marginDollars, 0);

const pct = (count) => `${((count / Math.max(rows.length, 1)) * 100).toFixed(1)}%`;
const money = (value) => `$${Number(value).toFixed(2)}`;

console.log("");
console.log("=".repeat(72));
console.log("  PRICING RULE DRY RUN — no data changed");
console.log("=".repeat(72));
console.log(`  Rule:   Our Price = Cost + ((MSRP - Cost) * ${PRICE_POSITION})`);
console.log(`  Source: ${path.basename(sourcePath)} — ${rows.length} rows`);
console.log("");

console.log("  OUTCOME");
console.log("  " + "-".repeat(70));
console.log(`  Repriced (public price calculated)      ${String(priced.length).padStart(6)}   ${pct(priced.length)}`);
console.log(`    of which raised to the MAP floor      ${String(blockedByMap.length).padStart(6)}   ${pct(blockedByMap.length)}`);
console.log(`  Blocked — MSRP <= Cost (review)         ${String(msrpNotAboveCost.length).padStart(6)}   ${pct(msrpNotAboveCost.length)}`);
console.log(`  Blocked — MSRP or Cost missing (review) ${String(missingInputs.length).padStart(6)}   ${pct(missingInputs.length)}`);
console.log(`  Blocked — MSRP or Cost invalid (review) ${String(invalidInputs.length).padStart(6)}   ${pct(invalidInputs.length)}`);
console.log(`  Published below dealer cost             ${String(belowCost).padStart(6)}   (rule 2 requires 0)`);
console.log("");

console.log("  RESULTING MARGIN (share of selling price)");
console.log("  " + "-".repeat(70));
if (priced.length) {
  console.log(`  Lowest   ${lowest.marginPct.toFixed(1).padStart(5)}%   ${lowest.sku} — cost ${money(lowest.cost)}, MSRP ${money(lowest.msrp)}, price ${money(lowest.price)}${lowest.basis === "map_floor" ? " (MAP)" : ""}`);
  console.log(`  Median   ${median.marginPct.toFixed(1).padStart(5)}%   ${median.sku} — cost ${money(median.cost)}, MSRP ${money(median.msrp)}, price ${money(median.price)}`);
  console.log(`  Highest  ${highest.marginPct.toFixed(1).padStart(5)}%   ${highest.sku} — cost ${money(highest.cost)}, MSRP ${money(highest.msrp)}, price ${money(highest.price)}${highest.basis === "map_floor" ? " (MAP)" : ""}`);
  console.log(`  Total gross margin across the catalog at one unit each: ${money(totalMarginDollars)}`);
} else {
  console.log("  No products were priced.");
}
console.log("");

console.log("  CHANGE VS THE CURRENTLY PUBLISHED cost x 2 PRICES");
console.log("  " + "-".repeat(70));
console.log(`  Price goes down  ${String(decreases).padStart(6)}   ${pct(decreases)}`);
console.log(`  Price goes up    ${String(increases).padStart(6)}   ${pct(increases)}`);
console.log(`  Unchanged        ${String(unchanged).padStart(6)}   ${pct(unchanged)}`);
console.log("");

if (msrpNotAboveCost.length) {
  console.log(`  PRODUCTS FLAGGED FOR REVIEW — MSRP <= Cost (${msrpNotAboveCost.length}, showing up to 15)`);
  console.log("  " + "-".repeat(70));
  for (const item of msrpNotAboveCost.slice(0, 15)) {
    console.log(`  ${item.sku.padEnd(22)} cost ${money(item.cost).padStart(9)}   MSRP ${money(item.msrp).padStart(9)}`);
  }
  console.log("");
}
if (missingInputs.length || invalidInputs.length) {
  console.log(`  PRODUCTS FLAGGED FOR REVIEW — missing/invalid inputs (${missingInputs.length + invalidInputs.length})`);
  console.log("  " + "-".repeat(70));
  for (const item of [...missingInputs, ...invalidInputs].slice(0, 15)) {
    console.log(`  ${item.sku.padEnd(22)} cost ${String(item.cost ?? "—").padStart(9)}   MSRP ${String(item.msrp ?? "—").padStart(9)}   ${item.reason}`);
  }
  console.log("");
}

console.log("  Nothing was written. The published catalog still carries the previous");
console.log("  prices. Approve, then run: npm run build:shop");
console.log("=".repeat(72));
console.log("");

const privateOut = arg("--private-out", null);
if (privateOut) {
  const dir = path.resolve(ROOT, privateOut);
  fs.mkdirSync(dir, { recursive: true });
  const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const lines = [["public_sku", "dealer_cost", "msrp", "map", "our_price", "basis", "margin_pct", "status", "reason"].join(",")];
  for (const item of priced) {
    lines.push([item.sku, item.cost, item.msrp, item.map ?? "", item.price, item.basis, item.marginPct.toFixed(2), "priced", ""].map(escape).join(","));
  }
  for (const item of [...msrpNotAboveCost, ...missingInputs, ...invalidInputs]) {
    lines.push([item.sku, item.cost ?? "", item.msrp ?? "", item.map ?? "", "", "", "", "review", item.reason].map(escape).join(","));
  }
  const file = path.join(dir, "pricing-dry-run.csv");
  fs.writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
  console.log(`Per-SKU review CSV: ${path.relative(ROOT, file)} (private — gitignored)`);
  console.log("");
}

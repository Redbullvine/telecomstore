// ============================================================================
// Build the server-side commerce record for the General Merchandise Shop.
//
//   node scripts/build-marketplace-commerce.mjs --source "Petra_Products.xlsx"
//
// Writes netlify/functions/_shared/marketplace-commerce.json — the TRUSTED
// server-side source the checkout function reads. The browser never decides a
// price or a shipping cost; it sends only {sku, quantity} and everything else is
// resolved here (see netlify/functions/_shared/checkout-core.mjs).
//
// This file is written SEPARATELY from _shared/opening-pricing.json so the live
// telecom payment configuration is never rewritten by a catalog build.
//
// `checkout_active` stays FALSE for every row until FedEx rating is live and
// verified. Nothing here can be purchased while that flag is false.
//
// Cart eligibility (Danny, 2026-08-12): quote-only for anything Petra flags as
// dealer/territory restricted or lithium-battery, since those cannot go through a
// generic online channel or a standard air rate. Everything else is rateable via
// FedEx from Petra's blind-ship origin 73013, which needs real weight AND
// dimensions — both are present on every eligible row.
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const ROOT = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

export const SHIP_ORIGIN_POSTAL_CODE = "73013";

// Petra's own notes are the authority on what may not be sold online.
const RESTRICTION_PATTERN = /ship only in us|territor|cannot be sold|may not be sold|resale restriction|authorized dealer|dealer agreement|internet|online sale/i;
const LITHIUM_PATTERN = /lithium/i;

const number = (value) => {
  const parsed = Number(String(value ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

// FedEx rejects a package beyond these limits; such an item needs a manual quote.
function oversize(length, width, height) {
  const girth = length + 2 * (width + height);
  return girth > 165 || Math.max(length, width, height) > 108;
}

export function shippingEligibility(row) {
  const notes = `${row["NOTES1"] ?? ""} ${row["NOTES2"] ?? ""}`;
  if (RESTRICTION_PATTERN.test(notes)) return { eligible: false, reason: "sale_or_territory_restricted" };
  if (LITHIUM_PATTERN.test(notes)) return { eligible: false, reason: "lithium_battery" };

  const weight = number(row["ESTIMATED SHIP WEIGHT"]) || number(row["WEIGHT-UNPACKED"]);
  if (!weight) return { eligible: false, reason: "missing_weight" };
  const length = number(row["LENGTH"]);
  const width = number(row["WIDTH"]);
  const height = number(row["HEIGHT"]);
  if (!length || !width || !height) return { eligible: false, reason: "missing_dimensions" };
  if (oversize(length, width, height)) return { eligible: false, reason: "oversize_freight" };

  return { eligible: true, reason: null, weight, length, width, height };
}

const sourcePath = path.resolve(ROOT, arg("--source", "Petra_Products.xlsx"));
const catalogPath = path.resolve(ROOT, "public/data/marketplace-catalog.json");
if (!fs.existsSync(sourcePath) || !fs.existsSync(catalogPath)) {
  console.error("Need both the workbook and the published catalog. Run npm run build:shop first.");
  process.exit(1);
}

const workbook = XLSX.readFile(sourcePath, { raw: true, cellDates: false });
const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { range: 2, defval: null, raw: true })
  .filter((row) => String(row["VENDOR SKU"] ?? "").trim());
const bySku = new Map(rows.map((row) => [String(row["VENDOR SKU"]).trim(), row]));

// Only products that are actually published and priced can ever be purchasable.
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const published = catalog.products.filter((product) => product.public_price !== null);

const records = [];
const reasons = {};
for (const product of published) {
  const row = bySku.get(product.sku);
  const eligibility = row ? shippingEligibility(row) : { eligible: false, reason: "not_in_workbook" };
  if (!eligibility.eligible) reasons[eligibility.reason] = (reasons[eligibility.reason] || 0) + 1;

  records.push({
    public_sku: product.sku,
    title: product.title,
    public_price: product.public_price,
    // The shop lists a price and confirms shipping at checkout, matching the
    // telecom catalog's mode rather than claiming an all-in fixed price.
    price_mode: "listed_price_shipping_quote",
    pricing_approved: true,
    // Held false until FedEx rating is live and verified end to end.
    checkout_active: false,
    cart_eligible: eligibility.eligible,
    ineligible_reason: eligibility.reason,
    // FedEx rating inputs. Dimensions are inches, weight is pounds.
    ship_weight_lb: eligibility.eligible ? eligibility.weight : null,
    ship_length_in: eligibility.eligible ? eligibility.length : null,
    ship_width_in: eligibility.eligible ? eligibility.width : null,
    ship_height_in: eligibility.eligible ? eligibility.height : null,
    shipping_class: eligibility.eligible ? "fedex_rated" : "manual_quote",
    taxable: true,
    automatic_tax: false,
    stripe_price_id: null,
    allowed_countries: eligibility.eligible ? ["US"] : [],
  });
}

const eligible = records.filter((record) => record.cart_eligible);
const outPath = path.resolve(ROOT, "netlify/functions/_shared/marketplace-commerce.json");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify({
  schema: "marketplace-commerce-v1",
  ship_origin_postal_code: SHIP_ORIGIN_POSTAL_CODE,
  note: "Server-side trusted commerce data. checkout_active is false for every row until FedEx rating is verified.",
  product_count: records.length,
  cart_eligible_count: eligible.length,
  products: records,
}, null, 0)}\n`, "utf8");

console.log(`Published priced products: ${records.length}`);
console.log(`Cart-eligible (FedEx rateable): ${eligible.length}`);
console.log(`Quote-only: ${records.length - eligible.length} — ${Object.entries(reasons).map(([reason, count]) => `${reason}=${count}`).join(", ")}`);
console.log(`checkout_active: ${records.filter((record) => record.checkout_active).length} (stays 0 until FedEx rating is verified)`);
console.log(`Wrote ${path.relative(ROOT, outPath)} (${(fs.statSync(outPath).size / 1048576).toFixed(2)} MB)`);

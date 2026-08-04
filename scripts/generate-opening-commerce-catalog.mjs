import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const EXCLUDED = new Set(["PSG100", "PSG200", "PSG300", "PSG400", "BHOC05"]);
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const source = arg("--source");
if (!source) throw new Error("Usage: node scripts/generate-opening-commerce-catalog.mjs --source <approved-json>");

const input = JSON.parse(fs.readFileSync(source, "utf8"));
const catalog = input.filter((row) => !EXCLUDED.has(row.public_sku)).map((row) => ({
  sku: row.public_sku,
  title: row.title,
  short_description: row.short_description || "",
  category: row.category,
  brand: row.brand || "",
  manufacturer_mpn: row.manufacturer_mpn || "",
  public_price: null,
  price_note: "Request quote",
  price_mode: "request_quote",
  pricing_approved: false,
  opening_approved: true,
  checkout_active: false,
  image_rights_status: "pending",
  public_availability: "quote_only",
  availability_text: "Availability by Quote",
  status: "available"
}));
if (catalog.length !== 206) throw new Error(`Expected 206 products after exclusions; found ${catalog.length}`);
if (new Set(catalog.map((row) => row.sku)).size !== 206) throw new Error("Public SKUs are not unique");

const root = process.cwd();
const pricingRows = catalog.map((product) => ({
  public_sku: product.sku,
  approved_title: product.title,
  public_price: "",
  price_mode: "request_quote",
  pricing_approved: "false",
  checkout_active: "false",
  shipping_class: "",
  taxable: "false",
  stripe_price_id: "",
  allowed_countries: "",
  stripe_shipping_rate_id: "",
  automatic_tax: "false",
  notes: ""
}));
const headers = Object.keys(pricingRows[0]);
const csvCell = (value) => `"${String(value).replaceAll('"', '""')}"`;
const csv = [headers.join(","), ...pricingRows.map((row) => headers.map((key) => csvCell(row[key])).join(","))].join("\n") + "\n";
const publicPricing = catalog.map((p) => ({ public_sku: p.sku, public_price: null, checkout_active: false, price_mode: "request_quote", pricing_approved: false }));
const serverPricing = catalog.map((p) => ({
  public_sku: p.sku, title: p.title, public_price: null, price_mode: "request_quote", pricing_approved: false, checkout_active: false,
  shipping_class: null, taxable: false, stripe_price_id: null, allowed_countries: [], stripe_shipping_rate_id: null, automatic_tax: false
}));

for (const dir of ["src/data", "operations", "netlify/functions/_shared"]) fs.mkdirSync(path.join(root, dir), { recursive: true });
fs.writeFileSync(path.join(root, "src/data/opening-catalog.json"), JSON.stringify(catalog, null, 2) + "\n");
fs.writeFileSync(path.join(root, "src/data/opening-pricing.json"), JSON.stringify(publicPricing, null, 2) + "\n");
fs.writeFileSync(path.join(root, "netlify/functions/_shared/opening-pricing.json"), JSON.stringify(serverPricing, null, 2) + "\n");
fs.writeFileSync(path.join(root, "operations/opening-pricing-template.csv"), csv);
console.log(`Generated ${catalog.length} sanitized products and guarded pricing artifacts.`);

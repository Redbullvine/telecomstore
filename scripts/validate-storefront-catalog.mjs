import fs from "node:fs";
import path from "node:path";
import catalog from "../src/data/opening-catalog.json" with { type: "json" };
import pricing from "../src/data/opening-pricing.json" with { type: "json" };
import taxonomy from "../src/data/catalog-taxonomy.json" with { type: "json" };
import reconciliation from "../operations/opening-catalog-reconciliation.json" with { type: "json" };

const errors = [];
const assert = (condition, message) => { if (!condition) errors.push(message); };
const unique = (values) => new Set(values).size === values.length;
const priceBySku = new Map(pricing.map((item) => [item.public_sku, item]));
const merged = catalog.map((item) => ({ ...item, ...priceBySku.get(item.sku) }));
const listed = merged.filter((item) => item.pricing_approved === true && item.price_mode === "listed_price_shipping_quote" && Number(item.public_price) > 0);
const quote = merged.filter((item) => item.price_mode === "request_quote" && item.public_price === null);
const sitemap = fs.readFileSync("public/sitemap.xml", "utf8");
const netlify = fs.readFileSync("netlify.toml", "utf8");
const serializedCatalog = JSON.stringify(catalog).toLowerCase();

assert(catalog.length === 206, `Expected 206 products; found ${catalog.length}.`);
assert(unique(catalog.map((item) => item.sku)), "Public SKUs are not unique.");
assert(unique(catalog.map((item) => item.gtin)), "GTIN values are not unique.");
assert(unique(catalog.map((item) => item.slug)), "Product slugs are not unique.");
assert(catalog.every((item) => item.title && item.brand && item.manufacturer_mpn && item.gtin && item.category && item.long_description && item.meta_title && item.meta_description && Array.isArray(item.features)), "A product is missing required public content.");
assert(catalog.every((item) => item.canonical_path === `/products/${item.slug}`), "A product canonical path does not match its slug.");
assert(taxonomy.categories.length === 7, `Expected 7 categories; found ${taxonomy.categories.length}.`);
assert(taxonomy.manufacturers.length === 26, `Expected 26 manufacturers; found ${taxonomy.manufacturers.length}.`);
assert(taxonomy.categories.reduce((sum, item) => sum + item.count, 0) === 206, "Category counts do not total 206.");
assert(taxonomy.manufacturers.reduce((sum, item) => sum + item.count, 0) === 206, "Manufacturer counts do not total 206.");
assert(listed.length === 17, `Expected 17 evidence-supported merchandise prices; found ${listed.length}.`);
assert(quote.length === 189, `Expected 189 request-quote products; found ${quote.length}.`);
assert(merged.every((item) => item.checkout_active === false), "Checkout must remain disabled for all opening products.");
assert(reconciliation.source_approved_records === 211 && reconciliation.excluded_products.length === 5 && reconciliation.final_storefront_records === 206, "The 211-to-206 reconciliation is incomplete.");
assert(reconciliation.duplicate_records_merged.length === 0 && reconciliation.missing_products.length === 0 && reconciliation.renamed_products.length === 0, "Unexpected reconciliation changes exist.");
for (const forbidden of ["_private_supplier", "supplier_cost", "wholesale", "margin", "map_price", "source_row"]) assert(!serializedCatalog.includes(forbidden), `Public catalog contains forbidden private token: ${forbidden}.`);
for (const item of catalog) assert(sitemap.includes(`<loc>https://telecomstore.net${item.canonical_path}</loc>`), `Sitemap missing ${item.canonical_path}.`);
for (const item of taxonomy.categories) assert(sitemap.includes(`<loc>https://telecomstore.net/categories/${item.slug}</loc>`), `Sitemap missing category ${item.slug}.`);
for (const item of taxonomy.manufacturers) assert(sitemap.includes(`<loc>https://telecomstore.net/manufacturers/${item.slug}</loc>`), `Sitemap missing manufacturer ${item.slug}.`);
const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
assert(sitemapUrls.length === 240 && unique(sitemapUrls), `Expected 240 unique sitemap URLs; found ${sitemapUrls.length}.`);
for (const route of ["/products/*", "/categories/*", "/manufacturers/*"]) assert(netlify.includes(`from = "${route}"`), `Netlify route missing ${route}.`);

const report = `# Storefront catalog validation\n\n| Check | Result |\n| --- | ---: |\n| Public products | ${catalog.length} |\n| Unique public SKUs | ${new Set(catalog.map((item) => item.sku)).size} |\n| Unique GTINs | ${new Set(catalog.map((item) => item.gtin)).size} |\n| Unique product slugs | ${new Set(catalog.map((item) => item.slug)).size} |\n| Categories | ${taxonomy.categories.length} |\n| Manufacturers | ${taxonomy.manufacturers.length} |\n| Listed merchandise-price records | ${listed.length} |\n| Request-quote records | ${quote.length} |\n| Checkout-enabled records | ${merged.filter((item) => item.checkout_active).length} |\n| Sitemap URLs | ${sitemapUrls.length} |\n| Validation errors | ${errors.length} |\n\nThe public catalog contains only public product identity, approved merchandise prices, and storefront content. It contains no supplier identity, supplier costs, MAP values, MSRP, margins, or source-row fields. Every listed price remains in the shipping-quote workflow and direct checkout is disabled.\n`;
fs.writeFileSync("docs/storefront-validation-report.md", report, "utf8");
if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}
console.log(`Validated ${catalog.length} products, ${listed.length} listed merchandise prices, ${quote.length} quote-only records, and ${sitemapUrls.length} internal catalog URLs.`);

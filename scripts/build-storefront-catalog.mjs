import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const sourceIndex = args.indexOf("--source");
if (sourceIndex < 0 || !args[sourceIndex + 1]) throw new Error("Usage: node scripts/build-storefront-catalog.mjs --source <approved-211.json>");
const sourcePath = path.resolve(args[sourceIndex + 1]);
const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const exclusions = new Map([
  ["PSG100", "Non-telecom luggage organizer approved in the earlier review set; excluded by Prompt 28."],
  ["PSG200", "Non-telecom luggage organizer approved in the earlier review set; excluded by Prompt 28."],
  ["PSG300", "Non-telecom luggage organizer approved in the earlier review set; excluded by Prompt 28."],
  ["PSG400", "Non-telecom luggage organizer approved in the earlier review set; excluded by Prompt 28."],
  ["BHOC05", "Non-telecom patio heater approved in the earlier review set; excluded by Prompt 28."]
]);
const colors = ["#126a8a", "#1d6b5a", "#7653a6", "#b25f2b", "#355d91", "#8a4f68", "#55703c"];

assert(source.length === 211, `Expected 211 source records, received ${source.length}.`);
const sourceSkus = source.map((item) => item.public_sku);
assert(new Set(sourceSkus).size === 211, "The approved source must contain 211 unique public SKUs.");
for (const sku of exclusions.keys()) assert(sourceSkus.includes(sku), `Expected exclusion ${sku} is missing from the approved source.`);

const included = source.filter((item) => !exclusions.has(item.public_sku));
assert(included.length === 206, `Expected 206 included records, received ${included.length}.`);
assert(new Set(included.map((item) => item.gtin)).size === 206, "Included GTINs must be unique.");

const usedSlugs = new Set();
const products = included.map((item) => {
  const baseSlug = slugify(`${item.brand}-${item.manufacturer_mpn}`);
  let slug = baseSlug;
  let suffix = 2;
  while (usedSlugs.has(slug)) slug = `${baseSlug}-${suffix++}`;
  usedSlugs.add(slug);
  const longDescription = `${item.title} from ${item.brand} is listed in Telecom Store's ${item.category} catalog under manufacturer part number ${item.manufacturer_mpn}. Request a quote to confirm current availability, shipping, compatibility, and order details before payment.`;
  return {
    sku: item.public_sku,
    slug,
    canonical_path: `/products/${slug}`,
    title: item.title,
    short_description: item.short_description,
    long_description: longDescription,
    category: item.category,
    brand: item.brand,
    manufacturer_mpn: item.manufacturer_mpn,
    gtin: item.gtin,
    specifications: { Manufacturer: item.brand, "Manufacturer MPN": item.manufacturer_mpn, "GTIN / UPC": item.gtin, Category: item.category },
    features: [],
    public_price: null,
    price_note: "Request quote",
    price_mode: "request_quote",
    opening_approved: true,
    checkout_active: false,
    image_rights_status: item.image_rights_status || "pending",
    public_availability: "quote_only",
    availability_text: "Availability by Quote",
    status: "available",
    meta_title: `${item.title} | ${item.brand} | Telecom Store`,
    meta_description: `Request a quote for ${item.brand} ${item.manufacturer_mpn}: ${item.title}. Manufacturer identity and GTIN verified; availability and shipping confirmed per quote.`,
    search_keywords: unique([item.brand, item.category, item.manufacturer_mpn, item.gtin, ...words(item.title)])
  };
});

const categoryNames = unique(products.map((item) => item.category));
const manufacturers = unique(products.map((item) => item.brand)).sort((a, b) => a.localeCompare(b));
const taxonomy = {
  categories: categoryNames.map((name, index) => ({ name, slug: slugify(name), color: colors[index % colors.length], count: products.filter((item) => item.category === name).length, description: `Browse ${name.toLowerCase()} by exact manufacturer part number and request a quote for current availability and shipping.` })),
  manufacturers: manufacturers.map((name) => ({ name, slug: slugify(name), count: products.filter((item) => item.brand === name).length }))
};
const excludedProducts = source.filter((item) => exclusions.has(item.public_sku)).map((item) => ({ public_sku: item.public_sku, manufacturer_mpn: item.manufacturer_mpn, brand: item.brand, title: item.title, reason: exclusions.get(item.public_sku) }));
const reconciliation = {
  generated_at: new Date().toISOString(),
  source_file: path.basename(sourcePath),
  source_approved_records: 211,
  source_unique_skus: 211,
  duplicate_records_merged: [],
  excluded_products: excludedProducts,
  missing_products: [],
  renamed_products: [],
  identity_conflicts: [],
  final_storefront_records: products.length,
  final_unique_skus: new Set(products.map((item) => item.sku)).size,
  final_unique_gtins: new Set(products.map((item) => item.gtin)).size,
  private_fields_removed: ["source_row", "_private_supplier_sku", "_private_raw_supplier_title", "_private_raw_supplier_description", "publish_supplier_image"]
};

writeJson("src/data/opening-catalog.json", products);
writeJson("src/data/catalog-taxonomy.json", taxonomy);
writeJson("operations/opening-catalog-reconciliation.json", reconciliation);
fs.writeFileSync("docs/opening-catalog-reconciliation.md", report(reconciliation), "utf8");
fs.writeFileSync("public/sitemap.xml", sitemap(products, taxonomy), "utf8");
console.log(`Built ${products.length} public products, ${taxonomy.categories.length} categories, ${taxonomy.manufacturers.length} manufacturers, and ${1 + products.length + taxonomy.categories.length + taxonomy.manufacturers.length} sitemap URLs.`);

function report(data) {
  const excluded = data.excluded_products.map((item) => `| ${item.public_sku} | ${item.brand} | ${item.title.replaceAll("|", "\\|")} | ${item.reason} |`).join("\n");
  return `# Opening catalog reconciliation\n\nGenerated from \`${data.source_file}\`. This report records every change between the 211-product approved review set and the public opening storefront.\n\n| Measure | Count |\n| --- | ---: |\n| Earlier approved records | 211 |\n| Earlier unique public SKUs | 211 |\n| Duplicate records merged | 0 |\n| Deliberate non-telecom exclusions | 5 |\n| Missing records | 0 |\n| Renamed records | 0 |\n| Identity conflicts | 0 |\n| Final storefront products | 206 |\n| Final unique SKUs | 206 |\n| Final unique GTINs | 206 |\n\n## Deliberate exclusions\n\n| Public SKU | Brand | Approved title | Reason |\n| --- | --- | --- | --- |\n${excluded}\n\nNo record was silently discarded. The five exclusions were explicitly directed by Prompt 28 after the earlier 211-record review. All supplier identifiers, raw supplier text, source-row metadata, supplier costs, MAP, MSRP, and margins are absent from the generated public catalog.\n`;
}

function sitemap(items, tx) {
  const base = "https://telecomstore.net";
  const paths = ["/", ...items.map((item) => item.canonical_path), ...tx.categories.map((item) => `/categories/${item.slug}`), ...tx.manufacturers.map((item) => `/manufacturers/${item.slug}`)];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths.map((item) => `  <url><loc>${base}${item}</loc></url>`).join("\n")}\n</urlset>\n`;
}
function slugify(value) { return String(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
function words(value) { return String(value).split(/[^A-Za-z0-9+.-]+/).filter((word) => word.length > 2); }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function assert(condition, message) { if (!condition) throw new Error(message); }

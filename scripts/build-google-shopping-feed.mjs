// ============================================================================
// Build the Google Merchant Center product feed and the shop sitemap from the
// published General Merchandise catalog.
//
//   node scripts/build-google-shopping-feed.mjs
//
// Writes:
//   public/feeds/google-shopping.xml   RSS 2.0 + g: namespace product feed
//   public/sitemap-shop.xml            every shop URL, for crawl discovery
//
// Reads ONLY public/data/marketplace-catalog.json — the same published artifact
// the storefront serves. It never touches the supplier workbook, so the feed
// cannot contain a field the shop itself does not already show.
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { MARKETPLACE_DEPARTMENTS, MARKETPLACE_SITE_URL } from "../src/config/marketplace.mjs";
import { apparelItemXml, apparelVariants, feedEligibleApparelVariants, quoteOnlyApparelSizes } from "./lib/apparel-feed.mjs";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const catalogPath = path.resolve(ROOT, "public/data/marketplace-catalog.json");

if (!fs.existsSync(catalogPath)) {
  console.error("Published catalog not found. Run scripts/build-general-merchandise-catalog.mjs first.");
  process.exit(1);
}

const payload = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const products = payload.products || [];

const escapeXml = (input) => String(input ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&apos;");

// Merchant Center rejects a feed item that lacks an identifier, so an item with
// neither a GTIN nor an MPN must declare identifier_exists=no instead.
function identifierFields(product) {
  const fields = [];
  if (product.gtin) fields.push(`      <g:gtin>${escapeXml(product.gtin)}</g:gtin>`);
  if (product.manufacturer_mpn) fields.push(`      <g:mpn>${escapeXml(product.manufacturer_mpn)}</g:mpn>`);
  if (!product.gtin && !product.manufacturer_mpn) {
    fields.push("      <g:identifier_exists>no</g:identifier_exists>");
  }
  return fields;
}

// Products withheld from the feed on Google policy grounds. This is a
// FEED-ONLY filter: the products stay listed and sellable on the storefront,
// and nothing about them is renamed or recategorised.
const exclusionPath = path.resolve(ROOT, "scripts/data/google-feed-exclusions.json");
const policyExclusions = fs.existsSync(exclusionPath)
  ? JSON.parse(fs.readFileSync(exclusionPath, "utf8")).exclusions || []
  : [];
const excludedBySku = new Map(policyExclusions.map((row) => [String(row.sku), row]));
const policyExcluded = [];

const included = [];
const excluded = { no_price: 0, no_image: 0, no_title: 0, no_shipping_weight: 0, google_policy: 0 };
const excludedSkus = { no_shipping_weight: [] };
const availabilityCounts = { in_stock: 0, out_of_stock: 0, backorder: 0, preorder: 0 };
let withShippingWeight = 0;
let withShippingDimensions = 0;
let missingAvailabilityDate = 0;

const items = [];
for (const product of products) {
  // Merchant Center requires title, link, image and price. A record missing any
  // of them is skipped rather than submitted to be disapproved.
  // Policy exclusion is checked first so a withheld product is reported as such
  // rather than being counted under an unrelated reason.
  if (excludedBySku.has(String(product.sku))) {
    excluded.google_policy += 1;
    policyExcluded.push({ sku: product.sku, reason: excludedBySku.get(String(product.sku)).reason, title: product.title });
    continue;
  }
  if (!product.title) { excluded.no_title += 1; continue; }
  if (!product.image_url) { excluded.no_image += 1; continue; }
  const price = Number(product.public_price);
  if (!(price > 0)) { excluded.no_price += 1; continue; }

  // Merchant Center uses FedEx carrier-calculated shipping, which needs a real
  // packaged weight. An item without one is excluded rather than given a guess.
  const shippingWeight = Number(product.shipping_weight_lb);
  if (!(shippingWeight > 0)) {
    excluded.no_shipping_weight += 1;
    if (excludedSkus.no_shipping_weight.length < 50) excludedSkus.no_shipping_weight.push(product.sku);
    continue;
  }

  const link = `${MARKETPLACE_SITE_URL}/shop/products/${product.slug}`;
  // image_link must be absolute and fetchable by Google; the catalog stores the
  // first-party proxy path.
  const imageLink = /^https?:\/\//i.test(product.image_url)
    ? product.image_url
    : `${MARKETPLACE_SITE_URL}${product.image_url}`;
  const description = product.short_description || product.title;

  // Availability comes from the catalog's derived state, not a guess from copy.
  // Google requires availability_date for backorder/preorder; an out-of-stock
  // item whose supplier ETA has lapsed is reported out_of_stock rather than
  // advertised with a stale promise.
  const state = ["in_stock", "out_of_stock", "backorder", "preorder"].includes(product.availability_state)
    ? product.availability_state
    : "out_of_stock";
  const availabilityDate = state === "backorder" || state === "preorder" ? String(product.availability_date || "") : "";
  if ((state === "backorder" || state === "preorder") && !/^\d{4}-\d{2}-\d{2}$/.test(availabilityDate)) {
    missingAvailabilityDate += 1;
  }
  availabilityCounts[state] += 1;
  withShippingWeight += 1;
  const dimensions = [product.shipping_length_in, product.shipping_width_in, product.shipping_height_in].map(Number);
  const hasDimensions = dimensions.every((value) => value > 0);
  if (hasDimensions) withShippingDimensions += 1;

  items.push([
    "    <item>",
    `      <g:id>${escapeXml(product.sku)}</g:id>`,
    `      <g:title>${escapeXml(product.title.slice(0, 150))}</g:title>`,
    `      <g:description>${escapeXml(description.slice(0, 5000))}</g:description>`,
    `      <g:link>${escapeXml(link)}</g:link>`,
    `      <g:image_link>${escapeXml(imageLink)}</g:image_link>`,
    `      <g:availability>${state}</g:availability>`,
    availabilityDate ? `      <g:availability_date>${escapeXml(availabilityDate)}</g:availability_date>` : null,
    `      <g:price>${price.toFixed(2)} ${escapeXml(product.currency_code || "USD")}</g:price>`,
    // Packaged shipping weight, required for carrier-calculated shipping.
    `      <g:shipping_weight>${shippingWeight.toFixed(2)} lb</g:shipping_weight>`,
    // Real package dimensions improve dimensional-weight accuracy. Emitted only
    // when all three are present in the supplier data; never manufactured.
    ...(hasDimensions ? [
      `      <g:shipping_length>${dimensions[0].toFixed(2)} in</g:shipping_length>`,
      `      <g:shipping_width>${dimensions[1].toFixed(2)} in</g:shipping_width>`,
      `      <g:shipping_height>${dimensions[2].toFixed(2)} in</g:shipping_height>`,
    ] : []),
    `      <g:brand>${escapeXml(product.brand)}</g:brand>`,
    `      <g:condition>${escapeXml(product.condition === "refurbished" ? "refurbished" : "new")}</g:condition>`,
    ...identifierFields(product),
    product.google_product_category ? `      <g:google_product_category>${escapeXml(product.google_product_category)}</g:google_product_category>` : null,
    product.product_type ? `      <g:product_type>${escapeXml(product.product_type)}</g:product_type>` : null,
    "    </item>",
  ].filter(Boolean).join("\n"));
  included.push(product);
}

// Apparel variants join the SAME feed URL — no second Merchant Center feed. Only
// variants with a documented packaged weight are eligible, so while the mailer
// weight is unresolved this contributes zero rows.
// Counted separately from the general-merchandise totals so the invariants below
// (every general-merchandise row weighed, every backorder dated) stay meaningful.
const apparelEligible = feedEligibleApparelVariants();
const apparelAll = apparelVariants();
const apparelItems = apparelEligible.map(apparelItemXml);

const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>Telecom Store General Merchandise</title>
    <link>${escapeXml(`${MARKETPLACE_SITE_URL}/shop`)}</link>
    <description>General merchandise available from Telecom Store.</description>
${[...items, ...apparelItems].join("\n")}
  </channel>
</rss>
`;

const feedPath = path.resolve(ROOT, "public/feeds/google-shopping.xml");
fs.mkdirSync(path.dirname(feedPath), { recursive: true });
fs.writeFileSync(feedPath, feed, "utf8");

// --- Sitemap -----------------------------------------------------------------
//
// Product pages are the pages that should rank, so every one gets a sitemap
// entry. Department pages are listed with a higher priority as browse hubs.
const urls = [
  { loc: `${MARKETPLACE_SITE_URL}/shop`, priority: "0.9" },
  ...MARKETPLACE_DEPARTMENTS.map((department) => ({ loc: `${MARKETPLACE_SITE_URL}/shop/${department.slug}`, priority: "0.8" })),
  // The sitemap covers every published product page, including ones withheld
  // from the Shopping feed on policy grounds — those pages are still live and
  // sellable, so they must stay crawlable and indexable.
  ...products
    .filter((product) => product.slug && product.title)
    .map((product) => ({ loc: `${MARKETPLACE_SITE_URL}/shop/products/${product.slug}`, priority: "0.6" })),
];

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url><loc>${escapeXml(url.loc)}</loc><changefreq>weekly</changefreq><priority>${url.priority}</priority></url>`).join("\n")}
</urlset>
`;

const sitemapPath = path.resolve(ROOT, "public/sitemap-shop.xml");
fs.writeFileSync(sitemapPath, sitemap, "utf8");

const withGtin = included.filter((product) => product.gtin).length;
console.log(`Feed items: ${included.length} of ${products.length} published products.`);
console.log(`  skipped — missing price: ${excluded.no_price}, missing image: ${excluded.no_image}, missing title: ${excluded.no_title}, missing shipping weight: ${excluded.no_shipping_weight}`);
if (excludedSkus.no_shipping_weight.length) {
  console.log(`  excluded for no shipping weight: ${excludedSkus.no_shipping_weight.join(", ")}`);
}
if (policyExcluded.length) {
  const byReason = {};
  for (const row of policyExcluded) byReason[row.reason] = (byReason[row.reason] || 0) + 1;
  console.log(`  withheld on Google policy: ${policyExcluded.length} (${Object.entries(byReason).map(([r, n]) => `${r}=${n}`).join(", ")})`);
  console.log(`    SKUs: ${policyExcluded.map((row) => row.sku).join(", ")}`);
  console.log("    These remain listed and sellable on the storefront.");
}
console.log(`  shipping_weight present: ${withShippingWeight}/${included.length}  (dimensions on ${withShippingDimensions})`);
console.log(`  availability: in_stock=${availabilityCounts.in_stock}, out_of_stock=${availabilityCounts.out_of_stock}, backorder=${availabilityCounts.backorder}, preorder=${availabilityCounts.preorder}`);
console.log(`  backorder/preorder missing availability_date: ${missingAvailabilityDate} (must be 0)`);
console.log(`Apparel: ${apparelAll.length} approved S-XL variants built, ${apparelEligible.length} in the feed.`);
if (apparelEligible.length !== apparelAll.length) {
  const missing = apparelAll.filter((variant) => !variant.feed_eligible).length;
  console.log(`  ${missing} withheld — no documented packaged weight (garment weight alone is not a shipping weight).`);
}
console.log(`  quote-only sizes deliberately not advertised: ${quoteOnlyApparelSizes().length}`);
if (missingAvailabilityDate > 0) {
  console.error("FAILED: a backorder/preorder item has no availability_date.");
  process.exit(1);
}
if (withShippingWeight !== included.length) {
  console.error("FAILED: a feed item is missing shipping_weight.");
  process.exit(1);
}
console.log(`  GTIN provided: ${withGtin}; brand + MPN only: ${included.length - withGtin}`);
console.log(`Wrote ${path.relative(ROOT, feedPath)} (${(fs.statSync(feedPath).size / 1048576).toFixed(2)} MB)`);
console.log(`Wrote ${path.relative(ROOT, sitemapPath)} (${urls.length} URLs)`);

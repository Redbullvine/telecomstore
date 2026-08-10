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

const included = [];
const excluded = { no_price: 0, no_image: 0, no_title: 0 };

const items = [];
for (const product of products) {
  // Merchant Center requires title, link, image and price. A record missing any
  // of them is skipped rather than submitted to be disapproved.
  if (!product.title) { excluded.no_title += 1; continue; }
  if (!product.image_url) { excluded.no_image += 1; continue; }
  const price = Number(product.public_price);
  if (!(price > 0)) { excluded.no_price += 1; continue; }

  const link = `${MARKETPLACE_SITE_URL}/shop/products/${product.slug}`;
  // image_link must be absolute and fetchable by Google; the catalog stores the
  // first-party proxy path.
  const imageLink = /^https?:\/\//i.test(product.image_url)
    ? product.image_url
    : `${MARKETPLACE_SITE_URL}${product.image_url}`;
  const inStock = /^In stock/i.test(String(product.availability || ""));
  const description = product.short_description || product.title;

  items.push([
    "    <item>",
    `      <g:id>${escapeXml(product.sku)}</g:id>`,
    `      <g:title>${escapeXml(product.title.slice(0, 150))}</g:title>`,
    `      <g:description>${escapeXml(description.slice(0, 5000))}</g:description>`,
    `      <g:link>${escapeXml(link)}</g:link>`,
    `      <g:image_link>${escapeXml(imageLink)}</g:image_link>`,
    `      <g:availability>${inStock ? "in_stock" : "backorder"}</g:availability>`,
    `      <g:price>${price.toFixed(2)} ${escapeXml(product.currency_code || "USD")}</g:price>`,
    `      <g:brand>${escapeXml(product.brand)}</g:brand>`,
    `      <g:condition>${escapeXml(product.condition === "refurbished" ? "refurbished" : "new")}</g:condition>`,
    ...identifierFields(product),
    product.google_product_category ? `      <g:google_product_category>${escapeXml(product.google_product_category)}</g:google_product_category>` : null,
    product.product_type ? `      <g:product_type>${escapeXml(product.product_type)}</g:product_type>` : null,
    "    </item>",
  ].filter(Boolean).join("\n"));
  included.push(product);
}

const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>Telecom Store General Merchandise</title>
    <link>${escapeXml(`${MARKETPLACE_SITE_URL}/shop`)}</link>
    <description>General merchandise available from Telecom Store.</description>
${items.join("\n")}
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
  ...included.map((product) => ({ loc: `${MARKETPLACE_SITE_URL}/shop/products/${product.slug}`, priority: "0.6" })),
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
console.log(`  skipped — missing price: ${excluded.no_price}, missing image: ${excluded.no_image}, missing title: ${excluded.no_title}`);
console.log(`  GTIN provided: ${withGtin}; brand + MPN only: ${included.length - withGtin}`);
console.log(`Wrote ${path.relative(ROOT, feedPath)} (${(fs.statSync(feedPath).size / 1048576).toFixed(2)} MB)`);
console.log(`Wrote ${path.relative(ROOT, sitemapPath)} (${urls.length} URLs)`);

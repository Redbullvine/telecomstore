import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  MARKETPLACE_DEPARTMENTS,
  filterMarketplaceProducts,
  isMarketplacePath,
  marketplaceMetadata,
  resolveMarketplaceRoute,
  sanitizeMarketplaceProduct,
} from "../src/lib/marketplace-catalog.mjs";
import { restrictionType, validateMarketplaceImport } from "../scripts/lib/marketplace-import.mjs";

const product = (patch = {}) => sanitizeMarketplaceProduct({
  id: "1", sku: "TS-1", slug: "acme-part-1", brand: "Acme", title: "Widget",
  manufacturer_mpn: "PART-1", gtin: "", department_slug: "electronics",
  department_name: "Electronics", subcategory: "Audio", short_description: "A widget",
  long_description: "A longer widget description", search_keywords: ["receiver"],
  availability: "In stock", clearance: false, price_mode: "request_quote",
  public_price: null, currency_code: "USD", image_url: "", image_alt: "",
  meta_title: "", meta_description: "", published_at: "2026-08-06T00:00:00Z",
  supplier_sku: "MUST-NOT-LEAK", supplier_cost: 10, restriction_evidence: "private",
  ...patch,
});

test("marketplace routes cover home, eight departments, products, and reject unknown routes", () => {
  assert.equal(isMarketplacePath("/shop"), true);
  assert.equal(isMarketplacePath("/shop/electronics"), true);
  assert.equal(isMarketplacePath("/products/example"), false);
  assert.equal(resolveMarketplaceRoute("/shop").kind, "marketplace_home");
  for (const department of MARKETPLACE_DEPARTMENTS) {
    assert.equal(resolveMarketplaceRoute(`/shop/${department.slug}`).department.slug, department.slug);
  }
  assert.equal(resolveMarketplaceRoute("/shop/products/acme-part-1", [product()]).product.sku, "TS-1");
  assert.equal(resolveMarketplaceRoute("/shop/not-a-department").kind, "marketplace_not_found");
});

test("sanitizer allowlists public fields and strips every supplier-private value", () => {
  const safe = product();
  const serialized = JSON.stringify(safe);
  assert.equal(serialized.includes("MUST-NOT-LEAK"), false);
  assert.equal("supplier_cost" in safe, false);
  assert.equal("supplier_sku" in safe, false);
  assert.equal("restriction_evidence" in safe, false);
  assert.equal(safe.public_price, null);
  assert.equal(safe.pricing_approved, false);
});

test("marketplace filters support public search, department, subcategory, brand, availability, price, deals, and sort", () => {
  const rows = [
    product(),
    product({ id: "2", sku: "TS-2", slug: "beta-deal", brand: "Beta", title: "Clearance Radio", manufacturer_mpn: "RAD-2", department_slug: "deals", department_name: "Deals", subcategory: "Radio", clearance: true, price_mode: "fixed", public_price: 50 }),
    product({ id: "3", sku: "TS-3", slug: "acme-tool", title: "Cable Tool", manufacturer_mpn: "TOOL-3", department_slug: "tools", department_name: "Tools & Home Improvement", subcategory: "Hand Tools", price_mode: "fixed", public_price: 20 }),
  ];
  assert.deepEqual(filterMarketplaceProducts(rows, { query: "PART-1" }).map((row) => row.sku), ["TS-1"]);
  assert.deepEqual(filterMarketplaceProducts(rows, { department: "tools" }).map((row) => row.sku), ["TS-3"]);
  assert.deepEqual(filterMarketplaceProducts(rows, { subcategory: "Radio" }).map((row) => row.sku), ["TS-2"]);
  assert.deepEqual(filterMarketplaceProducts(rows, { brand: "Beta" }).map((row) => row.sku), ["TS-2"]);
  assert.deepEqual(filterMarketplaceProducts(rows, { availability: "quote" }).map((row) => row.sku), ["TS-1"]);
  assert.deepEqual(filterMarketplaceProducts(rows, { priceRange: "under-25" }).map((row) => row.sku), ["TS-3"]);
  assert.deepEqual(filterMarketplaceProducts(rows, { deals: true }).map((row) => row.sku), ["TS-2"]);
  assert.deepEqual(filterMarketplaceProducts(rows, { sort: "price-high" }).map((row) => row.sku), ["TS-2", "TS-3", "TS-1"]);
});

test("structured data emits price and image only when sanitized publication data contains them", () => {
  const quoteMeta = marketplaceMetadata({ kind: "marketplace_product", product: product() }, 1);
  const quoteSchema = quoteMeta.schemas.find((schema) => schema["@type"] === "Product");
  assert.equal("offers" in quoteSchema, false);
  assert.equal("image" in quoteSchema, false);
  const approved = product({ price_mode: "fixed", public_price: 42, image_url: "https://example.com/approved.jpg", image_alt: "Approved" });
  const pricedSchema = marketplaceMetadata({ kind: "marketplace_product", product: approved }, 1).schemas.find((schema) => schema["@type"] === "Product");
  assert.equal(pricedSchema.offers.price, 42);
  assert.deepEqual(pricedSchema.image, ["https://example.com/approved.jpg"]);
});

test("private import validation requires exact approved totals and GTIN fallback disabled", () => {
  const records = Array.from({ length: 2587 }, (_, index) => ({
    supplier_sku: `SUP-${index}`, department: "electronics", source_hash: "a".repeat(64),
    gtin: index === 0 ? "012345678905" : null, gtin_matching_allowed: false,
    restricted: index < 279, identity_conflict: index < 105, in_stock: index < 2011,
    discontinued: index < 623,
  }));
  const summary = { total_imported: 2587, unique_supplier_skus: 2587, restricted_total: 279, identity_conflict_total: 105, in_stock_total: 2011, zero_stock_total: 576, gtin_fallback_matching_enabled: false, database_writes: 0, public_products_written: 0, public_prices_written: 0 };
  assert.equal(validateMarketplaceImport(records, summary).ok, true);
  assert.equal(validateMarketplaceImport(records, { ...summary, gtin_fallback_matching_enabled: true }).ok, false);
});

test("restriction types are supplier-neutral and marketplace migration keeps reviews private", () => {
  assert.equal(restrictionType("May not be sold online"), "internet_sale");
  assert.equal(restrictionType("Territory limited to the United States"), "territory");
  assert.equal(restrictionType("Authorized dealer agreement required"), "dealer_authorization");
  const sql = fs.readFileSync("supabase/migrations/20260806120000_supplier_marketplace_review.sql", "utf8");
  assert.match(sql, /alter table public\.supplier_restrictions enable row level security/i);
  assert.match(sql, /alter table public\.pricing_reviews enable row level security/i);
  assert.match(sql, /revoke all on table public\.pricing_reviews from public, anon/i);
  assert.match(sql, /grant execute on function public\.get_public_marketplace_catalog\(text\) to anon, authenticated/i);
  assert.doesNotMatch(sql.match(/returns table[\s\S]*?\)\s*language sql/i)?.[0] || "", /supplier|cost|margin|restriction|quarantine/i);
});

test("marketplace implementation never edits payment-owned files or embeds a private catalog", () => {
  const component = fs.readFileSync("src/components/marketplace/MarketplaceStorefront.jsx", "utf8");
  const catalog = fs.readFileSync("src/lib/marketplace-catalog.mjs", "utf8");
  assert.doesNotMatch(`${component}\n${catalog}`, /supplier_cost|map_price|gross_margin|raw_payload|restriction_evidence/i);
  const api = fs.readFileSync("src/lib/marketplace-api.mjs", "utf8");
  assert.match(api, /get_public_marketplace_catalog/);
  assert.equal(fs.existsSync("src/data/petra-marketplace.json"), false);
});

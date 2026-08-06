import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import catalog from "../src/data/opening-catalog.json" with { type: "json" };
import pricing from "../src/data/opening-pricing.json" with { type: "json" };
import taxonomy from "../src/data/catalog-taxonomy.json" with { type: "json" };
import { validateGeneralLead, validateQuoteRequest } from "../src/lib/lead-validation.mjs";
import { productPath, relatedProducts, resolveStorefrontRoute, storefrontMetadata } from "../src/lib/storefront-catalog.mjs";

test("all 206 products resolve to dedicated routes with truthful metadata", () => {
  for (const product of catalog) {
    const route = resolveStorefrontRoute(productPath(product), catalog);
    assert.equal(route.product.sku, product.sku);
    const metadata = storefrontMetadata(route);
    assert.equal(metadata.canonical, `https://telecomstore.net${product.canonical_path}`);
    assert.equal(metadata.schemas.find((item) => item["@type"] === "Product").mpn, product.manufacturer_mpn);
  }
});

test("category and manufacturer landing routes cover the complete taxonomy", () => {
  assert.equal(taxonomy.categories.length, 7);
  assert.equal(taxonomy.manufacturers.length, 26);
  for (const item of taxonomy.categories) assert.equal(resolveStorefrontRoute(`/categories/${item.slug}`, catalog).category.name, item.name);
  for (const item of taxonomy.manufacturers) assert.equal(resolveStorefrontRoute(`/manufacturers/${item.slug}`, catalog).manufacturer.name, item.name);
});

test("related products never include the current product", () => {
  const product = catalog[0];
  const related = relatedProducts(product, catalog);
  assert.ok(related.length > 0);
  assert.ok(related.every((item) => item.sku !== product.sku));
});

test("pricing publishes only verified candidates and keeps direct checkout disabled", () => {
  assert.equal(pricing.filter((item) => item.pricing_approved).length, 17);
  assert.equal(pricing.filter((item) => item.price_mode === "listed_price_shipping_quote").length, 17);
  assert.equal(pricing.filter((item) => item.price_mode === "request_quote").length, 189);
  assert.equal(pricing.filter((item) => item.checkout_active).length, 0);
});

test("quote validation requires name, valid email, phone, quantity, and message", () => {
  const valid = new FormData();
  valid.set("name", "Danny"); valid.set("email", "danny@example.com"); valid.set("phone", "555-555-1212"); valid.set("quantity", "2"); valid.set("message", "Please quote this item.");
  assert.equal(validateQuoteRequest(valid), "");
  for (const field of ["name", "email", "phone", "quantity", "message"]) {
    const invalid = new FormData();
    valid.forEach((value, key) => invalid.set(key, value));
    invalid.set(field, "");
    assert.notEqual(validateQuoteRequest(invalid), "", `${field} should be required`);
  }
});

test("general non-product leads retain email-or-phone behavior", () => {
  const form = new FormData(); form.set("name", "Danny"); form.set("email", "danny@example.com");
  assert.equal(validateGeneralLead(form), "");
});

test("the public catalog contains no supplier-private fields", () => {
  const content = fs.readFileSync("src/data/opening-catalog.json", "utf8");
  assert.doesNotMatch(content, /_private_supplier_sku|supplier_cost|wholesale_price|map_price/i);
});

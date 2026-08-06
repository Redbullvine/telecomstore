import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const catalog = JSON.parse(fs.readFileSync("src/data/opening-catalog.json", "utf8"));
const pricing = JSON.parse(fs.readFileSync("src/data/opening-pricing.json", "utf8"));

test("opening catalog contains exactly 206 unique approved public products", () => {
  assert.equal(catalog.length, 206);
  assert.equal(new Set(catalog.map((p) => p.sku)).size, 206);
  assert.ok(catalog.every((p) => p.opening_approved && p.price_mode === "request_quote" && p.public_price === null && !p.checkout_active));
  assert.ok(catalog.every((p) => /^\d{8}$|^\d{12,14}$/.test(p.gtin)));
  assert.ok(catalog.every((p) => p.search_keywords.includes(p.manufacturer_mpn) && p.search_keywords.includes(p.gtin)));
});
test("excluded products and private supplier data never enter the public catalog", () => {
  const text = JSON.stringify(catalog);
  for (const sku of ["PSG100", "PSG200", "PSG300", "PSG400", "BHOC05"]) assert.equal(text.includes(sku), false);
  for (const forbidden of ["supplier_sku", "_private", "supplier_cost", "wholesale", "raw_supplier"]) assert.equal(text.toLowerCase().includes(forbidden), false);
  assert.ok(catalog.every((p) => p.image_rights_status === "approved" && p.publish_supplier_image === true));
  assert.ok(catalog.every((p) => /^https:\/\/s3\.us-east-2\.amazonaws\.com\/petraimages\.com\//.test(p.photo_main)));
  assert.ok(catalog.every((p) => !("condition" in p)));
});

test("public pricing mirrors all SKUs without enabling checkout", () => {
  assert.equal(pricing.length, 206);
  assert.deepEqual(new Set(pricing.map((p) => p.public_sku)), new Set(catalog.map((p) => p.sku)));
  const approved = pricing.filter((p) => p.pricing_approved);
  const quoteOnly = pricing.filter((p) => !p.pricing_approved);
  assert.equal(approved.length, 17);
  assert.equal(quoteOnly.length, 189);
  assert.ok(approved.every((p) => p.public_price > 0 && p.checkout_active === false && p.price_mode === "listed_price_shipping_quote"));
  assert.ok(quoteOnly.every((p) => p.public_price === null && p.checkout_active === false && p.price_mode === "request_quote"));
});

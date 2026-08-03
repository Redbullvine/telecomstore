import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const catalog = JSON.parse(fs.readFileSync("src/data/opening-catalog.json", "utf8"));
const pricing = JSON.parse(fs.readFileSync("src/data/opening-pricing.json", "utf8"));

test("opening catalog contains exactly 206 unique approved public products", () => {
  assert.equal(catalog.length, 206);
  assert.equal(new Set(catalog.map((p) => p.sku)).size, 206);
  assert.ok(catalog.every((p) => p.opening_approved && p.price_mode === "request_quote" && p.public_price === null && !p.checkout_active));
});
test("excluded products and private supplier data never enter the public catalog", () => {
  const text = JSON.stringify(catalog);
  for (const sku of ["PSG100", "PSG200", "PSG300", "PSG400", "BHOC05"]) assert.equal(text.includes(sku), false);
  for (const forbidden of ["supplier_sku", "_private", "supplier_cost", "wholesale", "raw_supplier", "petra"]) assert.equal(text.toLowerCase().includes(forbidden), false);
  assert.ok(catalog.every((p) => !Object.keys(p).some((key) => key.includes("image") && key !== "image_rights_status")));
  assert.ok(catalog.every((p) => !("condition" in p)));
});

test("public pricing mirrors all SKUs without enabling checkout", () => {
  assert.equal(pricing.length, 206);
  assert.deepEqual(new Set(pricing.map((p) => p.public_sku)), new Set(catalog.map((p) => p.sku)));
  assert.ok(pricing.every((p) => p.public_price === null && p.checkout_active === false));
});

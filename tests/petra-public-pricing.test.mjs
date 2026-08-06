import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { calculatePublicPrice, matchCatalogProduct, selectPublicPrice, supplierEligibility } from "../scripts/generate-petra-public-pricing.mjs";
import { buildQuoteItemSnapshot } from "../netlify/functions/submit-quote-request.mjs";

test("price rule doubles cost, rounds cents, and enforces only a higher MAP", () => {
  assert.deepEqual(calculatePublicPrice({ cost: "10.00", map: "" }), { status: "priced", publicPrice: 20, basis: "cost_times_two" });
  assert.equal(calculatePublicPrice({ cost: "1.117", map: "" }).publicPrice, 2.23);
  assert.deepEqual(calculatePublicPrice({ cost: "10", map: "25" }), { status: "priced", publicPrice: 25, basis: "map_floor" });
  assert.equal(calculatePublicPrice({ cost: "10", map: "15" }).publicPrice, 20);
});

test("missing, zero, negative, and restricted records never receive a price", () => {
  assert.equal(calculatePublicPrice({ cost: "" }).status, "missing_cost");
  assert.equal(calculatePublicPrice({ cost: "0" }).status, "invalid_cost");
  assert.equal(calculatePublicPrice({ cost: "-2" }).status, "invalid_cost");
  assert.equal(calculatePublicPrice({ cost: "10", restricted: true }).status, "restricted");
});

test("matching follows supplier SKU, exact MPN, exact GTIN and rejects ambiguity", () => {
  const rows = [
    { "PETRA SKU": "P-1", "VENDOR SKU": "M-1", UPC: "111" },
    { "PETRA SKU": "P-2", "VENDOR SKU": "M-2", UPC: "222" }
  ];
  assert.equal(matchCatalogProduct({ manufacturer_mpn: "M-2", gtin: "111" }, { supplier_sku: "P-1" }, rows).method, "supplier_sku");
  assert.equal(matchCatalogProduct({ manufacturer_mpn: "M-2", gtin: "111" }, {}, rows).method, "manufacturer_mpn");
  assert.equal(matchCatalogProduct({ manufacturer_mpn: "NONE", gtin: "111" }, {}, rows).method, "gtin");
  assert.equal(matchCatalogProduct({ manufacturer_mpn: "M-1", gtin: "111" }, {}, [...rows, { "PETRA SKU": "P-3", "VENDOR SKU": "M-1", UPC: "333" }]).status, "ambiguous");
});

test("supplier eligibility blocks zero stock, discontinued products, and territory restrictions", () => {
  assert.equal(supplierEligibility({ AVAILABLE: "0" }).reason, "out_of_stock");
  assert.equal(supplierEligibility({ AVAILABLE: "2", NOTES1: "Product is Discontinued;" }).reason, "discontinued");
  assert.equal(supplierEligibility({ AVAILABLE: "2", NOTES1: "Ship only in US;" }).reason, "sale_or_territory_restricted");
  assert.equal(supplierEligibility({ AVAILABLE: "2", NOTES2: "Product cannot ship air;" }).eligible, true);
});

test("price publication requires exact-MPN market evidence and respects MSRP and market ceilings", () => {
  const product = { manufacturer_mpn: "MPN-1" };
  const row = { AVAILABLE: "2", PRICE: "10", MAP: "0", MSRP: "30" };
  const research = { manufacturer_mpn: "MPN-1", lowest_reliable_price: "18", typical_public_price: "22", highest_reasonable_price: "25", pricing_evidence_urls: "https://example.test/mpn-1" };
  assert.deepEqual(selectPublicPrice({ row, product, research }), { status: "priced", publicPrice: 20, basis: "cost_times_two" });
  assert.equal(selectPublicPrice({ row, product, research: { ...research, manufacturer_mpn: "OTHER" } }).status, "market_identity_unconfirmed");
  assert.equal(selectPublicPrice({ row: { ...row, MSRP: "19" }, product, research }).status, "above_msrp_manual_review");
  assert.equal(selectPublicPrice({ row, product, research: { ...research, highest_reasonable_price: "19" } }).status, "above_market_manual_review");
});

test("quote snapshot ignores browser price fields and uses the server bundle", () => {
  const row = { public_sku: "PUBLIC-1", title: "One", public_price: 42.5, price_mode: "listed_price_shipping_quote" };
  const snapshot = buildQuoteItemSnapshot(row, 3, { public_price: 0.01 });
  assert.equal(snapshot.public_unit_price, "42.50");
  assert.equal(snapshot.price_mode, "listed_price_shipping_quote");
  assert.equal(snapshot.quantity, 3);
});

test("published bundles expose public prices but no confidential supplier fields", () => {
  for (const path of ["src/data/opening-pricing.json", "netlify/functions/_shared/opening-pricing.json"]) {
    const text = fs.readFileSync(path, "utf8");
    assert.doesNotMatch(text, /supplier|wholesale|margin|markup|map_price|petra sku/i);
  }
});

test("the August 5 supplier refresh is represented only by aggregate, non-cost audit totals", () => {
  const summaryText = fs.readFileSync("operations/petra-public-pricing-summary.json", "utf8");
  const summary = JSON.parse(summaryText);
  assert.equal(summary.source_unique_petra_skus, 2587);
  assert.equal(summary.additions, 20);
  assert.equal(summary.removals, 11);
  assert.equal(summary.price_changes, 24);
  assert.equal(summary.newly_in_stock, 28);
  assert.equal(summary.newly_out_of_stock, 35);
  assert.equal(summary.public_prices, 17);
  assert.equal(summary.quote_only, 189);
  assert.equal(summary.new_products_auto_published, 0);
  assert.doesNotMatch(summaryText, /supplier_cost|wholesale_price|margin|authoritative_cost_column/i);
});

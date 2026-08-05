import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  storefrontBadgeLabel,
  storefrontImageAlt,
  storefrontImageSource,
  supportedConditionLabel
} from "../src/lib/storefront-product.mjs";

const storefrontSource = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const inventorySource = await readFile(new URL("../src/lib/inventory.js", import.meta.url), "utf8");
const indexSource = await readFile(new URL("../index.html", import.meta.url), "utf8");

test("quote-only products receive neutral quote wording", () => {
  assert.equal(storefrontBadgeLabel({ public_availability: "quote_only" }), "Availability by Quote");
});

test("missing condition produces no unsupported condition claim", () => {
  assert.equal(supportedConditionLabel({}), "");
  assert.equal(supportedConditionLabel({ condition: "   " }), "");
  assert.equal(storefrontBadgeLabel({}), "Availability by Quote");
  assert.match(inventorySource, /condition:\s*""/);
  assert.doesNotMatch(inventorySource, /condition:\s*"New Surplus/);
});

test("a supported product-specific condition remains visible", () => {
  assert.equal(storefrontBadgeLabel({ condition: "Factory sealed" }), "Factory sealed");
  assert.equal(supportedConditionLabel({ condition: "  Open box  " }), "Open box");
});

test("no hardcoded New Surplus claim remains in storefront presentation code", () => {
  assert.doesNotMatch(`${indexSource}\n${storefrontSource}\n${inventorySource}`, /New Surplus/i);
  assert.doesNotMatch(storefrontSource, /product\.condition\s*\|\|\s*["'](?:New|Used|Refurbished|Surplus)/i);
});

test("image-free products retain the category-glyph fallback", () => {
  assert.equal(storefrontImageSource({}), "");
  assert.match(storefrontSource, /<CatGlyph category=\{product\.category\}/);
  assert.match(storefrontSource, /if \(src && !failed\)/);
});

test("approved product images receive manufacturer and MPN alt text", () => {
  assert.equal(
    storefrontImageAlt({ brand: "Example", title: "Cable", manufacturer_mpn: "CAB-1" }),
    "Example Cable (CAB-1) product image"
  );
});

test("catalog states the payment confirmation boundary and fixed prices remain labels only", () => {
  assert.match(storefrontSource, /Availability and shipping are confirmed before payment\./);
  assert.match(storefrontSource, /Fixed price · \$/);
  assert.doesNotMatch(storefrontSource, /available SKUs|Same-day quotes|Nationwide shipping|Pallet &amp; freight ready/);
});

test("quote controls remain available on product cards and details", () => {
  assert.match(storefrontSource, /"Add to Quote"/);
  assert.match(storefrontSource, />Ask About This Item</);
  assert.match(storefrontSource, />Details</);
  assert.match(storefrontSource, /"Update Quote List"/);
});

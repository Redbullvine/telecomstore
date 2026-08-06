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
const productCardSource = await readFile(new URL("../src/components/storefront/ProductCard.jsx", import.meta.url), "utf8");
const productDetailSource = await readFile(new URL("../src/components/storefront/ProductDetailPage.jsx", import.meta.url), "utf8");
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

test("catalog states the payment confirmation boundary and merchandise prices remain quote-only", () => {
  assert.match(storefrontSource, /Availability and shipping are confirmed before payment\./);
  assert.match(storefrontSource, /Merchandise price · \$/);
  assert.match(`${productCardSource}\n${productDetailSource}`, /Request Shipping Quote/);
  assert.doesNotMatch(storefrontSource, /available SKUs|Same-day quotes|Nationwide shipping|Pallet &amp; freight ready/);
});

test("quote-to-payment wording is customer-facing and promises nothing unconfirmed", () => {
  // The secure-payment offer must stay conditional on confirmed amounts and
  // must appear on both the Quote List and the quote form.
  assert.match(
    storefrontSource,
    /Secure card payment is available after merchandise, shipping, and tax are confirmed\./
  );
  assert.match(storefrontSource, /Secure checkout powered by Stripe/);
  assert.equal(storefrontSource.match(/\{SECURE_PAYMENT_DISCLOSURE\}/g)?.length, 2);
  assert.equal(storefrontSource.match(/\{STRIPE_TRUST_LABEL\}/g)?.length, 2);

  // No universal Buy Now. The direct-purchase control is not unconditional:
  // it only renders behind isPurchasable(), and the shipped pricing bundle has
  // zero checkout-enabled products (see opening-pricing tests), so every
  // product routes to the quote flow. Nothing offers payment before review.
  assert.doesNotMatch(storefrontSource, /Buy Now/i);
  for (const match of storefrontSource.matchAll(/"(Add to Cart|Update Cart|In Cart)"/g)) {
    const line = storefrontSource.slice(0, match.index).split(/\r?\n/).length;
    const context = storefrontSource.split(/\r?\n/).slice(line - 3, line).join("\n");
    assert.match(
      context,
      /isPurchasable\(product\)/,
      `direct-purchase control at line ${line} must stay gated behind isPurchasable()`
    );
  }

  // Claims Petra freight and fulfillment cannot support.
  assert.doesNotMatch(
    storefrontSource,
    /Free shipping|Ships same day|Same-day shipment|Guaranteed delivery|Pay now to reserve/i
  );
});

test("quote controls remain available on product cards and details", () => {
  assert.match(storefrontSource, /"Add to Quote"/);
  assert.match(storefrontSource, />Ask About This Item</);
  assert.match(storefrontSource, />Details</);
  assert.match(storefrontSource, /"Update Quote List"/);
});

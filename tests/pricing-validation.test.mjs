import test from "node:test";
import assert from "node:assert/strict";
import { validatePricingRows } from "../scripts/lib/pricing-validation.mjs";

const catalog = [{ sku: "PUBLIC-1", title: "Approved title" }];
const base = { public_sku: "PUBLIC-1", approved_title: "Approved title", public_price: "", checkout_active: "false", shipping_class: "", taxable: "false", stripe_price_id: "", allowed_countries: "", stripe_shipping_rate_id: "", automatic_tax: "false", notes: "" };

test("quote-only blank pricing validates", () => assert.equal(validatePricingRows([base], catalog).length, 1));
test("rejects duplicates, unknown IDs, malformed and negative prices", () => {
  assert.throws(() => validatePricingRows([base, base], catalog), /Duplicate/);
  assert.throws(() => validatePricingRows([{ ...base, public_sku: "SUPPLIER-9" }], catalog), /Unknown/);
  assert.throws(() => validatePricingRows([{ ...base, public_price: "oops" }], catalog), /Invalid/);
  assert.throws(() => validatePricingRows([{ ...base, public_price: "-1" }], catalog), /Invalid/);
});
test("rejects incomplete price, shipping, and tax activation", () => {
  assert.throws(() => validatePricingRows([{ ...base, checkout_active: "true" }], catalog), /positive/);
  assert.throws(() => validatePricingRows([{ ...base, checkout_active: "true", public_price: "10" }], catalog), /shipping/);
  const shipping = { ...base, checkout_active: "true", public_price: "10", shipping_class: "parcel", allowed_countries: "US", stripe_shipping_rate_id: "shr_test", taxable: "true" };
  assert.throws(() => validatePricingRows([shipping], catalog), /automatic_tax/);
  assert.equal(validatePricingRows([{ ...shipping, automatic_tax: "true" }], catalog)[0].checkout_active, true);
});
test("rejects missing full-catalog rows unless partial is explicit", () => {
  assert.throws(() => validatePricingRows([base], [...catalog, { sku: "PUBLIC-2", title: "Two" }]), /missing/);
  assert.equal(validatePricingRows([base], [...catalog, { sku: "PUBLIC-2", title: "Two" }], { partial: true }).length, 1);
});

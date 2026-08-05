import assert from "node:assert/strict";
import test from "node:test";

import { toCents, centsToDecimal, validatedTotals } from "../netlify/lib/money.mjs";
import {
  isValidEmail,
  isValidPhone,
  isValidQuantity,
  isValidCurrency,
  isValidReturnUrl,
  validateShippingAddress,
  validateQuoteSubmission,
  MAX_QUANTITY_PER_ITEM,
  MAX_ITEMS_PER_REQUEST
} from "../netlify/lib/validation.mjs";

const PRODUCT_A = "11111111-1111-4111-8111-111111111111";
const PRODUCT_B = "22222222-2222-4222-8222-222222222222";

const GOOD_SUBMISSION = {
  customer_name: "Danny Camp",
  customer_email: "buyer@example.com",
  customer_phone: "(918) 555-0100",
  shipping_address: { line1: "1 Main St", city: "Tulsa", state: "OK", postal_code: "74101", country: "US" },
  project_notes: "Job site build-out",
  items: [{ product_id: PRODUCT_A, quantity: 3 }]
};

test("money: toCents parses clean decimals and rejects garbage", () => {
  assert.equal(toCents("10.50"), 1050);
  assert.equal(toCents("0.05"), 5);
  assert.equal(toCents(19.99), 1999);
  assert.equal(toCents("1000"), 100000);
  assert.equal(toCents("-1"), null);
  assert.equal(toCents("1.999"), null);
  assert.equal(toCents("1e5"), null);
  assert.equal(toCents("abc"), null);
  assert.equal(toCents(""), null);
  assert.equal(toCents(null), null);
  assert.equal(toCents("12345678901"), null); // > 10 digit dollars
});

test("money: centsToDecimal round-trips", () => {
  assert.equal(centsToDecimal(1050), "10.50");
  assert.equal(centsToDecimal(5), "0.05");
  assert.equal(centsToDecimal(0), "0.00");
  assert.equal(centsToDecimal(-1), null);
  assert.equal(toCents(centsToDecimal(123456)), 123456);
});

test("money: validatedTotals enforces subtotal + shipping + tax = final", () => {
  assert.deepEqual(
    validatedTotals({ productSubtotal: "100.00", shippingAmount: "20.00", taxAmount: "9.90", finalTotal: "129.90" }),
    { subtotal: 10000, shipping: 2000, tax: 990, total: 12990 }
  );
  assert.equal(validatedTotals({ productSubtotal: "100.00", shippingAmount: "20.00", taxAmount: "9.90", finalTotal: "129.91" }), null);
  assert.equal(validatedTotals({ productSubtotal: "0.00", shippingAmount: "0.00", taxAmount: "0.00", finalTotal: "0.00" }), null); // zero total refused
  assert.equal(validatedTotals({ productSubtotal: "-5.00", shippingAmount: "0.00", taxAmount: "0.00", finalTotal: "-5.00" }), null);
});

test("validators: email, phone, quantity, currency", () => {
  assert.equal(isValidEmail("a@b.co"), true);
  assert.equal(isValidEmail("bad@@x"), false);
  assert.equal(isValidEmail("no-at.example.com"), false);
  assert.equal(isValidPhone("(918) 555-0100"), true);
  assert.equal(isValidPhone("123"), false);
  assert.equal(isValidQuantity(1), true);
  assert.equal(isValidQuantity(MAX_QUANTITY_PER_ITEM), true);
  assert.equal(isValidQuantity(MAX_QUANTITY_PER_ITEM + 1), false);
  assert.equal(isValidQuantity(0), false);
  assert.equal(isValidQuantity(-2), false);
  assert.equal(isValidQuantity(2.5), false);
  assert.equal(isValidCurrency("USD"), true);
  assert.equal(isValidCurrency("EUR"), false);
});

test("validators: return URLs must be https on our own origin", () => {
  const site = "https://telecomstore.net";
  assert.equal(isValidReturnUrl("https://telecomstore.net/payment-success.html", site), true);
  assert.equal(isValidReturnUrl("https://evil.example.com/steal", site), false);
  assert.equal(isValidReturnUrl("http://telecomstore.net/payment-success.html", site), false);
  assert.equal(isValidReturnUrl("javascript:alert(1)", site), false);
  assert.equal(isValidReturnUrl("https://telecomstore.net.evil.com/x", site), false);
});

test("shipping address requires the full field set", () => {
  assert.equal(validateShippingAddress(GOOD_SUBMISSION.shipping_address).ok, true);
  assert.equal(validateShippingAddress({ ...GOOD_SUBMISSION.shipping_address, city: "" }).ok, false);
  assert.equal(validateShippingAddress({ ...GOOD_SUBMISSION.shipping_address, country: "USA" }).ok, false);
  assert.equal(validateShippingAddress(null).ok, false);
  assert.equal(validateShippingAddress([]).ok, false);
});

test("quote submission: accepts a clean request and normalizes it", () => {
  const result = validateQuoteSubmission(GOOD_SUBMISSION);
  assert.equal(result.ok, true);
  assert.equal(result.submission.customer_email, "buyer@example.com");
  assert.deepEqual(result.submission.items, [{ product_id: PRODUCT_A, quantity: 3 }]);
});

test("quote submission: rejects hostile inputs", () => {
  const reject = (patch) => assert.equal(validateQuoteSubmission({ ...GOOD_SUBMISSION, ...patch }).ok, false);
  reject({ customer_email: "not-an-email" });
  reject({ customer_name: "   " });
  reject({ items: [] });
  reject({ items: [{ product_id: "not-a-uuid", quantity: 1 }] });
  reject({ items: [{ product_id: PRODUCT_A, quantity: 0 }] });
  reject({ items: [{ product_id: PRODUCT_A, quantity: -3 }] });
  reject({ items: [{ product_id: PRODUCT_A, quantity: 99999999 }] });
  reject({ items: [{ product_id: PRODUCT_A, quantity: 1 }, { product_id: PRODUCT_A, quantity: 2 }] }); // duplicate
  reject({
    items: Array.from({ length: MAX_ITEMS_PER_REQUEST + 1 }, (_, i) => ({
      product_id: `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`,
      quantity: 1
    }))
  });
});

test("quote submission: filled honeypot is silently rejected", () => {
  const result = validateQuoteSubmission({ ...GOOD_SUBMISSION, website: "http://spam.example" });
  assert.equal(result.ok, false);
  assert.equal(result.silent, true);
});

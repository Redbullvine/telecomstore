import test from "node:test";
import assert from "node:assert/strict";
import { addCartItem, cartSubtotal, isPurchasable, productPrimaryAction, reconcileCart, removeCartItem, updateCartQuantity } from "../src/lib/commerce.mjs";

const purchasable = { sku: "PUBLIC-1", price_mode: "fixed", pricing_approved: true, public_price: 12.5, checkout_active: true };
const quote = { sku: "PUBLIC-2", price_mode: "request_quote", pricing_approved: false, public_price: null, checkout_active: false };

test("only explicitly priced and active products are purchasable", () => {
  assert.equal(isPurchasable(purchasable), true);
  assert.equal(isPurchasable(quote), false);
  assert.equal(isPurchasable({ ...purchasable, pricing_approved: false }), false);
  assert.equal(productPrimaryAction(quote), "quote");
});
test("cart helpers add, cap, update, remove, reconcile, and total", () => {
  let cart = addCartItem([], purchasable, 2);
  cart = addCartItem(cart, purchasable, 200);
  assert.equal(cart[0].quantity, 99);
  assert.equal(cartSubtotal(cart, [purchasable]), 1237.5);
  cart = updateCartQuantity(cart, "PUBLIC-1", 3);
  assert.equal(cart[0].quantity, 3);
  assert.deepEqual(reconcileCart([...cart, { sku: "PUBLIC-2", quantity: 1 }], [purchasable, quote]), cart);
  assert.deepEqual(removeCartItem(cart, "PUBLIC-1"), []);
  assert.deepEqual(addCartItem([], quote), []);
});

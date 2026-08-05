export const MAX_CART_QUANTITY = 99;

export function isPurchasable(product = {}) {
  return product.pricing_approved === true && product.checkout_active === true && product.price_mode === "fixed" && Number(product.public_price ?? product.price) > 0;
}
export function productPrimaryAction(product = {}) {
  return isPurchasable(product) ? "purchase" : "quote";
}

export function addCartItem(cart, product, quantity = 1) {
  if (!isPurchasable(product)) return cart;
  const qty = Math.min(MAX_CART_QUANTITY, Math.max(1, Math.trunc(Number(quantity) || 1)));
  const existing = cart.find((item) => item.sku === product.sku);
  if (existing) return cart.map((item) => item.sku === product.sku ? { ...item, quantity: Math.min(MAX_CART_QUANTITY, item.quantity + qty) } : item);
  return [...cart, { sku: product.sku, quantity: qty }];
}

export function updateCartQuantity(cart, sku, quantity) {
  const qty = Math.trunc(Number(quantity));
  if (!Number.isFinite(qty) || qty <= 0) return cart.filter((item) => item.sku !== sku);
  return cart.map((item) => item.sku === sku ? { ...item, quantity: Math.min(MAX_CART_QUANTITY, qty) } : item);
}

export function removeCartItem(cart, sku) { return cart.filter((item) => item.sku !== sku); }

export function reconcileCart(cart, products) {
  const bySku = new Map(products.map((product) => [product.sku, product]));
  return cart.filter((item) => isPurchasable(bySku.get(item.sku))).map((item) => ({
    sku: item.sku, quantity: Math.min(MAX_CART_QUANTITY, Math.max(1, Math.trunc(Number(item.quantity) || 1)))
  }));
}

export function cartSubtotal(cart, products) {
  const bySku = new Map(products.map((product) => [product.sku, product]));
  return cart.reduce((total, item) => total + Number(bySku.get(item.sku)?.public_price || 0) * item.quantity, 0);
}

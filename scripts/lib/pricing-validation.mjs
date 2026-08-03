const REQUIRED_COLUMNS = [
  "public_sku", "approved_title", "public_price", "checkout_active", "shipping_class",
  "taxable", "stripe_price_id", "allowed_countries", "stripe_shipping_rate_id", "automatic_tax", "notes"
];

export function parseBoolean(value, field, sku) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`${field} must be true or false for ${sku}`);
}
export function validatePricingRows(rows, catalog, { partial = false } = {}) {
  if (!Array.isArray(rows) || !rows.length) throw new Error("Pricing file is empty");
  const missingColumns = REQUIRED_COLUMNS.filter((column) => !(column in rows[0]));
  if (missingColumns.length) throw new Error(`Missing pricing columns: ${missingColumns.join(", ")}`);

  const products = new Map(catalog.map((product) => [product.sku, product]));
  const seen = new Set();
  const normalized = rows.map((row) => {
    const sku = String(row.public_sku || "").trim();
    if (!sku) throw new Error("public_sku is required");
    if (seen.has(sku)) throw new Error(`Duplicate public_sku: ${sku}`);
    seen.add(sku);
    const product = products.get(sku);
    if (!product) throw new Error(`Unknown public_sku: ${sku}`);
    if (String(row.approved_title || "").trim() !== product.title) throw new Error(`Approved title mismatch for ${sku}`);

    const rawPrice = String(row.public_price ?? "").trim();
    const price = rawPrice === "" ? null : Number(rawPrice);
    if (price !== null && (!Number.isFinite(price) || price < 0)) throw new Error(`Invalid public_price for ${sku}`);
    const checkoutActive = parseBoolean(row.checkout_active, "checkout_active", sku);
    const taxable = parseBoolean(row.taxable, "taxable", sku);
    const automaticTax = parseBoolean(row.automatic_tax, "automatic_tax", sku);
    const shippingClass = String(row.shipping_class || "").trim();
    const allowedCountries = String(row.allowed_countries || "").split("|").map((v) => v.trim().toUpperCase()).filter(Boolean);
    const shippingRateId = String(row.stripe_shipping_rate_id || "").trim();
    const stripePriceId = String(row.stripe_price_id || "").trim();

    if (checkoutActive && !(price > 0)) throw new Error(`Checkout requires a positive public_price for ${sku}`);
    if (checkoutActive && (!shippingClass || !allowedCountries.length || !shippingRateId)) {
      throw new Error(`Checkout requires an explicit shipping class, countries, and Stripe shipping rate for ${sku}`);
    }
    if (checkoutActive && taxable && !automaticTax) throw new Error(`Taxable checkout requires automatic_tax for ${sku}`);
    if (allowedCountries.some((country) => !/^[A-Z]{2}$/.test(country))) throw new Error(`Invalid country code for ${sku}`);

    return {
      public_sku: sku,
      title: product.title,
      public_price: price,
      price_mode: checkoutActive ? "fixed" : "request_quote",
      checkout_active: checkoutActive,
      shipping_class: shippingClass || null,
      taxable: taxable,
      stripe_price_id: stripePriceId || null,
      allowed_countries: allowedCountries,
      stripe_shipping_rate_id: shippingRateId || null,
      automatic_tax: automaticTax
    };
  });

  if (!partial && seen.size !== products.size) {
    const missing = [...products.keys()].filter((sku) => !seen.has(sku));
    throw new Error(`Pricing rows missing ${missing.length} catalog products: ${missing.slice(0, 5).join(", ")}`);
  }
  return normalized;
}

export function publicPricing(rows) {
  return rows.map(({ public_sku, public_price, checkout_active, price_mode }) => ({
    public_sku, public_price, checkout_active, price_mode
  }));
}

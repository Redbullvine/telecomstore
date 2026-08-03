const MAX_QUANTITY = 99;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export function createCheckoutHandler({ pricing, createSession, siteUrl }) {
  const bySku = new Map(pricing.map((row) => [row.public_sku, row]));
  return async (request) => {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    let payload;
    try { payload = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
    if (!payload || !Array.isArray(payload.items) || !payload.items.length) return json({ error: "Cart is empty" }, 400);
    if (payload.items.length > 50) return json({ error: "Too many line items" }, 400);

    const merged = new Map();
    for (const item of payload.items) {
      if (!item || Object.keys(item).some((key) => !["sku", "quantity"].includes(key))) return json({ error: "Cart items may contain only sku and quantity" }, 400);
      const sku = String(item.sku || "").trim();
      const quantity = Number(item.quantity);
      if (!sku || sku.length > 64 || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) return json({ error: "Invalid cart item" }, 400);
      merged.set(sku, (merged.get(sku) || 0) + quantity);
      if (merged.get(sku) > MAX_QUANTITY) return json({ error: `Quantity exceeds limit for ${sku}` }, 400);
    }

    const rows = [];
    for (const [sku, quantity] of merged) {
      const row = bySku.get(sku);
      if (!row) return json({ error: `Unknown product: ${sku}` }, 400);
      if (!row.checkout_active || row.price_mode !== "fixed" || !(Number(row.public_price) > 0)) return json({ error: `${sku} requires a quote` }, 400);
      if (!row.shipping_class || !row.stripe_shipping_rate_id || !row.allowed_countries?.length) return json({ error: `${sku} is not configured for shipping` }, 409);
      if (row.taxable && !row.automatic_tax) return json({ error: `${sku} is not configured for tax` }, 409);
      rows.push({ row, quantity });
    }

    const shippingRates = new Set(rows.map(({ row }) => row.stripe_shipping_rate_id));
    const shippingClasses = new Set(rows.map(({ row }) => row.shipping_class));
    if (shippingRates.size !== 1 || shippingClasses.size !== 1) return json({ error: "Mixed shipping configurations require a quote" }, 409);
    const countries = rows.map(({ row }) => new Set(row.allowed_countries)).reduce((allowed, next) => new Set([...allowed].filter((code) => next.has(code))));
    if (!countries.size) return json({ error: "No common shipping destination is configured" }, 409);
    const automaticTax = rows.some(({ row }) => row.taxable);

    const lineItems = rows.map(({ row, quantity }) => row.stripe_price_id
      ? { price: row.stripe_price_id, quantity }
      : { price_data: { currency: "usd", unit_amount: Math.round(Number(row.public_price) * 100), product_data: { name: row.title, metadata: { public_sku: row.public_sku } } }, quantity });
    try {
      const session = await createSession({
        mode: "payment", line_items: lineItems,
        customer_creation: "always",
        billing_address_collection: "required",
        shipping_address_collection: { allowed_countries: [...countries] },
        shipping_options: [{ shipping_rate: [...shippingRates][0] }],
        phone_number_collection: { enabled: true },
        automatic_tax: { enabled: automaticTax },
        success_url: `${siteUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${siteUrl}/checkout/cancel`,
        metadata: { public_skus: rows.map(({ row, quantity }) => `${row.public_sku}:${quantity}`).join(",").slice(0, 500) }
      });
      const url = new URL(session.url);
      if (url.protocol !== "https:" || !url.hostname.endsWith("stripe.com")) throw new Error("Unexpected checkout URL");
      return json({ url: url.toString() });
    } catch (error) {
      console.error("Checkout session creation failed", error instanceof Error ? error.message : "unknown error");
      return json({ error: "Checkout is temporarily unavailable" }, 502);
    }
  };
}

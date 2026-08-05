// POST /api/checkout-session — direct storefront checkout.
//
// HARD GATE: a product can only be purchased directly when ALL hold:
//   * the product exists, is status 'available', and has a curated price
//   * an admin has explicitly approved it in product_checkout_approvals
//   * quantity is within the approved per-product limit
//   * shipping and tax rules are resolvable for the destination
//
// product_checkout_approvals is EMPTY today and shipping/tax rules are not
// yet defined, so this endpoint correctly refuses every request in
// production. That is intentional: direct checkout stays off until pricing
// truthfulness is guaranteed. Customers fall back to quote-to-payment.

import { getServiceClient } from "../lib/supabase-admin.mjs";
import { getStripe, idempotencyKey } from "../lib/stripe-client.mjs";
import { getReturnUrls, getSiteUrl } from "../lib/env.mjs";
import { toCents } from "../lib/money.mjs";
import { isValidUuid, isValidQuantity, isValidEmail, isValidReturnUrl } from "../lib/validation.mjs";
import { json, publicError, methodNotAllowed, readJsonBody, logServerError, GENERIC_ERROR } from "../lib/http.mjs";

const QUOTE_FALLBACK_MESSAGE =
  "Direct checkout is not available for these items yet. Please use Request to Purchase and we will send a secure payment link.";

// Shipping/tax resolution is deliberately unimplemented. When real rules
// exist (carrier rates + tax registration), implement this and direct
// checkout turns on per approved product. Never invent shipping or assume
// zero tax here.
function resolveShippingAndTax() {
  return null;
}

export default async function handler(req) {
  if (req.method !== "POST") return methodNotAllowed();

  const service = getServiceClient();
  const stripe = getStripe();
  if (!service || !stripe) return publicError(503, "Checkout is temporarily unavailable.");

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return publicError(400, "Please check your cart and try again.");
  const body = parsed.body;

  if (body.customer_email !== undefined && !isValidEmail(body.customer_email)) {
    return publicError(400, "Please provide a valid email.");
  }
  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 20) {
    return publicError(400, "Please check your cart and try again.");
  }
  for (const item of body.items) {
    if (!item || !isValidUuid(item.product_id) || !isValidQuantity(Number(item.quantity))) {
      return publicError(400, "Please check your cart and try again.");
    }
  }

  try {
    const productIds = body.items.map((item) => item.product_id);

    // Server-side product + approval + price lookup. The browser's idea of a
    // price is never read; a manipulated price cannot exist in this flow.
    const [{ data: products, error: productsError }, { data: approvals, error: approvalsError }] =
      await Promise.all([
        service.from("products").select("id, title, sku, price, currency_code, status").in("id", productIds),
        service.from("product_checkout_approvals").select("product_id, approved, max_quantity").in("product_id", productIds)
      ]);
    if (productsError) throw new Error(`product lookup failed: ${productsError.message}`);
    if (approvalsError) throw new Error(`approval lookup failed: ${approvalsError.message}`);

    const productById = new Map((products || []).map((p) => [p.id, p]));
    const approvalById = new Map((approvals || []).map((a) => [a.product_id, a]));

    const lineItems = [];
    for (const item of body.items) {
      const product = productById.get(item.product_id);
      const approval = approvalById.get(item.product_id);
      const quantity = Number(item.quantity);
      const priceCents = product ? toCents(product.price) : null;
      const eligible =
        product
        && product.status === "available"
        && priceCents !== null
        && priceCents > 0
        && approval?.approved === true
        && quantity <= approval.max_quantity;
      if (!eligible) return publicError(403, QUOTE_FALLBACK_MESSAGE);

      lineItems.push({
        quantity,
        price_data: {
          currency: (product.currency_code || "USD").toLowerCase(),
          unit_amount: priceCents,
          product_data: { name: product.title, metadata: { product_id: product.id } }
        }
      });
    }

    // Shipping and tax must be truthful or checkout does not proceed.
    const shippingAndTax = resolveShippingAndTax();
    if (!shippingAndTax) return publicError(403, QUOTE_FALLBACK_MESSAGE);

    const siteUrl = getSiteUrl();
    const { successUrl, cancelUrl } = getReturnUrls();
    if (!isValidReturnUrl(successUrl, siteUrl) || !isValidReturnUrl(cancelUrl, siteUrl)) {
      return publicError(503, "Checkout is temporarily unavailable.");
    }

    const totalCents = lineItems.reduce((sum, li) => sum + li.price_data.unit_amount * li.quantity, 0);
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: lineItems,
        success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: cancelUrl,
        customer_email: body.customer_email || undefined,
        shipping_address_collection: { allowed_countries: ["US"] },
        metadata: { source: "direct_checkout" }
      },
      { idempotencyKey: idempotencyKey("checkout", productIds.sort().join("-").slice(0, 80), totalCents) }
    );

    return json(200, { ok: true, checkout_url: session.url });
  } catch (error) {
    logServerError("checkout-session", error, {});
    return publicError(500, GENERIC_ERROR);
  }
}

export const config = { path: "/api/checkout-session" };

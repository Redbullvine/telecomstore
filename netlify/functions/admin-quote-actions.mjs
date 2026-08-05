// POST /api/admin/quotes/:id/:action — admin mutations for the quote-to-
// payment pipeline. Every action requires an authenticated, approved admin
// (Supabase Bearer token) and runs entirely server-side: amounts are
// validated here, Stripe objects are created here, and status transitions are
// enforced here AND by the database trigger.
//
// Actions: review, amounts, invoice, payment-link, resend, cancel, refund,
//          fulfill, note

import { requireAdmin } from "../lib/auth.mjs";
import { getServiceClient } from "../lib/supabase-admin.mjs";
import { getStripe, idempotencyKey } from "../lib/stripe-client.mjs";
import { getStripeConfig, getReturnUrls, getSiteUrl } from "../lib/env.mjs";
import { validatedTotals, toCents, centsToDecimal } from "../lib/money.mjs";
import { canTransition } from "../lib/transitions.mjs";
import { applyStatusChange } from "../lib/quotes.mjs";
import { isValidUuid, isValidCurrency, isValidReturnUrl, cleanText, MAX_NOTES_LENGTH } from "../lib/validation.mjs";
import { json, publicError, methodNotAllowed, readJsonBody, logServerError, GENERIC_ERROR } from "../lib/http.mjs";

const ACTIONS = new Set([
  "review", "amounts", "invoice", "payment-link", "resend",
  "cancel", "refund", "fulfill", "note"
]);

export default async function handler(req, context) {
  if (req.method !== "POST") return methodNotAllowed();

  const auth = await requireAdmin(req);
  if (!auth.ok) return publicError(auth.status, "Not authorized.");

  const { id, action } = context.params || {};
  if (!isValidUuid(id) || !ACTIONS.has(action)) return publicError(404, "Not found.");

  const service = getServiceClient();
  if (!service) return publicError(503, "Payment system is not configured.");

  const parsed = await readJsonBody(req);
  const body = parsed.ok ? parsed.body : {};

  try {
    const { data: quote, error: quoteError } = await service
      .from("quote_requests")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (quoteError) throw new Error(`quote lookup failed: ${quoteError.message}`);
    if (!quote) return publicError(404, "Not found.");

    const adminId = auth.user.id;
    switch (action) {
      case "review":
        return simpleTransition(service, quote, "reviewing", adminId);
      case "amounts":
        return setAmounts(service, quote, body, adminId);
      case "invoice":
        return createInvoice(service, quote, adminId);
      case "payment-link":
        return createPaymentLink(service, quote, adminId);
      case "resend":
        return resendPayment(service, quote);
      case "cancel":
        return simpleTransition(service, quote, "canceled", adminId, cleanText(body.note, 500) || null);
      case "refund":
        return simpleTransition(service, quote, "refunded", adminId, cleanText(body.note, 500) || "refund recorded by admin");
      case "fulfill":
        return simpleTransition(service, quote, "fulfilled", adminId);
      case "note":
        return addNote(service, quote, body, adminId);
      default:
        return publicError(404, "Not found.");
    }
  } catch (error) {
    logServerError(`admin:${action}`, error, { quoteId: id });
    return publicError(500, GENERIC_ERROR);
  }
}

async function simpleTransition(service, quote, toStatus, adminId, note = null) {
  if (!canTransition(quote.status, toStatus)) {
    return publicError(409, `Cannot move a ${quote.status} request to ${toStatus}.`);
  }
  const updated = await applyStatusChange(service, quote, toStatus, { changedBy: adminId, note });
  if (!updated) return publicError(409, "The request changed while you were working. Reload and retry.");
  return json(200, { ok: true, status: toStatus });
}

// Sets per-item unit prices and the shipping/tax/final totals, then moves the
// request to "quoted". Arithmetic is verified in integer cents; the browser
// can only propose numbers, never skip validation.
async function setAmounts(service, quote, body, adminId) {
  if (!["reviewing", "quoted"].includes(quote.status)) {
    return publicError(409, "Amounts can only be set while a request is in review.");
  }
  if (body.currency_code && !isValidCurrency(body.currency_code)) {
    return publicError(400, "Unsupported currency.");
  }

  const totals = validatedTotals({
    productSubtotal: body.product_subtotal,
    shippingAmount: body.shipping_amount,
    taxAmount: body.tax_amount,
    finalTotal: body.final_total
  });
  if (!totals) return publicError(400, "Totals must be non-negative amounts where subtotal + shipping + tax = final total.");

  const { data: items, error: itemsError } = await service
    .from("quote_request_items")
    .select("id, quantity")
    .eq("quote_request_id", quote.id);
  if (itemsError) throw new Error(`items lookup failed: ${itemsError.message}`);

  const priced = new Map();
  for (const entry of Array.isArray(body.items) ? body.items : []) {
    if (!entry || !isValidUuid(entry.id)) return publicError(400, "Invalid item pricing.");
    const unitCents = toCents(entry.unit_amount);
    if (unitCents === null) return publicError(400, "Invalid item pricing.");
    priced.set(entry.id, unitCents);
  }

  let lineSum = 0;
  const itemUpdates = [];
  for (const item of items) {
    if (!priced.has(item.id)) return publicError(400, "Every item needs a unit price.");
    const unitCents = priced.get(item.id);
    const lineCents = unitCents * item.quantity;
    lineSum += lineCents;
    itemUpdates.push({ id: item.id, unit: unitCents, line: lineCents });
  }
  if (priced.size !== items.length) return publicError(400, "Unknown item in pricing payload.");
  if (lineSum !== totals.subtotal) {
    return publicError(400, "Item line totals must add up to the product subtotal.");
  }

  for (const update of itemUpdates) {
    const { error } = await service
      .from("quote_request_items")
      .update({ unit_amount: centsToDecimal(update.unit), line_total: centsToDecimal(update.line) })
      .eq("id", update.id);
    if (error) throw new Error(`item price update failed: ${error.message}`);
  }

  const extra = {
    product_subtotal: centsToDecimal(totals.subtotal),
    shipping_amount: centsToDecimal(totals.shipping),
    tax_amount: centsToDecimal(totals.tax),
    final_total: centsToDecimal(totals.total),
    currency_code: (body.currency_code || quote.currency_code || "USD").toUpperCase(),
    quoted_by: adminId
  };

  if (quote.status === "quoted") {
    // Re-pricing an already-quoted request: amounts change, status stays.
    const { error } = await service.from("quote_requests").update(extra).eq("id", quote.id);
    if (error) throw new Error(`quote amounts update failed: ${error.message}`);
    return json(200, { ok: true, status: "quoted" });
  }

  const updated = await applyStatusChange(service, quote, "quoted", { changedBy: adminId, extra });
  if (!updated) return publicError(409, "The request changed while you were working. Reload and retry.");
  return json(200, { ok: true, status: "quoted" });
}

function requireQuotedWithTotals(quote) {
  if (quote.status !== "quoted") {
    return "A Stripe invoice or payment link can only be created for a quoted request.";
  }
  const totals = validatedTotals({
    productSubtotal: quote.product_subtotal,
    shippingAmount: quote.shipping_amount,
    taxAmount: quote.tax_amount,
    finalTotal: quote.final_total
  });
  if (!totals) return "This request does not have a complete, consistent set of amounts.";
  return totals;
}

async function ensureStripeCustomer(stripe, quote) {
  return stripe.customers.create(
    {
      email: quote.customer_email,
      name: quote.customer_name,
      phone: quote.customer_phone || undefined,
      metadata: { quote_request_id: quote.id, reference_code: quote.reference_code }
    },
    { idempotencyKey: idempotencyKey("customer", quote.id, 0) }
  );
}

async function createInvoice(service, quote, adminId) {
  const stripe = getStripe();
  const { mode } = getStripeConfig();
  if (!stripe) return publicError(503, "Stripe is not configured.");

  const gate = requireQuotedWithTotals(quote);
  if (typeof gate === "string") return publicError(409, gate);
  const totals = gate;

  const { data: items, error: itemsError } = await service
    .from("quote_request_items")
    .select("id, product_title, product_sku, quantity, unit_amount, line_total")
    .eq("quote_request_id", quote.id);
  if (itemsError) throw new Error(`items lookup failed: ${itemsError.message}`);
  if (!items?.length || items.some((item) => item.unit_amount === null)) {
    return publicError(409, "All items must be priced before invoicing.");
  }

  const customer = quote.stripe_customer_id
    ? { id: quote.stripe_customer_id }
    : await ensureStripeCustomer(stripe, quote);

  const currency = (quote.currency_code || "USD").toLowerCase();
  const invoice = await stripe.invoices.create(
    {
      customer: customer.id,
      collection_method: "send_invoice",
      days_until_due: 14,
      currency,
      auto_advance: false,
      metadata: { quote_request_id: quote.id, reference_code: quote.reference_code }
    },
    { idempotencyKey: idempotencyKey("invoice", quote.id, totals.total) }
  );

  // Line items: curated titles only — never supplier identity or cost.
  for (const item of items) {
    await stripe.invoiceItems.create(
      {
        customer: customer.id,
        invoice: invoice.id,
        amount: toCents(item.line_total),
        currency,
        description: `${item.product_title}${item.product_sku ? ` (${item.product_sku})` : ""} × ${item.quantity}`
      },
      { idempotencyKey: idempotencyKey(`invitem-${item.id}`, quote.id, toCents(item.line_total)) }
    );
  }
  if (totals.shipping > 0) {
    await stripe.invoiceItems.create(
      { customer: customer.id, invoice: invoice.id, amount: totals.shipping, currency, description: "Shipping" },
      { idempotencyKey: idempotencyKey("invship", quote.id, totals.shipping) }
    );
  }
  if (totals.tax > 0) {
    await stripe.invoiceItems.create(
      { customer: customer.id, invoice: invoice.id, amount: totals.tax, currency, description: "Sales tax" },
      { idempotencyKey: idempotencyKey("invtax", quote.id, totals.tax) }
    );
  }

  const finalized = await stripe.invoices.finalizeInvoice(invoice.id, {
    idempotencyKey: idempotencyKey("invfinal", quote.id, totals.total)
  });
  await stripe.invoices.sendInvoice(finalized.id, {
    idempotencyKey: idempotencyKey("invsend", quote.id, totals.total)
  });

  const { error: paymentError } = await service.from("payments").upsert(
    {
      quote_request_id: quote.id,
      stripe_object_type: "invoice",
      stripe_object_id: finalized.id,
      amount: quote.final_total,
      currency_code: quote.currency_code,
      status: "pending",
      livemode: mode === "live"
    },
    { onConflict: "stripe_object_type,stripe_object_id" }
  );
  if (paymentError) throw new Error(`payment record failed: ${paymentError.message}`);

  const updated = await applyStatusChange(service, quote, "payment_sent", {
    changedBy: adminId,
    note: `stripe invoice ${finalized.id}`,
    extra: { stripe_customer_id: customer.id, stripe_invoice_id: finalized.id }
  });
  if (!updated) return publicError(409, "The request changed while you were working. Reload and retry.");

  return json(200, {
    ok: true,
    status: "payment_sent",
    stripe_invoice_id: finalized.id,
    hosted_invoice_url: finalized.hosted_invoice_url || null
  });
}

async function createPaymentLink(service, quote, adminId) {
  const stripe = getStripe();
  const { mode } = getStripeConfig();
  if (!stripe) return publicError(503, "Stripe is not configured.");

  const gate = requireQuotedWithTotals(quote);
  if (typeof gate === "string") return publicError(409, gate);
  const totals = gate;

  const { successUrl } = getReturnUrls();
  const siteUrl = getSiteUrl();
  if (!isValidReturnUrl(successUrl, siteUrl)) {
    return publicError(503, "Payment redirect URLs are not configured.");
  }

  const currency = (quote.currency_code || "USD").toLowerCase();
  const price = await stripe.prices.create(
    {
      unit_amount: totals.total,
      currency,
      product_data: { name: `Telecom Store — Quote ${quote.reference_code}` }
    },
    { idempotencyKey: idempotencyKey("linkprice", quote.id, totals.total) }
  );

  const link = await stripe.paymentLinks.create(
    {
      line_items: [{ price: price.id, quantity: 1 }],
      metadata: { quote_request_id: quote.id, reference_code: quote.reference_code },
      after_completion: { type: "redirect", redirect: { url: successUrl } }
    },
    { idempotencyKey: idempotencyKey("link", quote.id, totals.total) }
  );

  const { error: paymentError } = await service.from("payments").upsert(
    {
      quote_request_id: quote.id,
      stripe_object_type: "payment_link",
      stripe_object_id: link.id,
      amount: quote.final_total,
      currency_code: quote.currency_code,
      status: "pending",
      livemode: mode === "live"
    },
    { onConflict: "stripe_object_type,stripe_object_id" }
  );
  if (paymentError) throw new Error(`payment record failed: ${paymentError.message}`);

  const updated = await applyStatusChange(service, quote, "payment_sent", {
    changedBy: adminId,
    note: `stripe payment link ${link.id}`,
    extra: { stripe_payment_link_id: link.id, stripe_payment_link_url: link.url }
  });
  if (!updated) return publicError(409, "The request changed while you were working. Reload and retry.");

  return json(200, { ok: true, status: "payment_sent", payment_link_url: link.url });
}

async function resendPayment(service, quote) {
  const stripe = getStripe();
  if (!stripe) return publicError(503, "Stripe is not configured.");
  if (quote.status !== "payment_sent") {
    return publicError(409, "Only a request with an outstanding payment can be resent.");
  }
  if (quote.stripe_invoice_id) {
    const invoice = await stripe.invoices.sendInvoice(quote.stripe_invoice_id);
    return json(200, { ok: true, resent: "invoice", hosted_invoice_url: invoice.hosted_invoice_url || null });
  }
  if (quote.stripe_payment_link_url) {
    return json(200, { ok: true, resent: "payment_link", payment_link_url: quote.stripe_payment_link_url });
  }
  return publicError(409, "No payment vehicle exists for this request.");
}

async function addNote(service, quote, body, adminId) {
  const note = cleanText(body.body, MAX_NOTES_LENGTH);
  if (!note) return publicError(400, "Note text is required.");
  const { error } = await service.from("quote_request_notes").insert({
    quote_request_id: quote.id,
    author: adminId,
    body: note
  });
  if (error) throw new Error(`note insert failed: ${error.message}`);
  return json(200, { ok: true });
}

export const config = { path: "/api/admin/quotes/:id/:action" };

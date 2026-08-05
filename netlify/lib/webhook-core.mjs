// Quote-to-payment webhook processing.
//
// This module plugs into the unified webhook handler
// (netlify/functions/_shared/webhook-core.mjs) as its `quoteProcessor`.
// Signature verification, livemode matching, and the durable stripe_events
// ledger (dedup + failed-event reopen) all live in that handler; this module
// only decides whether an already-verified event belongs to the QUOTE system
// and, if so, applies guarded quote/payment state transitions.
//
// Contract: processQuoteEvent returns the string "unclaimed" when the event
// belongs to the direct-checkout order system (or to nothing); any other
// return value means the quote system owns the event. "ignored:*" results are
// recorded as skipped by the caller, everything else as processed.

import { applyStatusChange } from "./quotes.mjs";
import { canTransition } from "./transitions.mjs";
import { centsToDecimal } from "./money.mjs";

export const UNCLAIMED = "unclaimed";

// Event types the quote system can ever own. Invoices and payment links are
// exclusively quote vehicles; sessions/charges/intents are shared with the
// direct-checkout system and claimed only when they match a quote.
export const QUOTE_EVENT_TYPES = [
  "checkout.session.completed",
  "checkout.session.expired",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.voided",
  "invoice.marked_uncollectible",
  "payment_intent.payment_failed",
  "charge.refunded"
];

async function findQuoteByStripeRef(deps, column, value) {
  if (!value) return null;
  const { data, error } = await deps.service
    .from("quote_requests")
    .select("*")
    .eq(column, value)
    .maybeSingle();
  if (error) throw new Error(`quote lookup failed: ${error.message}`);
  return data;
}

async function findQuoteForEvent(deps, object) {
  // Prefer our own metadata written at creation time; fall back to object ids.
  const metaId = object?.metadata?.quote_request_id;
  if (metaId) {
    const { data, error } = await deps.service
      .from("quote_requests").select("*").eq("id", metaId).maybeSingle();
    if (error) throw new Error(`quote lookup failed: ${error.message}`);
    if (data) return data;
  }
  if (object?.object === "checkout.session") {
    return (await findQuoteByStripeRef(deps, "stripe_checkout_session_id", object.id))
      || (await findQuoteByStripeRef(deps, "stripe_payment_link_id", object.payment_link));
  }
  if (object?.object === "invoice") {
    return findQuoteByStripeRef(deps, "stripe_invoice_id", object.id);
  }
  if (object?.object === "charge" || object?.object === "payment_intent") {
    return findQuoteByStripeRef(deps, "stripe_payment_intent_id", object.payment_intent || object.id);
  }
  return null;
}

async function updatePaymentByObject(deps, objectType, objectId, patch) {
  const { data, error } = await deps.service
    .from("payments")
    .update(patch)
    .eq("stripe_object_type", objectType)
    .eq("stripe_object_id", objectId)
    .select("id");
  if (error) throw new Error(`payment update failed: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

async function quotePaymentExistsForIntent(deps, paymentIntentId) {
  if (!paymentIntentId) return false;
  const { data, error } = await deps.service
    .from("payments")
    .select("id")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .maybeSingle();
  if (error) throw new Error(`payment lookup failed: ${error.message}`);
  return Boolean(data);
}

async function markQuotePaid(deps, quote, object) {
  // Already paid (duplicate-adjacent event) is a benign no-op; any other
  // ineligible status is a real anomaly worth surfacing in the event ledger.
  if (quote.status === "paid") return "already-paid";
  if (!canTransition(quote.status, "paid")) return "blocked-transition";
  const paymentIntentId =
    typeof object.payment_intent === "string" ? object.payment_intent : object.payment_intent?.id || null;
  const updated = await applyStatusChange(deps.service, quote, "paid", {
    note: `stripe:${object.object}:${object.id}`,
    extra: paymentIntentId ? { stripe_payment_intent_id: paymentIntentId } : {}
  });
  if (!updated) return "already-transitioned";

  const objectType = object.object === "checkout.session" ? "checkout_session" : "invoice";
  const patch = {
    status: "succeeded",
    stripe_payment_intent_id: paymentIntentId,
    stripe_charge_id: typeof object.charge === "string" ? object.charge : object.charge?.id || null
  };
  // Payment-link payments arrive as checkout sessions whose session id was
  // never stored; fall back to the payment_link payment row.
  const direct = await updatePaymentByObject(deps, objectType, object.id, patch);
  if (!direct && object.object === "checkout.session" && object.payment_link) {
    await updatePaymentByObject(deps, "payment_link", object.payment_link, patch);
  }
  return "paid";
}

async function markQuoteRefunded(deps, quote, charge) {
  if (quote.status === "refunded") return "already-refunded";
  if (!canTransition(quote.status, "refunded")) return "blocked-transition";
  const updated = await applyStatusChange(deps.service, quote, "refunded", {
    note: `stripe:charge:${charge.id}`
  });
  if (!updated) return "already-transitioned";

  const refundedCents = Number.isSafeInteger(charge.amount_refunded) ? charge.amount_refunded : null;
  const fullyRefunded = Boolean(charge.refunded);
  const paymentIntentId =
    typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id || null;
  if (paymentIntentId) {
    const { error } = await deps.service
      .from("payments")
      .update({
        status: fullyRefunded ? "refunded" : "partially_refunded",
        stripe_charge_id: charge.id,
        failure_message: refundedCents !== null ? `refunded ${centsToDecimal(refundedCents)}` : null
      })
      .eq("stripe_payment_intent_id", paymentIntentId);
    if (error) throw new Error(`payment refund update failed: ${error.message}`);
  }
  return "refunded";
}

// Processes one verified, non-duplicate Stripe event on behalf of the quote
// system. Returns UNCLAIMED when the direct-checkout system should handle it.
export async function processQuoteEvent(deps, event) {
  if (!QUOTE_EVENT_TYPES.includes(event.type)) return UNCLAIMED;

  const object = event.data?.object;
  if (!object || typeof object !== "object" || typeof object.id !== "string") {
    return UNCLAIMED;
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const quote = await findQuoteForEvent(deps, object);
      if (!quote) return UNCLAIMED; // direct-checkout session
      if (object.payment_status && object.payment_status !== "paid") {
        return "ignored:session-not-paid";
      }
      return markQuotePaid(deps, quote, object);
    }
    case "invoice.paid": {
      const quote = await findQuoteForEvent(deps, object);
      if (!quote) return "ignored:no-matching-quote"; // invoices are always ours
      return markQuotePaid(deps, quote, object);
    }
    case "checkout.session.expired": {
      const patched = await updatePaymentByObject(deps, "checkout_session", object.id, { status: "canceled" });
      if (!patched && object.payment_link) {
        const linkPatched = await updatePaymentByObject(deps, "payment_link", object.payment_link, { status: "canceled" });
        if (linkPatched) return "session-expired";
      }
      return patched ? "session-expired" : UNCLAIMED;
    }
    case "invoice.payment_failed": {
      await updatePaymentByObject(deps, "invoice", object.id, {
        status: "failed",
        failure_message: "invoice payment failed"
      });
      return "invoice-payment-failed";
    }
    case "invoice.voided":
    case "invoice.marked_uncollectible": {
      await updatePaymentByObject(deps, "invoice", object.id, { status: "canceled" });
      return "invoice-canceled";
    }
    case "payment_intent.payment_failed": {
      if (!(await quotePaymentExistsForIntent(deps, object.id))) return UNCLAIMED;
      const { error } = await deps.service
        .from("payments")
        .update({ status: "failed", failure_message: "payment intent failed" })
        .eq("stripe_payment_intent_id", object.id);
      if (error) throw new Error(`payment update failed: ${error.message}`);
      return "payment-intent-failed";
    }
    case "charge.refunded": {
      const quote = await findQuoteForEvent(deps, object);
      if (!quote) return UNCLAIMED; // direct-checkout refund
      return markQuoteRefunded(deps, quote, object);
    }
    default:
      return UNCLAIMED;
  }
}

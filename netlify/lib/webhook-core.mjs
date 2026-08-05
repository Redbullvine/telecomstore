// Stripe webhook processing core.
//
// Security model:
//   1. Signature verification (stripe.webhooks.constructEvent) happens in the
//      HTTP handler before anything here runs — a forged or tampered payload
//      never reaches this module.
//   2. recordEvent() inserts the Stripe event id into stripe_events, which has
//      a UNIQUE index. A duplicate or replayed event short-circuits to
//      { duplicate: true } and is never processed twice.
//   3. Event types outside HANDLED_EVENT_TYPES are recorded as "ignored".
//   4. livemode on the event must match the mode of our configured key —
//      a test event can never mutate live payment state and vice versa.
//   5. Quote status changes go through applyStatusChange, which enforces the
//      transition table both here and in the database trigger.
//
// All functions take the service client via `deps` so tests can inject fakes.

import { applyStatusChange } from "./quotes.mjs";
import { canTransition } from "./transitions.mjs";
import { centsToDecimal } from "./money.mjs";

export const HANDLED_EVENT_TYPES = [
  "checkout.session.completed",
  "checkout.session.expired",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.voided",
  "invoice.marked_uncollectible",
  "payment_intent.payment_failed",
  "charge.refunded"
];

// Returns { duplicate: boolean, eventRowId? }. Uses the unique index on
// stripe_event_id as the atomic dedup gate.
export async function recordEvent(deps, event) {
  const { data, error } = await deps.service
    .from("stripe_events")
    .upsert(
      {
        stripe_event_id: event.id,
        event_type: event.type,
        api_version: event.api_version || null,
        livemode: Boolean(event.livemode),
        payload: { type: event.type, id: event.id, object_id: event.data?.object?.id || null },
        processing_status: "received"
      },
      { onConflict: "stripe_event_id", ignoreDuplicates: true }
    )
    .select("id")
    .maybeSingle();

  if (error) throw new Error(`stripe event record failed: ${error.message}`);
  if (data) return { duplicate: false, eventRowId: data.id };

  // Already recorded. A Stripe retry of an event we FAILED to process may
  // re-open exactly that row; processed/ignored/in-flight events stay closed.
  const { data: reopened, error: reopenError } = await deps.service
    .from("stripe_events")
    .update({ processing_status: "received", error_message: null })
    .eq("stripe_event_id", event.id)
    .eq("processing_status", "failed")
    .select("id")
    .maybeSingle();
  if (reopenError) throw new Error(`stripe event reopen failed: ${reopenError.message}`);
  if (reopened) return { duplicate: false, eventRowId: reopened.id };

  return { duplicate: true };
}

export async function markEvent(deps, eventRowId, processingStatus, errorMessage = null) {
  const { error } = await deps.service
    .from("stripe_events")
    .update({
      processing_status: processingStatus,
      error_message: errorMessage,
      processed_at: new Date().toISOString()
    })
    .eq("id", eventRowId);
  if (error) throw new Error(`stripe event update failed: ${error.message}`);
}

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
  const { error } = await deps.service
    .from("payments")
    .update(patch)
    .eq("stripe_object_type", objectType)
    .eq("stripe_object_id", objectId);
  if (error) throw new Error(`payment update failed: ${error.message}`);
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
  await updatePaymentByObject(deps, objectType, object.id, {
    status: "succeeded",
    stripe_payment_intent_id: paymentIntentId,
    stripe_charge_id: typeof object.charge === "string" ? object.charge : object.charge?.id || null
  });

  if (quote.id) {
    const { error } = await deps.service
      .from("orders")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("quote_request_id", quote.id);
    if (error) throw new Error(`order update failed: ${error.message}`);
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
  const { error } = await deps.service
    .from("orders")
    .update({ status: "refunded" })
    .eq("quote_request_id", quote.id);
  if (error) throw new Error(`order refund update failed: ${error.message}`);
  return "refunded";
}

// Processes one verified, non-duplicate Stripe event. Returns a short result
// string stored in the event ledger. Throws only on infrastructure errors.
export async function processStripeEvent(deps, event) {
  if (!HANDLED_EVENT_TYPES.includes(event.type)) return "ignored:unhandled-type";

  const object = event.data?.object;
  if (!object || typeof object !== "object" || typeof object.id !== "string") {
    return "ignored:invalid-object";
  }

  switch (event.type) {
    case "checkout.session.completed": {
      if (object.payment_status && object.payment_status !== "paid") {
        return "ignored:session-not-paid";
      }
      const quote = await findQuoteForEvent(deps, object);
      if (!quote) return "ignored:no-matching-quote";
      return markQuotePaid(deps, quote, object);
    }
    case "invoice.paid": {
      const quote = await findQuoteForEvent(deps, object);
      if (!quote) return "ignored:no-matching-quote";
      return markQuotePaid(deps, quote, object);
    }
    case "checkout.session.expired": {
      await updatePaymentByObject(deps, "checkout_session", object.id, { status: "canceled" });
      return "session-expired";
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
      const { error } = await deps.service
        .from("payments")
        .update({ status: "failed", failure_message: "payment intent failed" })
        .eq("stripe_payment_intent_id", object.id);
      if (error) throw new Error(`payment update failed: ${error.message}`);
      return "payment-intent-failed";
    }
    case "charge.refunded": {
      const quote = await findQuoteForEvent(deps, object);
      if (!quote) return "ignored:no-matching-quote";
      return markQuoteRefunded(deps, quote, object);
    }
    default:
      return "ignored:unhandled-type";
  }
}

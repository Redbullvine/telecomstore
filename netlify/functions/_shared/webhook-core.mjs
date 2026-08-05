// ============================================================================
// webhook-core.mjs -- Stripe webhook HTTP handler with a DURABLE event ledger.
//
// Flow: verify signed raw body -> record event idempotently (unique
// stripe_event_id; a replay returns duplicate:true and touches nothing) ->
// run the order workflow -> mark the ledger entry processed/skipped/failed.
// A processing failure returns 500 so Stripe retries; the ledger row keeps
// the error. Logs contain identifiers and amounts only (see redactForLog).
// ============================================================================

import { createOrderWorkflow, redactForLog } from "./order-core.mjs";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export const REQUIRED_WEBHOOK_ENV = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
];

// Returns the names of missing/blank required variables. Never their values.
export function missingWebhookEnv(env) {
  return REQUIRED_WEBHOOK_ENV.filter((name) => !String(env?.[name] ?? "").trim());
}

// quoteProcessor (optional): async (event) => string. Returns "unclaimed" when
// the event does not belong to the quote-to-payment system; any other value
// means the quote system owns the event ("ignored:*" results record as
// skipped, everything else as processed). Direct-checkout order events fall
// through to the order workflow exactly as before.
//
// expectedLivemode (optional): when a boolean, an event whose livemode does
// not match is rejected — a test event can never mutate live payment state
// and vice versa.
export function createWebhookHandler({ constructEvent, store, pricing = [], log = console.info, quoteProcessor = null, expectedLivemode = null }) {
  if (!store) throw new Error("createWebhookHandler requires a durable store");
  const workflow = createOrderWorkflow({ store, pricing, log });
  return async (request) => {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const signature = request.headers.get("stripe-signature");
    if (!signature) return json({ error: "Missing signature" }, 400);
    const rawBody = await request.text();
    let event;
    try {
      event = constructEvent(rawBody, signature);
    } catch {
      return json({ error: "Invalid signature" }, 400);
    }

    if (typeof expectedLivemode === "boolean" && Boolean(event.livemode) !== expectedLivemode) {
      return json({ error: "Livemode mismatch" }, 400);
    }

    // Durable idempotency: a replayed event id records as duplicate and stops
    // — unless the previous attempt FAILED, in which case the Stripe retry
    // re-opens that exact ledger row and reprocesses.
    const record = await store.recordEvent({ stripe_event_id: event.id, event_type: event.type, payload: event });
    if (record.duplicate) {
      const reopened = store.reopenFailedEvent ? await store.reopenFailedEvent(event.id) : false;
      if (!reopened) return json({ received: true, duplicate: true });
    }

    try {
      if (quoteProcessor) {
        const quoteResult = await quoteProcessor(event);
        if (quoteResult !== "unclaimed") {
          const status = String(quoteResult).startsWith("ignored:") ? "skipped" : "processed";
          await store.markEvent(event.id, status, { error: status === "skipped" ? String(quoteResult) : null });
          return json({ received: true });
        }
      }
      const result = await workflow.process(event);
      await store.markEvent(event.id, result.handled ? "processed" : "skipped", { orderId: result.orderId ?? null });
      if (!result.handled) return json({ received: true, ignored: true });
      if (result.problems?.length) log({ ...redactForLog(event), problems: result.problems });
      return json({ received: true });
    } catch (error) {
      await store.markEvent(event.id, "failed", { error: error instanceof Error ? error.message : "unknown" });
      // 500 => Stripe retries with the same event id; reopenFailedEvent above
      // lets that retry reprocess this ledger row.
      return json({ error: "Processing failed" }, 500);
    }
  };
}

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

export function createWebhookHandler({ constructEvent, store, pricing = [], log = console.info }) {
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

    // Durable idempotency: a replayed event id records as duplicate and stops.
    const record = await store.recordEvent({ stripe_event_id: event.id, event_type: event.type, payload: event });
    if (record.duplicate) return json({ received: true, duplicate: true });

    try {
      const result = await workflow.process(event);
      await store.markEvent(event.id, result.handled ? "processed" : "skipped", { orderId: result.orderId ?? null });
      if (!result.handled) return json({ received: true, ignored: true });
      if (result.problems?.length) log({ ...redactForLog(event), problems: result.problems });
      return json({ received: true });
    } catch (error) {
      await store.markEvent(event.id, "failed", { error: error instanceof Error ? error.message : "unknown" });
      // 500 => Stripe retries with the same event id; the ledger dedupes state.
      return json({ error: "Processing failed" }, 500);
    }
  };
}

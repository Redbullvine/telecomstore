// POST /api/stripe-webhook — Stripe event intake.
//
// Order of defenses: method check -> config presence -> signature
// verification on the RAW body -> livemode/key-mode match -> unique event-id
// dedup -> type whitelist -> guarded state transitions. Responses to Stripe
// are always minimal; diagnostics stay in server logs and the event ledger.

import { getStripe } from "../lib/stripe-client.mjs";
import { getStripeConfig } from "../lib/env.mjs";
import { getServiceClient } from "../lib/supabase-admin.mjs";
import { recordEvent, markEvent, processStripeEvent } from "../lib/webhook-core.mjs";
import { json, logServerError } from "../lib/http.mjs";

export default async function handler(req) {
  if (req.method !== "POST") return json(405, { received: false });

  const stripe = getStripe();
  const { webhookSecret, webhookConfigured, mode } = getStripeConfig();
  const service = getServiceClient();
  if (!stripe || !webhookConfigured || !service) {
    logServerError("webhook", "webhook endpoint not configured", {});
    return json(503, { received: false });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return json(400, { received: false });

  const rawBody = await req.text();

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    logServerError("webhook", "signature verification failed", {});
    return json(400, { received: false });
  }

  // A test-mode key must only ever process test events, and live-live.
  const eventMode = event.livemode ? "live" : "test";
  if (mode !== eventMode) {
    logServerError("webhook", "livemode mismatch", { eventMode, keyMode: mode, eventId: event.id });
    return json(400, { received: false });
  }

  try {
    const { duplicate, eventRowId } = await recordEvent({ service }, event);
    if (duplicate) return json(200, { received: true, duplicate: true });

    try {
      const result = await processStripeEvent({ service }, event);
      await markEvent({ service }, eventRowId, result.startsWith("ignored:") ? "ignored" : "processed", result);
      return json(200, { received: true });
    } catch (processingError) {
      logServerError("webhook", processingError, { eventId: event.id, type: event.type });
      await markEvent({ service }, eventRowId, "failed", processingError.message);
      // 500 so Stripe retries. recordEvent() re-opens rows whose status is
      // "failed", so the retry reprocesses this exact ledger row.
      return json(500, { received: false });
    }
  } catch (infraError) {
    logServerError("webhook", infraError, { eventId: event.id });
    return json(500, { received: false });
  }
}

export const config = { path: "/api/stripe-webhook" };

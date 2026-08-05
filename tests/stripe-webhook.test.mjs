// Webhook security and processing tests — fully offline.
// Signature checks use the real Stripe SDK crypto (constructEvent /
// generateTestHeaderString); database effects use the in-memory fake client.

import assert from "node:assert/strict";
import test from "node:test";
import Stripe from "stripe";

import { recordEvent, processStripeEvent, HANDLED_EVENT_TYPES } from "../netlify/lib/webhook-core.mjs";
import { createFakeDb } from "./helpers/fake-supabase.mjs";

const stripe = new Stripe("sk_test_offline_dummy_key_for_signature_tests");
const WEBHOOK_SECRET = "whsec_test_secret_for_unit_tests";

function makeEvent(type, object, { id = "evt_test_1", livemode = false } = {}) {
  return {
    id,
    object: "event",
    type,
    livemode,
    api_version: "2026-07-29.dahlia",
    data: { object }
  };
}

const QUOTE_ID = "33333333-3333-4333-8333-333333333333";

function seededDb({ status = "payment_sent" } = {}) {
  return createFakeDb({
    quote_requests: [{
      id: QUOTE_ID,
      reference_code: "QR-TESTREF1",
      status,
      customer_email: "buyer@example.com",
      stripe_invoice_id: "in_test_1",
      stripe_checkout_session_id: null,
      stripe_payment_link_id: null,
      stripe_payment_intent_id: "pi_test_1"
    }],
    payments: [{
      id: "pay-1",
      quote_request_id: QUOTE_ID,
      stripe_object_type: "invoice",
      stripe_object_id: "in_test_1",
      stripe_payment_intent_id: "pi_test_1",
      status: "pending"
    }],
    orders: [{ id: "ord-1", quote_request_id: QUOTE_ID, status: "pending" }],
    stripe_events: [],
    quote_status_history: []
  });
}

// ---------------------------------------------------------------------------
// Signature verification (the HTTP handler's gate)
// ---------------------------------------------------------------------------

test("webhook: a correctly signed payload verifies", () => {
  const payload = JSON.stringify(makeEvent("invoice.paid", { object: "invoice", id: "in_test_1" }));
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const event = stripe.webhooks.constructEvent(payload, header, WEBHOOK_SECRET);
  assert.equal(event.type, "invoice.paid");
});

test("webhook: a tampered payload fails signature verification", () => {
  const payload = JSON.stringify(makeEvent("invoice.paid", { object: "invoice", id: "in_test_1" }));
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const tampered = payload.replace("in_test_1", "in_attacker");
  assert.throws(() => stripe.webhooks.constructEvent(tampered, header, WEBHOOK_SECRET));
});

test("webhook: a signature from the wrong secret is rejected", () => {
  const payload = JSON.stringify(makeEvent("invoice.paid", { object: "invoice", id: "in_test_1" }));
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_attacker_secret" });
  assert.throws(() => stripe.webhooks.constructEvent(payload, header, WEBHOOK_SECRET));
});

// ---------------------------------------------------------------------------
// Duplicate / replay protection
// ---------------------------------------------------------------------------

test("webhook: duplicate event ids are detected and not reprocessed", async () => {
  const db = seededDb();
  const event = makeEvent("invoice.paid", { object: "invoice", id: "in_test_1" });

  const first = await recordEvent({ service: db }, event);
  assert.equal(first.duplicate, false);
  const second = await recordEvent({ service: db }, event);
  assert.equal(second.duplicate, true);
  assert.equal(db.table("stripe_events").length, 1);
});

test("webhook: a failed event can be re-opened by a Stripe retry, processed/ignored cannot", async () => {
  const db = seededDb();
  const event = makeEvent("invoice.paid", { object: "invoice", id: "in_test_1" });

  const first = await recordEvent({ service: db }, event);
  db.table("stripe_events")[0].processing_status = "failed";
  const retry = await recordEvent({ service: db }, event);
  assert.equal(retry.duplicate, false, "failed events re-open for retry");
  assert.equal(retry.eventRowId, first.eventRowId);

  db.table("stripe_events")[0].processing_status = "processed";
  const replay = await recordEvent({ service: db }, event);
  assert.equal(replay.duplicate, true, "processed events never re-open");
});

// ---------------------------------------------------------------------------
// Event-type validation
// ---------------------------------------------------------------------------

test("webhook: unknown event types are ignored, not processed", async () => {
  const db = seededDb();
  const result = await processStripeEvent({ service: db }, makeEvent("customer.created", { object: "customer", id: "cus_x" }));
  assert.equal(result, "ignored:unhandled-type");
  assert.equal(db.table("quote_requests")[0].status, "payment_sent", "state untouched");
});

test("webhook: malformed event objects are ignored", async () => {
  const db = seededDb();
  const result = await processStripeEvent({ service: db }, makeEvent("invoice.paid", null));
  assert.equal(result, "ignored:invalid-object");
});

// ---------------------------------------------------------------------------
// State transitions from events
// ---------------------------------------------------------------------------

test("webhook: invoice.paid moves payment_sent -> paid and settles records", async () => {
  const db = seededDb();
  const result = await processStripeEvent({ service: db }, makeEvent("invoice.paid", {
    object: "invoice", id: "in_test_1", payment_intent: "pi_test_1", charge: "ch_test_1"
  }));
  assert.equal(result, "paid");
  assert.equal(db.table("quote_requests")[0].status, "paid");
  assert.equal(db.table("payments")[0].status, "succeeded");
  assert.equal(db.table("orders")[0].status, "paid");
  assert.equal(db.table("quote_status_history").length, 1);
  assert.equal(db.table("quote_status_history")[0].changed_by ?? null, null, "webhook transitions are system-attributed");
});

test("webhook: paid event against an unpaid-eligible status is blocked", async () => {
  const db = seededDb({ status: "new" });
  const result = await processStripeEvent({ service: db }, makeEvent("invoice.paid", {
    object: "invoice", id: "in_test_1"
  }));
  assert.equal(result, "blocked-transition");
  assert.equal(db.table("quote_requests")[0].status, "new");
});

test("webhook: second invoice.paid for an already-paid quote is a no-op", async () => {
  const db = seededDb({ status: "paid" });
  const result = await processStripeEvent({ service: db }, makeEvent("invoice.paid", {
    object: "invoice", id: "in_test_1"
  }));
  assert.equal(result, "already-paid");
  assert.equal(db.table("quote_status_history").length, 0);
});

test("webhook: checkout.session.completed with unpaid payment_status is ignored", async () => {
  const db = seededDb();
  const result = await processStripeEvent({ service: db }, makeEvent("checkout.session.completed", {
    object: "checkout.session", id: "cs_test_1", payment_status: "unpaid",
    metadata: { quote_request_id: QUOTE_ID }
  }));
  assert.equal(result, "ignored:session-not-paid");
});

test("webhook: checkout.session.completed resolves the quote via metadata", async () => {
  const db = seededDb();
  const result = await processStripeEvent({ service: db }, makeEvent("checkout.session.completed", {
    object: "checkout.session", id: "cs_test_2", payment_status: "paid",
    payment_intent: "pi_test_2", metadata: { quote_request_id: QUOTE_ID }
  }));
  assert.equal(result, "paid");
  assert.equal(db.table("quote_requests")[0].status, "paid");
});

test("webhook: events with no matching quote are ignored", async () => {
  const db = seededDb();
  const result = await processStripeEvent({ service: db }, makeEvent("invoice.paid", {
    object: "invoice", id: "in_unknown_999"
  }));
  assert.equal(result, "ignored:no-matching-quote");
});

test("webhook: invoice.payment_failed marks the payment failed but not the quote", async () => {
  const db = seededDb();
  const result = await processStripeEvent({ service: db }, makeEvent("invoice.payment_failed", {
    object: "invoice", id: "in_test_1"
  }));
  assert.equal(result, "invoice-payment-failed");
  assert.equal(db.table("payments")[0].status, "failed");
  assert.equal(db.table("quote_requests")[0].status, "payment_sent", "customer can retry");
});

test("webhook: charge.refunded moves a paid quote to refunded", async () => {
  const db = seededDb({ status: "paid" });
  const result = await processStripeEvent({ service: db }, makeEvent("charge.refunded", {
    object: "charge", id: "ch_test_1", payment_intent: "pi_test_1", refunded: true, amount_refunded: 12990
  }));
  assert.equal(result, "refunded");
  assert.equal(db.table("quote_requests")[0].status, "refunded");
  assert.equal(db.table("payments")[0].status, "refunded");
  assert.equal(db.table("orders")[0].status, "refunded");
});

test("webhook: every handled event type is in the declared whitelist", () => {
  assert.deepEqual([...HANDLED_EVENT_TYPES].sort(), [
    "charge.refunded",
    "checkout.session.completed",
    "checkout.session.expired",
    "invoice.marked_uncollectible",
    "invoice.paid",
    "invoice.payment_failed",
    "invoice.voided",
    "payment_intent.payment_failed"
  ]);
});

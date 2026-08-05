// Quote-side webhook tests + unified-handler integration — fully offline.
// Signature checks use the real Stripe SDK crypto; quote database effects use
// the in-memory fake Supabase client; the direct-checkout side uses the
// memory order store from order-core.

import assert from "node:assert/strict";
import test from "node:test";
import Stripe from "stripe";

import { processQuoteEvent, QUOTE_EVENT_TYPES, UNCLAIMED } from "../netlify/lib/webhook-core.mjs";
import { createWebhookHandler } from "../netlify/functions/_shared/webhook-core.mjs";
import { createMemoryOrderStore } from "../netlify/functions/_shared/order-core.mjs";
import { createFakeDb } from "./helpers/fake-supabase.mjs";

const stripe = new Stripe("sk_test_offline_dummy_key_for_signature_tests");
const WEBHOOK_SECRET = "whsec_test_secret_for_unit_tests";

function makeEvent(type, object, { id = "evt_test_1", livemode = false } = {}) {
  return { id, object: "event", type, livemode, api_version: "2026-07-29.dahlia", data: { object } };
}

const QUOTE_ID = "33333333-3333-4333-8333-333333333333";

const QUOTE_TOTAL_CENTS = 12990;

function seededDb({ status = "payment_sent" } = {}) {
  return createFakeDb({
    quote_requests: [{
      id: QUOTE_ID,
      reference_code: "QR-TESTREF1",
      status,
      customer_email: "buyer@example.com",
      final_total: "129.90",
      currency_code: "USD",
      stripe_invoice_id: "in_test_1",
      stripe_checkout_session_id: null,
      stripe_payment_link_id: "plink_test_1",
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
    quote_status_history: []
  });
}

// ---------------------------------------------------------------------------
// Claim rules: quote events vs direct-checkout events
// ---------------------------------------------------------------------------

test("quote-webhook: non-payment event types are unclaimed", async () => {
  const db = seededDb();
  assert.equal(await processQuoteEvent({ service: db }, makeEvent("customer.created", { object: "customer", id: "cus_x" })), UNCLAIMED);
  assert.equal(await processQuoteEvent({ service: db }, makeEvent("invoice.paid", null)), UNCLAIMED);
});

test("quote-webhook: a direct-checkout session (no quote match) is unclaimed", async () => {
  const db = seededDb();
  const result = await processQuoteEvent({ service: db }, makeEvent("checkout.session.completed", {
    object: "checkout.session", id: "cs_direct_1", payment_status: "paid", metadata: {}
  }));
  assert.equal(result, UNCLAIMED);
  assert.equal(db.table("quote_requests")[0].status, "payment_sent", "quote state untouched");
});

test("quote-webhook: a direct-checkout refund (no quote match) is unclaimed", async () => {
  const db = seededDb();
  const result = await processQuoteEvent({ service: db }, makeEvent("charge.refunded", {
    object: "charge", id: "ch_direct", payment_intent: "pi_direct_checkout", refunded: true
  }));
  assert.equal(result, UNCLAIMED);
});

test("quote-webhook: payment_intent.payment_failed without a quote payment is unclaimed", async () => {
  const db = seededDb();
  const result = await processQuoteEvent({ service: db }, makeEvent("payment_intent.payment_failed", {
    object: "payment_intent", id: "pi_direct_checkout"
  }));
  assert.equal(result, UNCLAIMED);
});

test("quote-webhook: invoices are always quote-owned, matched or not", async () => {
  const db = seededDb();
  const result = await processQuoteEvent({ service: db }, makeEvent("invoice.paid", {
    object: "invoice", id: "in_unknown_999"
  }));
  assert.equal(result, "ignored:no-matching-quote");
});

// ---------------------------------------------------------------------------
// Quote state transitions from events
// ---------------------------------------------------------------------------

test("quote-webhook: invoice.paid moves payment_sent -> paid and settles records", async () => {
  const db = seededDb();
  const result = await processQuoteEvent({ service: db }, makeEvent("invoice.paid", {
    object: "invoice", id: "in_test_1", payment_intent: "pi_test_1", charge: "ch_test_1", amount_paid: QUOTE_TOTAL_CENTS, currency: "usd"
  }));
  assert.equal(result, "paid");
  assert.equal(db.table("quote_requests")[0].status, "paid");
  assert.equal(db.table("payments")[0].status, "succeeded");
  assert.equal(db.table("quote_status_history").length, 1);
  assert.equal(db.table("quote_status_history")[0].changed_by ?? null, null, "webhook transitions are system-attributed");
});

test("quote-webhook: paid event against an ineligible status is blocked", async () => {
  const db = seededDb({ status: "new" });
  const result = await processQuoteEvent({ service: db }, makeEvent("invoice.paid", {
    object: "invoice", id: "in_test_1"
  }));
  assert.equal(result, "blocked-transition");
  assert.equal(db.table("quote_requests")[0].status, "new");
});

test("quote-webhook: second invoice.paid for an already-paid quote is a no-op", async () => {
  const db = seededDb({ status: "paid" });
  const result = await processQuoteEvent({ service: db }, makeEvent("invoice.paid", {
    object: "invoice", id: "in_test_1"
  }));
  assert.equal(result, "already-paid");
  assert.equal(db.table("quote_status_history").length, 0);
});

test("quote-webhook: session with quote metadata but unpaid status is claimed and skipped", async () => {
  const db = seededDb();
  const result = await processQuoteEvent({ service: db }, makeEvent("checkout.session.completed", {
    object: "checkout.session", id: "cs_test_1", payment_status: "unpaid",
    metadata: { quote_request_id: QUOTE_ID }
  }));
  assert.equal(result, "ignored:session-not-paid");
});

test("quote-webhook: a payment-link session pays the quote via metadata", async () => {
  const db = seededDb();
  const result = await processQuoteEvent({ service: db }, makeEvent("checkout.session.completed", {
    object: "checkout.session", id: "cs_link_1", payment_status: "paid", amount_total: QUOTE_TOTAL_CENTS, currency: "usd",
    payment_link: "plink_test_1", payment_intent: "pi_test_2", metadata: { quote_request_id: QUOTE_ID }
  }));
  assert.equal(result, "paid");
  assert.equal(db.table("quote_requests")[0].status, "paid");
  assert.equal(db.table("payments").length, 1);
});

test("quote-webhook: invoice.payment_failed marks the payment failed but not the quote", async () => {
  const db = seededDb();
  const result = await processQuoteEvent({ service: db }, makeEvent("invoice.payment_failed", {
    object: "invoice", id: "in_test_1"
  }));
  assert.equal(result, "invoice-payment-failed");
  assert.equal(db.table("payments")[0].status, "failed");
  assert.equal(db.table("quote_requests")[0].status, "payment_sent", "customer can retry");
});

test("quote-webhook: charge.refunded moves a paid quote to refunded", async () => {
  const db = seededDb({ status: "paid" });
  const result = await processQuoteEvent({ service: db }, makeEvent("charge.refunded", {
    object: "charge", id: "ch_test_1", payment_intent: "pi_test_1", refunded: true, amount_refunded: 12990
  }));
  assert.equal(result, "refunded");
  assert.equal(db.table("quote_requests")[0].status, "refunded");
  assert.equal(db.table("payments")[0].status, "refunded");
});

test("quote-webhook: declared quote event types match the implementation", () => {
  assert.deepEqual([...QUOTE_EVENT_TYPES].sort(), [
    "charge.refunded",
    "checkout.session.async_payment_failed",
    "checkout.session.async_payment_succeeded",
    "checkout.session.completed",
    "checkout.session.expired",
    "invoice.marked_uncollectible",
    "invoice.paid",
    "invoice.payment_failed",
    "invoice.voided",
    "payment_intent.payment_failed"
  ]);
});

// ---------------------------------------------------------------------------
// Amount / currency verification (webhook is authoritative)
// ---------------------------------------------------------------------------

test("quote-webhook: a paid event with the wrong amount never marks the quote paid", async () => {
  const db = seededDb();
  const result = await processQuoteEvent({ service: db }, makeEvent("invoice.paid", {
    object: "invoice", id: "in_test_1", amount_paid: QUOTE_TOTAL_CENTS - 1, currency: "usd"
  }));
  assert.equal(result, "ignored:amount-mismatch");
  assert.equal(db.table("quote_requests")[0].status, "payment_sent");
});

test("quote-webhook: a paid event with the wrong currency never marks the quote paid", async () => {
  const db = seededDb();
  const result = await processQuoteEvent({ service: db }, makeEvent("invoice.paid", {
    object: "invoice", id: "in_test_1", amount_paid: QUOTE_TOTAL_CENTS, currency: "eur"
  }));
  assert.equal(result, "ignored:amount-mismatch");
  assert.equal(db.table("quote_requests")[0].status, "payment_sent");
});

test("quote-webhook: a session paid event for a quote without confirmed totals is refused", async () => {
  const db = seededDb();
  db.table("quote_requests")[0].final_total = null;
  const result = await processQuoteEvent({ service: db }, makeEvent("checkout.session.completed", {
    object: "checkout.session", id: "cs_x", payment_status: "paid", amount_total: 5000, currency: "usd",
    metadata: { quote_request_id: QUOTE_ID }
  }));
  assert.equal(result, "ignored:amount-mismatch");
});

// ---------------------------------------------------------------------------
// Delayed (async) payment methods
// ---------------------------------------------------------------------------

test("quote-webhook: async_payment_succeeded pays the quote after the money clears", async () => {
  const db = seededDb();
  db.table("quote_requests")[0].stripe_checkout_session_id = "cs_async_1";
  db.table("payments")[0].stripe_object_type = "checkout_session";
  db.table("payments")[0].stripe_object_id = "cs_async_1";
  const result = await processQuoteEvent({ service: db }, makeEvent("checkout.session.async_payment_succeeded", {
    object: "checkout.session", id: "cs_async_1", payment_status: "paid",
    amount_total: QUOTE_TOTAL_CENTS, currency: "usd", metadata: { quote_request_id: QUOTE_ID }
  }));
  assert.equal(result, "paid");
  assert.equal(db.table("quote_requests")[0].status, "paid");
  assert.equal(db.table("payments")[0].status, "succeeded");
});

test("quote-webhook: async_payment_failed marks the payment failed but leaves the quote recoverable", async () => {
  const db = seededDb();
  db.table("quote_requests")[0].stripe_checkout_session_id = "cs_async_1";
  db.table("payments")[0].stripe_object_type = "checkout_session";
  db.table("payments")[0].stripe_object_id = "cs_async_1";
  const result = await processQuoteEvent({ service: db }, makeEvent("checkout.session.async_payment_failed", {
    object: "checkout.session", id: "cs_async_1", payment_status: "unpaid",
    metadata: { quote_request_id: QUOTE_ID }
  }));
  assert.equal(result, "session-async-payment-failed");
  assert.equal(db.table("payments")[0].status, "failed");
  assert.equal(db.table("quote_requests")[0].status, "payment_sent");
});

// ---------------------------------------------------------------------------
// Unified handler integration: signature -> ledger -> quote/order dispatch
// ---------------------------------------------------------------------------

function unifiedHandler(db, store, { expectedLivemode = false } = {}) {
  return createWebhookHandler({
    store,
    pricing: [],
    log: () => {},
    constructEvent: (body, signature) => stripe.webhooks.constructEvent(body, signature, WEBHOOK_SECRET),
    quoteProcessor: (event) => processQuoteEvent({ service: db }, event),
    expectedLivemode
  });
}

function signedRequest(event) {
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  return new Request("https://example.test/api/stripe-webhook", {
    method: "POST",
    headers: { "stripe-signature": signature },
    body: payload
  });
}

test("unified: a signed quote invoice event is processed and ledgered once", async () => {
  const db = seededDb();
  const store = createMemoryOrderStore();
  const handler = unifiedHandler(db, store);

  const event = makeEvent("invoice.paid", { object: "invoice", id: "in_test_1", payment_intent: "pi_test_1", amount_paid: QUOTE_TOTAL_CENTS, currency: "usd" });
  const first = await handler(signedRequest(event));
  assert.equal(first.status, 200);
  assert.equal(db.table("quote_requests")[0].status, "paid");
  assert.equal(store.events.get("evt_test_1").processing_status, "processed");

  const replay = await handler(signedRequest(event));
  assert.equal((await replay.json()).duplicate, true, "replay is deduped by the shared ledger");
});

test("unified: a tampered payload is rejected before any state change", async () => {
  const db = seededDb();
  const store = createMemoryOrderStore();
  const handler = unifiedHandler(db, store);
  const event = makeEvent("invoice.paid", { object: "invoice", id: "in_test_1" });
  const payload = JSON.stringify(event).replace("in_test_1", "in_attacker");
  const signature = stripe.webhooks.generateTestHeaderString({ payload: JSON.stringify(event), secret: WEBHOOK_SECRET });
  const response = await handler(new Request("https://example.test/api/stripe-webhook", {
    method: "POST", headers: { "stripe-signature": signature }, body: payload
  }));
  assert.equal(response.status, 400);
  assert.equal(store.events.size, 0);
  assert.equal(db.table("quote_requests")[0].status, "payment_sent");
});

test("unified: livemode mismatch is rejected", async () => {
  const db = seededDb();
  const store = createMemoryOrderStore();
  const handler = unifiedHandler(db, store, { expectedLivemode: false });
  const response = await handler(signedRequest(makeEvent("invoice.paid", { object: "invoice", id: "in_test_1" }, { livemode: true })));
  assert.equal(response.status, 400);
  assert.equal(store.events.size, 0);
});

test("unified: a direct-checkout session falls through to the order workflow", async () => {
  const db = seededDb();
  const store = createMemoryOrderStore();
  const handler = unifiedHandler(db, store);
  const response = await handler(signedRequest(makeEvent("checkout.session.completed", {
    object: "checkout.session", id: "cs_direct_9", payment_status: "paid",
    amount_subtotal: 1000, amount_total: 1000, currency: "usd", metadata: {}
  })));
  assert.equal(response.status, 200);
  assert.equal(store.orders.size, 1, "order workflow recorded the direct-checkout order");
  assert.equal(db.table("quote_requests")[0].status, "payment_sent", "quote side untouched");
});

test("unified: a failed event re-opens for the Stripe retry; processed does not", async () => {
  const db = seededDb();
  const store = createMemoryOrderStore();
  // First delivery fails mid-processing: sabotage the quote lookup once.
  let sabotaged = false;
  const failingDb = {
    from(name) {
      if (!sabotaged && name === "quote_requests") {
        sabotaged = true;
        throw new Error("transient db outage");
      }
      return db.from(name);
    },
    table: (name) => db.table(name)
  };
  const handler = createWebhookHandler({
    store,
    pricing: [],
    log: () => {},
    constructEvent: (body, signature) => stripe.webhooks.constructEvent(body, signature, WEBHOOK_SECRET),
    quoteProcessor: (event) => processQuoteEvent({ service: failingDb }, event),
    expectedLivemode: false
  });

  const event = makeEvent("invoice.paid", { object: "invoice", id: "in_test_1", payment_intent: "pi_test_1", amount_paid: QUOTE_TOTAL_CENTS, currency: "usd" });
  const first = await handler(signedRequest(event));
  assert.equal(first.status, 500, "processing failure asks Stripe to retry");
  assert.equal(store.events.get("evt_test_1").processing_status, "failed");

  const retry = await handler(signedRequest(event));
  assert.equal(retry.status, 200);
  assert.equal(store.events.get("evt_test_1").processing_status, "processed");
  assert.equal(db.table("quote_requests")[0].status, "paid");

  const replay = await handler(signedRequest(event));
  assert.equal((await replay.json()).duplicate, true, "processed events never re-open");
});

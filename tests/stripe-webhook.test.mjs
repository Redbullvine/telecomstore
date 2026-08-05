import test from "node:test";
import assert from "node:assert/strict";
import { createWebhookHandler, missingWebhookEnv, REQUIRED_WEBHOOK_ENV } from "../netlify/functions/_shared/webhook-core.mjs";
import { createMemoryOrderStore } from "../netlify/functions/_shared/order-core.mjs";

const PRICING = [{ public_sku: "PUBLIC-1", title: "Public One", public_price: 10, checkout_active: true, price_mode: "fixed" }];
const event = {
  id: "evt_1",
  type: "checkout.session.completed",
  data: { object: { id: "cs_1", payment_status: "paid", amount_total: 1000, amount_subtotal: 1000, currency: "usd", metadata: { public_skus: "PUBLIC-1:1" } } },
};
const req = (sig = "valid") => new Request("http://local/webhook", { method: "POST", headers: sig ? { "stripe-signature": sig } : {}, body: "raw-body" });

test("verifies the raw signed payload and records the event durably", async () => {
  const store = createMemoryOrderStore();
  let receivedBody;
  const handler = createWebhookHandler({
    store, pricing: PRICING, log: () => {},
    constructEvent: (body, signature) => { receivedBody = body; assert.equal(signature, "valid"); return event; },
  });
  assert.equal((await handler(req())).status, 200);
  assert.equal(receivedBody, "raw-body");
  assert.equal(store.events.get("evt_1").processing_status, "processed");
  assert.equal(store.orders.size, 1);
});

test("a duplicate event id is acknowledged without reprocessing", async () => {
  const store = createMemoryOrderStore();
  const handler = createWebhookHandler({ store, pricing: PRICING, log: () => {}, constructEvent: () => event });
  await handler(req());
  assert.deepEqual(await (await handler(req())).json(), { received: true, duplicate: true });
  assert.equal(store.orders.size, 1, "replay must not duplicate the order");
});

test("rejects missing and invalid signatures and safely records unrelated events", async () => {
  const store = createMemoryOrderStore();
  const invalid = createWebhookHandler({ store, constructEvent: () => { throw new Error("bad"); } });
  assert.equal((await invalid(req())).status, 400);
  assert.equal((await invalid(req(""))).status, 400);
  const ignored = createWebhookHandler({ store, log: () => {}, constructEvent: () => ({ ...event, id: "evt_other", type: "customer.created" }) });
  assert.deepEqual(await (await ignored(req())).json(), { received: true, ignored: true });
  assert.equal(store.events.get("evt_other").processing_status, "skipped");
});

test("missing required configuration is reported by name only", () => {
  assert.deepEqual(missingWebhookEnv({}), REQUIRED_WEBHOOK_ENV);
  assert.deepEqual(missingWebhookEnv({ STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: " ", SUPABASE_URL: "http://127.0.0.1:55321", SUPABASE_SERVICE_ROLE_KEY: "k" }), ["STRIPE_WEBHOOK_SECRET"]);
});

import test from "node:test";
import assert from "node:assert/strict";
import { createWebhookHandler } from "../netlify/functions/_shared/webhook-core.mjs";

const event = { id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_1", payment_status: "paid", amount_total: 1000, currency: "usd", metadata: { public_skus: "PUBLIC-1:1" } } } };
const req = (sig = "valid") => new Request("http://local/webhook", { method: "POST", headers: sig ? { "stripe-signature": sig } : {}, body: "raw-body" });
test("verifies the raw signed payload, logs a sanitized event, and deduplicates best effort", async () => {
  const logs = []; const store = new Set(); let receivedBody;
  const handler = createWebhookHandler({ processedEvents: store, log: (...args) => logs.push(args), constructEvent: (body, signature) => { receivedBody = body; assert.equal(signature, "valid"); return event; } });
  assert.equal((await handler(req())).status, 200); assert.equal(receivedBody, "raw-body"); assert.equal(logs.length, 1);
  assert.deepEqual(await (await handler(req())).json(), { received: true, duplicate: true });
});
test("rejects missing and invalid signatures and safely ignores unrelated events", async () => {
  const invalid = createWebhookHandler({ constructEvent: () => { throw new Error("bad"); } });
  assert.equal((await invalid(req())).status, 400); assert.equal((await invalid(req(""))).status, 400);
  const ignored = createWebhookHandler({ constructEvent: () => ({ ...event, type: "customer.created" }) });
  assert.equal((await ignored(req())).status, 200);
});

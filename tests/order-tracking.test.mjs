import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  sessionToOrder,
  itemsFromSession,
  redactForLog,
  createOrderWorkflow,
  createMemoryOrderStore,
} from "../netlify/functions/_shared/order-core.mjs";
import { createWebhookHandler } from "../netlify/functions/_shared/webhook-core.mjs";
import { createSupabaseOrderStore } from "../netlify/functions/_shared/supabase-order-store.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRICING = [
  { public_sku: "SKU-A", title: "Cat6 Patch Cable", public_price: 12.99, checkout_active: true, price_mode: "fixed" },
  { public_sku: "SKU-B", title: "Coax Splitter", public_price: 5.49, checkout_active: true, price_mode: "fixed" },
];

const SESSION = {
  id: "cs_100",
  payment_intent: "pi_100",
  customer: "cus_100",
  payment_status: "paid",
  currency: "usd",
  amount_subtotal: 3147,
  amount_total: 4046,
  total_details: { amount_tax: 254, amount_shipping: 645 },
  customer_details: { email: "buyer@example.test", name: "Test Buyer", phone: "+15550000000" },
  shipping_details: { name: "Test Buyer", address: { line1: "1 Main St", city: "Fargo", state: "ND", postal_code: "58102", country: "US" } },
  metadata: { public_skus: "SKU-A:2,SKU-B:1" },
};
const completed = { id: "evt_100", type: "checkout.session.completed", data: { object: SESSION } };
const makeWorkflow = () => {
  const store = createMemoryOrderStore();
  return { store, workflow: createOrderWorkflow({ store, pricing: PRICING, log: () => {} }) };
};

// ---------------------------------------------------------------------------
// Order creation and totals
// ---------------------------------------------------------------------------
test("checkout.session.completed creates a full order with shipping and tax totals", async () => {
  const { store, workflow } = makeWorkflow();
  const result = await workflow.process(completed);
  assert.equal(result.handled, true);
  const order = store.orders.get("cs_100");
  assert.equal(order.payment_status, "paid");
  assert.equal(order.stripe_payment_intent_id, "pi_100");
  assert.equal(order.stripe_customer_id, "cus_100");
  assert.equal(order.amount_subtotal_cents, 3147);
  assert.equal(order.amount_tax_cents, 254);
  assert.equal(order.amount_shipping_cents, 645);
  assert.equal(order.amount_total_cents, 4046);
  assert.equal(order.currency_code, "USD");
  assert.equal(order.fulfillment_status, "unfulfilled");
  assert.equal(order.shipping_address.city, "Fargo");
  assert.equal(order.last_stripe_event_id, "evt_100");
});

test("order-item totals are quantity times the server-side approved price", async () => {
  const { store, workflow } = makeWorkflow();
  await workflow.process(completed);
  const items = store.orders.get("cs_100").items;
  assert.equal(items.length, 2);
  const a = items.find((i) => i.public_sku === "SKU-A");
  assert.equal(a.unit_amount_cents, 1299);
  assert.equal(a.quantity, 2);
  assert.equal(a.amount_total_cents, 2598);
  const b = items.find((i) => i.public_sku === "SKU-B");
  assert.equal(b.amount_total_cents, 549);
});

test("pricing is server-authoritative: unknown or unpriced SKUs are flagged, never priced", () => {
  const bySku = new Map(PRICING.map((r) => [r.public_sku, r]));
  const tampered = { metadata: { public_skus: "SKU-A:1,HACKED-SKU:5,SKU-B:0,free:one" } };
  const { items, problems } = itemsFromSession(tampered, bySku);
  assert.equal(items.length, 1);
  assert.equal(items[0].public_sku, "SKU-A");
  assert.ok(problems.includes("no_server_price:HACKED-SKU"));
  assert.ok(problems.some((p) => p.startsWith("malformed_line:SKU-B:0")));
  assert.ok(problems.some((p) => p.startsWith("malformed_line:free:one")));
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------
test("a duplicate webhook event never creates a second order", async () => {
  const store = createMemoryOrderStore();
  const handler = createWebhookHandler({ store, pricing: PRICING, log: () => {}, constructEvent: () => completed });
  const req = () => new Request("http://local/webhook", { method: "POST", headers: { "stripe-signature": "v" }, body: "{}" });
  await handler(req());
  const second = await (await handler(req())).json();
  assert.equal(second.duplicate, true);
  assert.equal(store.orders.size, 1);
  assert.equal(store.events.size, 1);
});

test("a session replayed via a different event id upserts the same order", async () => {
  const { store, workflow } = makeWorkflow();
  await workflow.process(completed);
  await workflow.process({ ...completed, id: "evt_101" });
  assert.equal(store.orders.size, 1, "same session must remain one order");
});

// ---------------------------------------------------------------------------
// Payment lifecycle
// ---------------------------------------------------------------------------
test("async payment success and failure update the recorded order", async () => {
  const { store, workflow } = makeWorkflow();
  await workflow.process({ ...completed, data: { object: { ...SESSION, payment_status: "unpaid" } } });
  assert.equal(store.orders.get("cs_100").payment_status, "pending");
  await workflow.process({ id: "evt_102", type: "checkout.session.async_payment_succeeded", data: { object: { id: "cs_100" } } });
  assert.equal(store.orders.get("cs_100").payment_status, "paid");
  await workflow.process({ id: "evt_103", type: "checkout.session.async_payment_failed", data: { object: { id: "cs_100" } } });
  assert.equal(store.orders.get("cs_100").payment_status, "failed");
});

test("a declined payment intent marks the order failed", async () => {
  const { store, workflow } = makeWorkflow();
  await workflow.process(completed);
  const result = await workflow.process({ id: "evt_104", type: "payment_intent.payment_failed", data: { object: { id: "pi_100" } } });
  assert.equal(result.handled, true);
  assert.equal(store.orders.get("cs_100").payment_status, "failed");
});

test("full and partial refunds map to distinct statuses", async () => {
  const { store, workflow } = makeWorkflow();
  await workflow.process(completed);
  await workflow.process({ id: "evt_105", type: "charge.refunded", data: { object: { payment_intent: "pi_100", amount: 4046, amount_captured: 4046, amount_refunded: 1000 } } });
  assert.equal(store.orders.get("cs_100").payment_status, "partially_refunded");
  await workflow.process({ id: "evt_106", type: "charge.refunded", data: { object: { payment_intent: "pi_100", amount: 4046, amount_captured: 4046, amount_refunded: 4046 } } });
  assert.equal(store.orders.get("cs_100").payment_status, "refunded");
});

test("a processing failure returns 500 and marks the ledger row failed", async () => {
  const store = createMemoryOrderStore();
  store.upsertOrder = async () => { throw new Error("db unavailable"); };
  const handler = createWebhookHandler({ store, pricing: PRICING, log: () => {}, constructEvent: () => completed });
  const res = await handler(new Request("http://local/webhook", { method: "POST", headers: { "stripe-signature": "v" }, body: "{}" }));
  assert.equal(res.status, 500);
  assert.equal(store.events.get("evt_100").processing_status, "failed");
  assert.match(store.events.get("evt_100").processing_error, /db unavailable/);
});

// ---------------------------------------------------------------------------
// Logging redaction
// ---------------------------------------------------------------------------
test("logs contain identifiers and amounts only, never customer PII", async () => {
  const logs = [];
  const store = createMemoryOrderStore();
  const workflow = createOrderWorkflow({ store, pricing: PRICING, log: (entry) => logs.push(entry) });
  await workflow.process(completed);
  const blob = JSON.stringify(logs);
  assert.doesNotMatch(blob, /buyer@example\.test|Test Buyer|\+1555|Main St|Fargo|58102/);
  assert.match(blob, /cs_100/);
  const entry = redactForLog(completed, sessionToOrder(SESSION));
  assert.equal(entry.amount_total_cents, 4046);
  assert.ok(!("customer_email" in entry) && !("shipping_address" in entry));
});

// ---------------------------------------------------------------------------
// Security boundaries (static)
// ---------------------------------------------------------------------------
// Strip SQL comments so prose can never satisfy or trip the statement scans.
const migration = fs
  .readFileSync(path.join(root, "supabase", "migrations", "20260803120000_stripe_order_tracking.sql"), "utf8")
  .replace(/--[^\r\n]*/g, "");

test("order tables enable RLS, give anon nothing, and never grant DELETE", () => {
  for (const table of ["stripe_events", "orders", "order_items"]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`revoke all privileges on table public\\.${table} from anon, authenticated`));
  }
  assert.doesNotMatch(migration, /grant[^;]*to anon/i, "no anon grant may exist");
  assert.doesNotMatch(migration, /grant[^;]*\bdelete\b[^;]*on table/i, "no DELETE grant may exist");
  assert.doesNotMatch(migration, /create policy[^;]*for (insert|update|delete)/i, "no client-role write policy may exist");
});

test("browser bundle code never writes order tables", () => {
  const srcDir = path.join(root, "src");
  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(m?js|jsx|ts|tsx)$/.test(entry.name)) files.push(p);
    }
  })(srcDir);
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(text, /from\(["'](orders|order_items|stripe_events)["']\)/, `client-side order-table access in ${file}`);
  }
});

test("no production connection can occur during tests", () => {
  // The Supabase store requires an injected client and creates nothing itself.
  assert.throws(() => createSupabaseOrderStore(), /requires a supabase client/);
  const storeSource = fs.readFileSync(path.join(root, "netlify", "functions", "_shared", "supabase-order-store.mjs"), "utf8");
  assert.doesNotMatch(storeSource, /createClient|process\.env|Netlify\.env|supabase\.co/);
  const coreSource = fs.readFileSync(path.join(root, "netlify", "functions", "_shared", "order-core.mjs"), "utf8");
  assert.doesNotMatch(coreSource, /createClient|process\.env|fetch\s*\(|https?:\/\//);
});

test("checkout stays refused for products without an approved price and shipping", async () => {
  const { createCheckoutHandler } = await import("../netlify/functions/_shared/checkout-core.mjs");
  const pricing = JSON.parse(fs.readFileSync(path.join(root, "netlify", "functions", "_shared", "opening-pricing.json"), "utf8"));
  // Every currently bundled row must be quote-only until Danny approves prices.
  assert.ok(pricing.every((row) => row.checkout_active === false));
  const handler = createCheckoutHandler({ pricing, createSession: async () => { throw new Error("must not be called"); }, siteUrl: "https://example.test" });
  const res = await handler(new Request("http://local/checkout", { method: "POST", body: JSON.stringify({ items: [{ sku: pricing[0].public_sku, quantity: 1 }] }) }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /quote/i);
});

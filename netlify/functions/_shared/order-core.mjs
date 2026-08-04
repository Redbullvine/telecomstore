// ============================================================================
// order-core.mjs -- pure order workflow shared by the webhook handler.
//
// No I/O and no SDK imports: the durable store is injected, so tests run the
// complete workflow against an in-memory store and production wires the
// Supabase service-role store. Prices always come from the server-side
// approved pricing bundle; the browser (and even Stripe metadata) can never
// set a unit price.
// ============================================================================

// Map a Stripe checkout session object to an order row (integer cents).
export function sessionToOrder(session, { eventId = null } = {}) {
  const details = session.customer_details || {};
  const shipping = session.shipping_details || session.collected_information?.shipping_details || null;
  return {
    stripe_checkout_session_id: session.id,
    stripe_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null,
    stripe_customer_id: typeof session.customer === "string" ? session.customer : session.customer?.id || null,
    payment_status: session.payment_status === "paid" ? "paid" : "pending",
    currency_code: String(session.currency || "usd").toUpperCase(),
    amount_subtotal_cents: session.amount_subtotal ?? null,
    amount_tax_cents: session.total_details?.amount_tax ?? null,
    amount_shipping_cents: session.total_details?.amount_shipping ?? session.shipping_cost?.amount_total ?? null,
    amount_total_cents: session.amount_total ?? null,
    customer_email: details.email || null,
    customer_name: details.name || null,
    customer_phone: details.phone || null,
    shipping_address: shipping?.address ? { name: shipping.name || null, ...shipping.address } : null,
    last_stripe_event_id: eventId,
  };
}

// Parse the "SKU:QTY,SKU:QTY" metadata written by the checkout function and
// price every line from the server-side bundle. Unknown SKUs or rows without
// an active server price are reported, never silently priced.
export function itemsFromSession(session, pricingBySku) {
  const items = [];
  const problems = [];
  const raw = String(session.metadata?.public_skus || "");
  for (const part of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [sku, qtyRaw] = part.split(":");
    const quantity = Number(qtyRaw);
    if (!sku || !Number.isInteger(quantity) || quantity < 1) { problems.push(`malformed_line:${part}`); continue; }
    const row = pricingBySku.get(sku);
    if (!row || !(Number(row.public_price) > 0)) { problems.push(`no_server_price:${sku}`); continue; }
    const unit = Math.round(Number(row.public_price) * 100);
    items.push({ public_sku: sku, title: row.title || null, quantity, unit_amount_cents: unit, amount_total_cents: unit * quantity });
  }
  return { items, problems };
}

// Whitelist-only logging: identifiers and amounts, never customer PII,
// addresses, or raw payloads.
export function redactForLog(event, order = {}) {
  return {
    event_id: event.id,
    event_type: event.type,
    session_id: order.stripe_checkout_session_id || event.data?.object?.id || null,
    payment_intent: order.stripe_payment_intent_id || null,
    payment_status: order.payment_status || null,
    amount_total_cents: order.amount_total_cents ?? null,
    currency: order.currency_code || null,
  };
}

export const HANDLED_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "payment_intent.payment_failed",
  "charge.refunded",
]);

// Process one verified event against the durable store. Returns
// { handled, orderId?, problems? }.
export function createOrderWorkflow({ store, pricing = [], log = () => {} }) {
  const pricingBySku = new Map(pricing.map((row) => [row.public_sku, row]));
  return {
    async process(event) {
      const object = event.data?.object || {};
      switch (event.type) {
        case "checkout.session.completed": {
          const order = sessionToOrder(object, { eventId: event.id });
          const { items, problems } = itemsFromSession(object, pricingBySku);
          const { orderId } = await store.upsertOrder(order, items);
          log(redactForLog(event, order));
          return { handled: true, orderId, problems };
        }
        case "checkout.session.async_payment_succeeded": {
          const orderId = await store.setPaymentStatusBySession(object.id, "paid", event.id);
          log(redactForLog(event, { stripe_checkout_session_id: object.id, payment_status: "paid" }));
          return { handled: true, orderId };
        }
        case "checkout.session.async_payment_failed": {
          const orderId = await store.setPaymentStatusBySession(object.id, "failed", event.id);
          log(redactForLog(event, { stripe_checkout_session_id: object.id, payment_status: "failed" }));
          return { handled: true, orderId };
        }
        case "payment_intent.payment_failed": {
          const orderId = await store.setPaymentStatusByPaymentIntent(object.id, "failed", event.id);
          log(redactForLog(event, { stripe_payment_intent_id: object.id, payment_status: "failed" }));
          return { handled: true, orderId };
        }
        case "charge.refunded": {
          const pi = typeof object.payment_intent === "string" ? object.payment_intent : object.payment_intent?.id;
          const full = Number(object.amount_refunded) >= Number(object.amount_captured ?? object.amount);
          const status = full ? "refunded" : "partially_refunded";
          const orderId = await store.setPaymentStatusByPaymentIntent(pi, status, event.id);
          log(redactForLog(event, { stripe_payment_intent_id: pi, payment_status: status }));
          return { handled: true, orderId };
        }
        default:
          return { handled: false };
      }
    },
  };
}

// In-memory store implementing the same contract as the Supabase store.
// Used by tests and available for local dev; NOT durable.
export function createMemoryOrderStore() {
  const events = new Map(); // stripe_event_id -> record
  const orders = new Map(); // session_id -> order (with id, items)
  let counter = 0;
  return {
    events,
    orders,
    async recordEvent({ stripe_event_id, event_type, payload }) {
      if (events.has(stripe_event_id)) return { duplicate: true };
      events.set(stripe_event_id, { stripe_event_id, event_type, payload, processing_status: "received", order_id: null, processing_error: null });
      return { duplicate: false };
    },
    async markEvent(stripeEventId, status, { orderId = null, error = null } = {}) {
      const rec = events.get(stripeEventId);
      if (rec) { rec.processing_status = status; rec.order_id = orderId; rec.processing_error = error; }
    },
    async upsertOrder(order, items) {
      const existing = orders.get(order.stripe_checkout_session_id);
      if (existing) {
        Object.assign(existing, order);
        existing.items = items;
        return { orderId: existing.id };
      }
      const id = `order-${++counter}`;
      orders.set(order.stripe_checkout_session_id, { id, ...order, fulfillment_status: "unfulfilled", items });
      return { orderId: id };
    },
    async setPaymentStatusBySession(sessionId, status, eventId) {
      const order = orders.get(sessionId);
      if (!order) return null;
      order.payment_status = status;
      order.last_stripe_event_id = eventId;
      return order.id;
    },
    async setPaymentStatusByPaymentIntent(paymentIntentId, status, eventId) {
      for (const order of orders.values()) {
        if (order.stripe_payment_intent_id === paymentIntentId) {
          order.payment_status = status;
          order.last_stripe_event_id = eventId;
          return order.id;
        }
      }
      return null;
    },
  };
}

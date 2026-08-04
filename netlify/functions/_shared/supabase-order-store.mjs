// ============================================================================
// supabase-order-store.mjs -- durable order store over a service-role client.
//
// The Supabase client is INJECTED (created in the Netlify function from
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY); this module never reads env vars
// and never creates a connection at import time, so `npm test` cannot reach
// any database. Same contract as createMemoryOrderStore().
// ============================================================================

export function createSupabaseOrderStore(client) {
  if (!client) throw new Error("createSupabaseOrderStore requires a supabase client");
  const fail = (op, error) => { throw new Error(`${op} failed: ${error.message || error.code || "unknown"}`); };
  return {
    async recordEvent({ stripe_event_id, event_type, payload }) {
      const { error } = await client.from("stripe_events").insert({ stripe_event_id, event_type, payload });
      if (error) {
        if (error.code === "23505") return { duplicate: true }; // unique stripe_event_id
        fail("recordEvent", error);
      }
      return { duplicate: false };
    },
    async markEvent(stripeEventId, status, { orderId = null, error: processingError = null } = {}) {
      const { error } = await client
        .from("stripe_events")
        .update({ processing_status: status, order_id: orderId, processing_error: processingError, processed_at: new Date().toISOString() })
        .eq("stripe_event_id", stripeEventId);
      if (error) fail("markEvent", error);
    },
    async upsertOrder(order, items) {
      const { data, error } = await client
        .from("orders")
        .upsert(order, { onConflict: "stripe_checkout_session_id" })
        .select("id")
        .single();
      if (error) fail("upsertOrder", error);
      const orderId = data.id;
      if (items.length) {
        const rows = items.map((item) => ({ ...item, order_id: orderId }));
        const { error: itemError } = await client
          .from("order_items")
          .upsert(rows, { onConflict: "order_id,public_sku" });
        if (itemError) fail("upsertOrderItems", itemError);
      }
      return { orderId };
    },
    async setPaymentStatusBySession(sessionId, status, eventId) {
      const { data, error } = await client
        .from("orders")
        .update({ payment_status: status, last_stripe_event_id: eventId })
        .eq("stripe_checkout_session_id", sessionId)
        .select("id");
      if (error) fail("setPaymentStatusBySession", error);
      return data?.[0]?.id ?? null;
    },
    async setPaymentStatusByPaymentIntent(paymentIntentId, status, eventId) {
      if (!paymentIntentId) return null;
      const { data, error } = await client
        .from("orders")
        .update({ payment_status: status, last_stripe_event_id: eventId })
        .eq("stripe_payment_intent_id", paymentIntentId)
        .select("id");
      if (error) fail("setPaymentStatusByPaymentIntent", error);
      return data?.[0]?.id ?? null;
    },
  };
}

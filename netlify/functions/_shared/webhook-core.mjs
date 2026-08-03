function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }

export function createWebhookHandler({ constructEvent, processedEvents = new Set(), log = console.info }) {
  return async (request) => {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const signature = request.headers.get("stripe-signature");
    if (!signature) return json({ error: "Missing signature" }, 400);
    const rawBody = await request.text();
    let event;
    try { event = constructEvent(rawBody, signature); } catch { return json({ error: "Invalid signature" }, 400); }
    if (processedEvents.has(event.id)) return json({ received: true, duplicate: true });
    if (event.type !== "checkout.session.completed") return json({ received: true, ignored: true });
    const session = event.data.object;
    log("stripe.checkout.completed", {
      event_id: event.id, session_id: session.id, payment_status: session.payment_status,
      amount_total: session.amount_total, currency: session.currency, public_skus: session.metadata?.public_skus || ""
    });
    // Best-effort process memory only. Replace with a durable event ledger before fulfillment automation.
    processedEvents.add(event.id);
    return json({ received: true });
  };
}

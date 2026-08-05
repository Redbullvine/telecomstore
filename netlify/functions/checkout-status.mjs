// GET /api/checkout-status?session_id=cs_... — narrowly scoped, server-side
// payment confirmation for the success page.
//
// The success page must never trust query-string totals; it sends only the
// Checkout Session id (an unguessable bearer token Stripe put in the redirect
// URL) and this function retrieves the session FROM STRIPE server-side. The
// response is deliberately minimal: paid/processing/open plus our own
// reference code — no amounts, no addresses, no customer data, no Stripe
// internals. Webhook delivery remains the authoritative confirmation that
// mutates order state; this endpoint only reads.

import { getStripe } from "../lib/stripe-client.mjs";
import { getServiceClient } from "../lib/supabase-admin.mjs";
import { json, publicError, methodNotAllowed, logServerError } from "../lib/http.mjs";

const SESSION_ID_PATTERN = /^cs_(test|live)_[A-Za-z0-9]{10,200}$/;

export default async function handler(req) {
  if (req.method !== "GET") return methodNotAllowed();

  const stripe = getStripe();
  if (!stripe) return publicError(503, "Confirmation is temporarily unavailable.");

  const sessionId = new URL(req.url).searchParams.get("session_id") || "";
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    return publicError(400, "Missing or invalid session reference.");
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const paid = session.payment_status === "paid";
    const processing = session.status === "complete" && session.payment_status !== "paid";

    // Best-effort reference code for quote payments; absent for direct
    // checkout. Failures here must not break the confirmation.
    let referenceCode = session.metadata?.reference_code || null;
    if (!referenceCode) {
      const service = getServiceClient();
      if (service) {
        const { data } = await service
          .from("quote_requests")
          .select("reference_code")
          .eq("stripe_checkout_session_id", session.id)
          .maybeSingle();
        referenceCode = data?.reference_code || null;
      }
    }

    return json(200, {
      ok: true,
      paid,
      processing,
      open: session.status === "open",
      reference_code: referenceCode
    });
  } catch (error) {
    logServerError("checkout-status", error, {});
    // Unknown/foreign session ids surface as a generic failure.
    return publicError(404, "We could not confirm this payment reference.");
  }
}

export const config = { path: "/api/checkout-status" };

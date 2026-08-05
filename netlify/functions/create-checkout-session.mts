import Stripe from "stripe";
import pricing from "./_shared/opening-pricing.json" with { type: "json" };
import { createCheckoutHandler } from "./_shared/checkout-core.mjs";

export default async (request: Request) => {
  const secret = Netlify.env.get("STRIPE_SECRET_KEY");
  const siteUrl = Netlify.env.get("PUBLIC_SITE_URL");
  if (!secret || !siteUrl) return new Response(JSON.stringify({ error: "Checkout is not configured" }), { status: 503, headers: { "content-type": "application/json" } });
  const stripe = new Stripe(secret);
  return createCheckoutHandler({ pricing, siteUrl: siteUrl.replace(/\/$/, ""), createSession: (params: Stripe.Checkout.SessionCreateParams) => stripe.checkout.sessions.create(params) })(request);
};

export const config = { path: "/api/create-checkout-session" };

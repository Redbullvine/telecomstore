import Stripe from "stripe";
import { createWebhookHandler } from "./_shared/webhook-core.mjs";

const processedEvents = new Set<string>();
export default async (request: Request) => {
  const secretKey = Netlify.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Netlify.env.get("STRIPE_WEBHOOK_SECRET");
  if (!secretKey || !webhookSecret) return new Response(JSON.stringify({ error: "Webhook is not configured" }), { status: 503, headers: { "content-type": "application/json" } });
  const stripe = new Stripe(secretKey);
  return createWebhookHandler({ processedEvents, constructEvent: (body: string, signature: string) => stripe.webhooks.constructEvent(body, signature, webhookSecret) })(request);
};

export const config = { path: "/api/stripe-webhook" };

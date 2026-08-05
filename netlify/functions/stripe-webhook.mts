import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { createWebhookHandler, missingWebhookEnv } from "./_shared/webhook-core.mjs";
import { createSupabaseOrderStore } from "./_shared/supabase-order-store.mjs";
import pricing from "./_shared/opening-pricing.json" with { type: "json" };

export default async (request: Request) => {
  const env = {
    STRIPE_SECRET_KEY: Netlify.env.get("STRIPE_SECRET_KEY"),
    STRIPE_WEBHOOK_SECRET: Netlify.env.get("STRIPE_WEBHOOK_SECRET"),
    SUPABASE_URL: Netlify.env.get("SUPABASE_URL"),
    SUPABASE_SERVICE_ROLE_KEY: Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  };
  const missing = missingWebhookEnv(env);
  if (missing.length) {
    // Names only; never values. Refuse instead of running without durability.
    console.error("stripe-webhook missing configuration", missing.join(","));
    return new Response(JSON.stringify({ error: "Webhook is not configured" }), { status: 503, headers: { "content-type": "application/json" } });
  }
  const stripe = new Stripe(env.STRIPE_SECRET_KEY!);
  const supabase = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  return createWebhookHandler({
    store: createSupabaseOrderStore(supabase),
    pricing,
    constructEvent: (body: string, signature: string) => stripe.webhooks.constructEvent(body, signature, env.STRIPE_WEBHOOK_SECRET!),
  })(request);
};

export const config = { path: "/api/stripe-webhook" };

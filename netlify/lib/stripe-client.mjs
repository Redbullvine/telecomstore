// Stripe client factory. Server-side only — the secret key never reaches the
// browser bundle and is never logged. All Stripe writes must pass an
// idempotency key derived from stable business identifiers.

import Stripe from "stripe";
import { getStripeConfig } from "./env.mjs";

let cached = null;

export function getStripe() {
  if (cached) return cached;
  const { secretKey, configured } = getStripeConfig();
  if (!configured) return null;
  // No apiVersion override: the SDK pins the API version it was built for,
  // which is the version its typed shapes actually match.
  cached = new Stripe(secretKey, {
    maxNetworkRetries: 2,
    appInfo: { name: "telecomstore-payments", url: "https://telecomstore.net" }
  });
  return cached;
}

// Deterministic idempotency key: the same business action on the same quote
// with the same amount always maps to the same key, so a double-click or a
// retried request cannot create a duplicate Stripe object.
export function idempotencyKey(action, quoteRequestId, amountCents) {
  return `ts-${action}-${quoteRequestId}-${amountCents}`;
}

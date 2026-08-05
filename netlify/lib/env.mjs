// Server-side environment access for the payment system.
// Presence checks only — no secret value ever leaves this module except as a
// configured client object. Never log the values held here.

export function getSupabaseServerConfig() {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  return { url, serviceRoleKey, configured: Boolean(url && serviceRoleKey) };
}

export function getStripeConfig() {
  const secretKey = (process.env.STRIPE_SECRET_KEY || "").trim();
  const webhookSecret = (process.env.STRIPE_WEBHOOK_SECRET || "").trim();
  return {
    secretKey,
    webhookSecret,
    configured: Boolean(secretKey),
    webhookConfigured: Boolean(webhookSecret),
    mode: stripeKeyMode(secretKey)
  };
}

// Classifies a Stripe secret key by prefix only. Returns "test", "live", or
// null when absent/unrecognized. Safe to log the RETURN VALUE, never the key.
export function stripeKeyMode(secretKey) {
  if (!secretKey) return null;
  if (/^(sk|rk)_test_/.test(secretKey)) return "test";
  if (/^(sk|rk)_live_/.test(secretKey)) return "live";
  return null;
}

export function getSiteUrl() {
  const url = (process.env.PAYMENT_SITE_URL || process.env.URL || "").trim();
  return url.replace(/\/+$/, "");
}

export function getReturnUrls() {
  const site = getSiteUrl();
  return {
    successUrl: (process.env.PAYMENT_SUCCESS_URL || `${site}/payment-success.html`).trim(),
    cancelUrl: (process.env.PAYMENT_CANCEL_URL || `${site}/payment-cancel.html`).trim()
  };
}

// Presence audit used by diagnostics and preflight checks. Names and statuses
// only; values are never included.
export function auditPaymentEnv() {
  const stripe = getStripeConfig();
  const supabase = getSupabaseServerConfig();
  const entry = (present, extra = {}) => ({ status: present ? "present" : "missing", ...extra });
  return {
    STRIPE_SECRET_KEY: entry(Boolean(stripe.secretKey), stripe.secretKey ? { mode: stripe.mode || "invalid-format" } : {}),
    STRIPE_WEBHOOK_SECRET: entry(stripe.webhookConfigured),
    SUPABASE_URL: entry(Boolean(supabase.url)),
    SUPABASE_SERVICE_ROLE_KEY: entry(Boolean(supabase.serviceRoleKey)),
    SITE_URL: entry(Boolean(getSiteUrl()))
  };
}

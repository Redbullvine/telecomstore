// Quote status transition rules. This map mirrors the SQL trigger
// public.enforce_quote_status_transition() in migration 007 — keep both in
// sync. The database trigger is the final authority; this copy lets server
// functions fail fast with a clean error before touching the database.

export const QUOTE_STATUSES = [
  "new", "reviewing", "quoted", "payment_sent",
  "paid", "canceled", "refunded", "fulfilled"
];

export const ALLOWED_TRANSITIONS = {
  new: ["reviewing", "canceled"],
  reviewing: ["quoted", "canceled"],
  quoted: ["payment_sent", "reviewing", "canceled"],
  payment_sent: ["paid", "quoted", "canceled"],
  paid: ["fulfilled", "refunded"],
  fulfilled: ["refunded"],
  canceled: ["reviewing"],
  refunded: []
};

export function canTransition(from, to) {
  if (from === to) return true;
  return Array.isArray(ALLOWED_TRANSITIONS[from]) && ALLOWED_TRANSITIONS[from].includes(to);
}

// Statuses a webhook is allowed to set. Webhooks never move a quote backwards
// and never cancel or fulfill — those are admin decisions.
export const WEBHOOK_SETTABLE_STATUSES = ["paid", "refunded"];

export const PAYMENT_STATUSES = [
  "pending", "processing", "succeeded", "failed",
  "canceled", "refunded", "partially_refunded"
];

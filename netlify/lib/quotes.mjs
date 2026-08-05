// Quote-request domain helpers shared by the payment functions.

import { createHash, randomBytes } from "node:crypto";

// Human-friendly reference like QR-7F3K9X2M (unambiguous alphabet).
const REFERENCE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function generateReferenceCode() {
  const bytes = randomBytes(8);
  let code = "";
  for (const b of bytes) code += REFERENCE_ALPHABET[b % REFERENCE_ALPHABET.length];
  return `QR-${code}`;
}

export function hashIp(ip) {
  if (!ip) return null;
  return createHash("sha256").update(`telecomstore:${ip}`).digest("hex");
}

// Rate limits for anonymous quote submission.
export const RATE_LIMITS = {
  perEmailPerHour: 5,
  perIpPerHour: 15
};

export async function isRateLimited(service, { email, ipHash }) {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { count: emailCount, error: emailError } = await service
    .from("quote_requests")
    .select("id", { count: "exact", head: true })
    .eq("customer_email", email)
    .gte("created_at", oneHourAgo);
  if (emailError) throw new Error(`rate limit check failed: ${emailError.message}`);
  if ((emailCount ?? 0) >= RATE_LIMITS.perEmailPerHour) return true;

  if (ipHash) {
    const { count: ipCount, error: ipError } = await service
      .from("quote_requests")
      .select("id", { count: "exact", head: true })
      .eq("request_ip_hash", ipHash)
      .gte("created_at", oneHourAgo);
    if (ipError) throw new Error(`rate limit check failed: ${ipError.message}`);
    if ((ipCount ?? 0) >= RATE_LIMITS.perIpPerHour) return true;
  }

  return false;
}

// Records a status change and its history row. `changedBy` is null for
// system/webhook transitions. Timestamp columns ride along per status.
export async function applyStatusChange(service, quoteRequest, toStatus, { changedBy = null, note = null, extra = {} } = {}) {
  const stampColumn = {
    quoted: "quoted_at",
    payment_sent: "payment_sent_at",
    paid: "paid_at",
    canceled: "canceled_at",
    refunded: "refunded_at",
    fulfilled: "fulfilled_at"
  }[toStatus];

  const update = { status: toStatus, ...extra };
  if (stampColumn) update[stampColumn] = new Date().toISOString();

  const { data, error } = await service
    .from("quote_requests")
    .update(update)
    .eq("id", quoteRequest.id)
    .eq("status", quoteRequest.status) // optimistic lock: no concurrent double-transition
    .select()
    .maybeSingle();

  if (error) throw new Error(`status update failed: ${error.message}`);
  if (!data) return null; // someone else transitioned first

  const { error: historyError } = await service.from("quote_status_history").insert({
    quote_request_id: quoteRequest.id,
    from_status: quoteRequest.status,
    to_status: toStatus,
    changed_by: changedBy,
    note
  });
  if (historyError) throw new Error(`status history insert failed: ${historyError.message}`);

  return data;
}

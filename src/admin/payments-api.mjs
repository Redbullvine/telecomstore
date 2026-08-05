// Client-side data access for the Admin Payment Center.
//
// Reads go straight to Supabase under the admin's own session (RLS grants
// admins SELECT only). Every mutation goes through the server functions with
// the admin's Bearer token — the browser never talks to Stripe and never
// writes payment tables directly.

import { supabase } from "../lib/supabase";

export const QUOTE_STATUSES = [
  "new", "reviewing", "quoted", "payment_sent",
  "paid", "canceled", "refunded", "fulfilled"
];

export const STATUS_LABELS = {
  new: "New",
  reviewing: "Reviewing",
  quoted: "Quoted",
  payment_sent: "Payment Sent",
  paid: "Paid",
  canceled: "Canceled",
  refunded: "Refunded",
  fulfilled: "Fulfilled"
};

async function accessToken() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("Your session expired. Please sign in again.");
  return token;
}

export async function fetchQuoteRequests({ status = "all" } = {}) {
  let query = supabase
    .from("quote_requests")
    .select("id, reference_code, status, customer_name, customer_email, customer_company, final_total, currency_code, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (status !== "all") query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}

export async function fetchQuoteDetail(id) {
  const [request, items, payments, history, notes] = await Promise.all([
    supabase.from("quote_requests").select("*").eq("id", id).maybeSingle(),
    supabase.from("quote_request_items").select("*").eq("quote_request_id", id).order("created_at"),
    supabase.from("payments").select("*").eq("quote_request_id", id).order("created_at", { ascending: false }),
    supabase.from("quote_status_history").select("*").eq("quote_request_id", id).order("created_at", { ascending: false }),
    supabase.from("quote_request_notes").select("*").eq("quote_request_id", id).order("created_at", { ascending: false })
  ]);
  for (const result of [request, items, payments, history, notes]) {
    if (result.error) throw new Error(result.error.message);
  }
  if (!request.data) throw new Error("Quote request not found.");
  return {
    request: request.data,
    items: items.data || [],
    payments: payments.data || [],
    history: history.data || [],
    notes: notes.data || []
  };
}

export async function quoteAction(id, action, body = {}) {
  const token = await accessToken();
  const response = await fetch(`/api/admin/quotes/${id}/${action}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // fall through to the generic error below
  }
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || "The action failed. Please try again.");
  }
  return payload;
}

export async function fetchPaymentsConfig() {
  const token = await accessToken();
  const response = await fetch("/api/admin/payments-config", {
    headers: { authorization: `Bearer ${token}` }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw new Error("Could not load payment configuration status.");
  return payload.audit;
}

// Client-side copies of the integer-cent helpers used by the server (the
// server re-validates everything; these exist so the UI can preview totals
// without float drift).
const DECIMAL_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

export function toCents(value) {
  if (value === null || value === undefined) return null;
  const text = typeof value === "number" ? value.toFixed(2) : String(value).trim();
  if (!DECIMAL_PATTERN.test(text)) return null;
  const [dollars, fraction = ""] = text.split(".");
  const cents = Number(dollars) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents < 0) return null;
  return cents;
}

export function centsToDecimal(cents) {
  if (!Number.isSafeInteger(cents) || cents < 0) return null;
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export function formatMoney(value, currency = "USD") {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toLocaleString("en-US", { style: "currency", currency });
}

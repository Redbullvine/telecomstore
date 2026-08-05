// HTTP helpers for payment functions. Public error messages stay generic;
// detailed diagnostics go to server logs only (never including secrets or
// full payloads with card data — Stripe never sends card numbers anyway).

export function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

export const GENERIC_ERROR = "Something went wrong. Please try again or contact us.";

export function publicError(status, message = GENERIC_ERROR) {
  return json(status, { ok: false, error: message });
}

export function methodNotAllowed() {
  return publicError(405, "Method not allowed.");
}

// Consistent server-side logging without secret leakage. Only pass primitives
// and short identifiers in `details` — never keys, tokens, or full payloads.
export function logServerError(scope, error, details = {}) {
  const safeMessage = error instanceof Error ? error.message : String(error);
  console.error(`[payments:${scope}]`, safeMessage, JSON.stringify(details));
}

export async function readJsonBody(req, maxBytes = 64 * 1024) {
  const text = await req.text();
  if (text.length > maxBytes) return { ok: false };
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

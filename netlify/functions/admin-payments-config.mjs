// GET /api/admin/payments-config — presence-only environment audit for the
// Admin Payment Center. Reports present/missing and test/live mode. No secret
// value is ever included in the response or logged.

import { requireAdmin } from "../lib/auth.mjs";
import { auditPaymentEnv } from "../lib/env.mjs";
import { json, publicError, methodNotAllowed } from "../lib/http.mjs";

export default async function handler(req) {
  if (req.method !== "GET") return methodNotAllowed();
  const auth = await requireAdmin(req);
  if (!auth.ok) return publicError(auth.status, "Not authorized.");
  return json(200, { ok: true, audit: auditPaymentEnv() });
}

export const config = { path: "/api/admin/payments-config" };

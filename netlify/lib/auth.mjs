// Admin authentication for payment endpoints.
//
// The caller must send the Supabase session access token as a Bearer token.
// We resolve the user with that token, then check the profiles row with the
// SERVICE client (not the caller's client) so the approval check cannot be
// spoofed by anything the browser controls.

import { getServiceClient, getUserClient } from "./supabase-admin.mjs";

export const PAYMENT_ADMIN_ROLES = ["admin"];

export async function requireAdmin(req) {
  const header = req.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return { ok: false, status: 401 };
  const token = match[1].trim();

  const userClient = getUserClient(token);
  const service = getServiceClient();
  if (!userClient || !service) return { ok: false, status: 503 };

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) return { ok: false, status: 401 };

  const { data: profile, error: profileError } = await service
    .from("profiles")
    .select("id, role, approved, email")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileError || !profile) return { ok: false, status: 403 };
  if (!profile.approved || !PAYMENT_ADMIN_ROLES.includes(profile.role)) {
    return { ok: false, status: 403 };
  }

  return { ok: true, user: userData.user, profile };
}

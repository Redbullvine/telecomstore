// Service-role Supabase client for server functions ONLY. This module must
// never be imported by anything under src/ — the service role key bypasses
// RLS and exists exclusively inside Netlify function runtime.

import { createClient } from "@supabase/supabase-js";
import { getSupabaseServerConfig } from "./env.mjs";

let cached = null;

export function getServiceClient() {
  if (cached) return cached;
  const { url, serviceRoleKey, configured } = getSupabaseServerConfig();
  if (!configured) return null;
  cached = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  return cached;
}

// Anon-key client bound to a caller's JWT, used only to resolve the calling
// admin user. RLS still applies to this client.
export function getUserClient(accessToken) {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
  const anonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "").trim();
  if (!url || !anonKey || !accessToken) return null;
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

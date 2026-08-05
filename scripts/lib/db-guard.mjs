// ============================================================================
// db-guard.mjs -- pure guards that keep the importer OFF production.
//
// No I/O. The loader calls assertLocalConnection() before opening any client.
// ============================================================================

export const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "host.docker.internal", "::1"]);

// Hosts / substrings that indicate a hosted Supabase or otherwise non-local DB.
const FORBIDDEN_HOST_PATTERNS = [/supabase\.co$/i, /supabase\.in$/i, /\.pooler\.supabase\.com$/i, /amazonaws\.com$/i];

export function parseHost(connectionString) {
  // Accept postgres URLs; extract host without pulling in credentials.
  let u;
  try {
    u = new URL(connectionString);
  } catch {
    return null;
  }
  return (u.hostname || "").toLowerCase();
}

// Returns { ok, host, reason }. Never throws.
export function evaluateConnection(connectionString, { productionProjectRef = "" } = {}) {
  if (!connectionString || typeof connectionString !== "string") {
    return { ok: false, host: null, reason: "missing_connection_string" };
  }
  // A production project reference must never appear anywhere in the string.
  const ref = (productionProjectRef || "").trim();
  if (ref && connectionString.toLowerCase().includes(ref.toLowerCase())) {
    return { ok: false, host: null, reason: "production_project_ref_present" };
  }
  const host = parseHost(connectionString);
  if (!host) return { ok: false, host: null, reason: "unparseable_connection_string" };
  for (const re of FORBIDDEN_HOST_PATTERNS) {
    if (re.test(host)) return { ok: false, host, reason: "forbidden_remote_host" };
  }
  if (!ALLOWED_HOSTS.has(host)) return { ok: false, host, reason: "host_not_in_local_allowlist" };
  return { ok: true, host, reason: "ok" };
}

export function assertLocalConnection(connectionString, opts = {}) {
  const r = evaluateConnection(connectionString, opts);
  if (!r.ok) {
    const err = new Error(`Refusing to connect: ${r.reason}${r.host ? ` (host=${r.host})` : ""}`);
    err.code = "DB_GUARD_REFUSED";
    err.reason = r.reason;
    throw err;
  }
  return r;
}

// Valid run modes. Absence of an explicit mode must fail closed.
export const MODES = new Set(["dry-run", "apply-local"]);
export function assertMode(mode) {
  if (!MODES.has(mode)) {
    const err = new Error(`Invalid or missing mode '${mode || ""}'. Use --dry-run or --apply-local.`);
    err.code = "MODE_REFUSED";
    throw err;
  }
  return mode;
}

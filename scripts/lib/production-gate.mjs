// ============================================================================
// production-gate.mjs -- pure safeguards for the guarded production importer.
//
// Everything in this module is side-effect free (except resolveConfirmation's
// optional file read) so every gate is unit-testable without any database.
// The production importer refuses to act unless EVERY gate passes.
//
// NOTE: the project reference below is an identifier, not a credential. No
// connection string, key, or token appears anywhere in this module.
// ============================================================================

import fs from "node:fs";
import path from "node:path";

export const EXPECTED_PROJECT_REF = "obftybyldpwnyqnupdjt";
export const AUTH_ENV_NAME = "TELECOMSTORE_PRODUCTION_IMPORT";
export const AUTH_ENV_VALUE = "AUTHORIZE_REVIEWED_TELECOM_CATALOG";
export const CONFIRMATION_PHRASE = "IMPORT REVIEWED TELECOM CATALOG";

// --- Gate 2 + 3: environment authorization and exact project reference -------
export function evaluateAuthorization({ env = {}, projectRef = "" } = {}) {
  const failures = [];
  if (env[AUTH_ENV_NAME] !== AUTH_ENV_VALUE) failures.push("env_authorization_missing_or_wrong");
  if (projectRef !== EXPECTED_PROJECT_REF) failures.push("project_ref_mismatch");
  return failures;
}

// --- Gate 5 + 6: approved-source validation ---------------------------------
// Key names that may never appear anywhere in the source (any nesting level).
const FORBIDDEN_KEY = /cost|wholesale|map_price|\bmsrp\b|password|secret|service_role|api_key|token|credential/i;
// Private supplier data is allowed ONLY under an explicit "_private" prefix.
// (publish_supplier_image is the public no-publish control flag, not data.)
const SUPPLIER_PRIVATE_KEY = /supplier_sku|supplier_quantity|supplier_image_url/i;
// A JWT-looking value anywhere is treated as a credential leak.
const JWT_VALUE = /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/;

export function deepScanForbidden(obj, pathPrefix = "") {
  const hits = [];
  if (obj == null) return hits;
  if (typeof obj === "string") {
    if (JWT_VALUE.test(obj)) hits.push(`${pathPrefix}: jwt_like_value`);
    return hits;
  }
  if (typeof obj !== "object") return hits;
  for (const [k, v] of Object.entries(obj)) {
    const p = pathPrefix ? `${pathPrefix}.${k}` : k;
    if (FORBIDDEN_KEY.test(k)) hits.push(`${p}: forbidden_key`);
    if (SUPPLIER_PRIVATE_KEY.test(k) && !k.startsWith("_private")) hits.push(`${p}: supplier_field_not_private`);
    hits.push(...deepScanForbidden(v, p));
  }
  return hits;
}

export function validateApprovedSource(records) {
  const failures = [];
  if (!Array.isArray(records) || records.length === 0) {
    return { ok: false, failures: ["source_not_a_nonempty_array"], counts: {} };
  }
  const seenSku = new Set();
  const seenSupplier = new Set();
  const seenGtin = new Set();
  let duplicates = 0;
  records.forEach((r, i) => {
    const at = (m) => failures.push(`record[${i}] (${r?.public_sku ?? "?"}): ${m}`);
    if (r?.opening_approved !== true) at("opening_approved_not_true");
    if (r?.price_mode !== "request_quote") at("price_mode_not_request_quote");
    if (r?.public_price !== null) at("public_price_not_null");
    if (r?.publish_supplier_image !== false) at("publish_supplier_image_not_false");
    if (r?.image_rights_status !== "pending") at("image_rights_status_not_pending");
    for (const req of ["public_sku", "manufacturer_mpn", "brand", "title", "category"]) {
      if (!r?.[req] || !String(r[req]).trim()) at(`missing_${req}`);
    }
    const sku = String(r?.public_sku || "").toUpperCase();
    const sup = String(r?._private_supplier_sku || "").toUpperCase();
    const gtin = String(r?.gtin || "");
    if (sku && seenSku.has(sku)) { at("duplicate_public_sku"); duplicates++; } else if (sku) seenSku.add(sku);
    if (sup && seenSupplier.has(sup)) { at("duplicate_supplier_sku"); duplicates++; } else if (sup) seenSupplier.add(sup);
    if (gtin && seenGtin.has(gtin)) { at("duplicate_gtin"); duplicates++; } else if (gtin) seenGtin.add(gtin);
    failures.push(...deepScanForbidden(r, `record[${i}]`));
  });
  return { ok: failures.length === 0, failures, counts: { total: records.length, duplicates } };
}

// --- Gate: production DB host must belong to the exact authorized project ----
export function checkProductionHost(dbUrl, projectRef) {
  if (!dbUrl) return { ok: false, reason: "missing_db_url" };
  let u;
  try { u = new URL(dbUrl); } catch { return { ok: false, reason: "unparseable_db_url" }; }
  const host = (u.hostname || "").toLowerCase();
  if (host !== `db.${projectRef}.supabase.co`.toLowerCase()) {
    return { ok: false, reason: "host_not_authorized_project", host };
  }
  return { ok: true, host };
}

// --- Gate: preflight snapshots must live OUTSIDE the repository --------------
export function checkSnapshotDir(snapshotDir, repoRoot) {
  if (!snapshotDir) return { ok: false, reason: "missing_snapshot_dir" };
  const abs = path.resolve(snapshotDir);
  const root = path.resolve(repoRoot);
  if (abs === root || abs.startsWith(root + path.sep)) {
    return { ok: false, reason: "snapshot_dir_inside_repository" };
  }
  return { ok: true, dir: abs };
}

// --- Gates 9-11: reconciliation plan against existing production products ----
// existing: rows of { id, sku, manufacturer_mpn, gtin, brand, title, category,
// price, status }. Returns inserts / updates / unchanged / conflicts. Existing
// products absent from the source are never touched.
const norm = (s) => String(s ?? "").trim().toUpperCase();
export function planReconciliation(records, existing) {
  const bySku = new Map();
  const byGtin = new Map();
  for (const e of existing) {
    if (e.sku) bySku.set(norm(e.sku), e);
    if (e.gtin) byGtin.set(String(e.gtin), e);
  }
  const inserts = [], updates = [], unchanged = [], conflicts = [];
  for (const r of records) {
    const sku = norm(r.public_sku);
    const hit = bySku.get(sku);
    const gtinOwner = r.gtin ? byGtin.get(String(r.gtin)) : null;
    if (gtinOwner && norm(gtinOwner.sku) !== sku) {
      conflicts.push({ public_sku: r.public_sku, reason: "gtin_belongs_to_other_product", other_sku: gtinOwner.sku });
      continue;
    }
    if (!hit) { inserts.push({ record: r }); continue; }
    // Same public SKU: identity must match exactly to reconcile safely.
    const mpnMatch = norm(hit.manufacturer_mpn) === norm(r.manufacturer_mpn);
    const gtinMatch = !hit.gtin || !r.gtin ? String(hit.gtin || "") === String(r.gtin || "") : String(hit.gtin) === String(r.gtin);
    if (!mpnMatch || !gtinMatch) {
      conflicts.push({ public_sku: r.public_sku, reason: "sku_identity_conflict", existing_mpn: hit.manufacturer_mpn, existing_gtin: hit.gtin });
      continue;
    }
    const same =
      String(hit.brand ?? "") === String(r.brand ?? "") &&
      String(hit.title ?? "") === String(r.title ?? "") &&
      String(hit.category ?? "") === String(r.category ?? "") &&
      hit.price == null;
    if (same) unchanged.push({ record: r, productId: hit.id });
    else updates.push({ record: r, productId: hit.id });
  }
  return { inserts, updates, unchanged, conflicts };
}

// --- Gate 20: typed confirmation ---------------------------------------------
// Interactive: promptFn must return the exact phrase. Non-interactive: a
// one-time confirmation file whose trimmed contents exactly match the phrase.
// This module never creates that file.
export async function resolveConfirmation({ stdinIsTTY, promptFn, confirmationFile } = {}) {
  if (stdinIsTTY && typeof promptFn === "function") {
    const answer = await promptFn(`Type the exact phrase to authorize: ${CONFIRMATION_PHRASE}\n> `);
    if ((answer ?? "").trim() === CONFIRMATION_PHRASE) return { ok: true, via: "interactive" };
    return { ok: false, reason: "interactive_phrase_mismatch" };
  }
  if (!confirmationFile) return { ok: false, reason: "non_interactive_requires_confirmation_file" };
  let contents;
  try { contents = fs.readFileSync(confirmationFile, "utf8"); } catch { return { ok: false, reason: "confirmation_file_unreadable" }; }
  if (contents.trim() !== CONFIRMATION_PHRASE) return { ok: false, reason: "confirmation_file_phrase_mismatch" };
  return { ok: true, via: "file" };
}

// --- Gate 19: redacted logging -----------------------------------------------
export function redact(text) {
  return String(text)
    .replace(/postgres(ql)?:\/\/[^\s"']+/gi, "postgresql://[REDACTED]")
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(\.[A-Za-z0-9_-]+)?/g, "[REDACTED_JWT]")
    .replace(/("?(?:supplier_cost|map_price|msrp|password|secret|api_key|service_role[a-z_]*)"?\s*[:=]\s*)("[^"]*"|[\w.-]+)/gi, "$1[REDACTED]");
}

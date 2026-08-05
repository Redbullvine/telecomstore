// Static boundary checks on migration 007: RLS everywhere, no anonymous
// access path, webhook idempotency key, and no supplier data leakage into the
// payment schema.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sql = await readFile(
  new URL("../supabase/migrations/20260805120000_quote_to_payment.sql", import.meta.url),
  "utf8"
);

const PAYMENT_TABLES = [
  "quote_requests",
  "quote_request_items",
  "orders",
  "payments",
  "stripe_events",
  "quote_status_history",
  "quote_request_notes",
  "product_checkout_approvals"
];

test("every payment table enables row level security", () => {
  for (const table of PAYMENT_TABLES) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`),
      `${table} must enable RLS`);
  }
});

test("no policy grants anything to anon", () => {
  assert.doesNotMatch(sql, /to\s+anon(?![a-z])/i, "no payment policy may target the anon role");
});

test("anon privileges are explicitly revoked on every payment table", () => {
  for (const table of PAYMENT_TABLES) {
    assert.match(sql, new RegExp(`revoke all on table public\\.${table} from anon`),
      `${table} must revoke anon privileges`);
  }
});

test("authenticated write privileges are revoked (service role is the only writer)", () => {
  assert.match(sql, /revoke insert, update, delete, truncate, references, trigger[\s\S]*?from authenticated/,
    "authenticated clients must be read-only on payment tables");
});

test("admin read policies are gated on is_admin()", () => {
  const policyCount = (sql.match(/public\.is_admin\(\)/g) || []).length;
  assert.ok(policyCount >= PAYMENT_TABLES.length, "each payment table needs an is_admin-gated select policy");
});

test("stripe_events has the unique event-id idempotency index", () => {
  assert.match(sql, /create unique index if not exists stripe_events_event_id_idx\s+on public\.stripe_events \(stripe_event_id\)/);
});

test("quote status transitions are trigger-enforced", () => {
  assert.match(sql, /create or replace function public\.enforce_quote_status_transition/);
  assert.match(sql, /create trigger quote_requests_status_transition\s+before update of status on public\.quote_requests/);
});

test("total arithmetic is check-constrained", () => {
  assert.match(sql, /final_total = product_subtotal \+ shipping_amount \+ tax_amount/);
});

test("no supplier data leaks into the payment schema", () => {
  for (const forbidden of ["supplier_sku", "supplier_cost", "wholesale", "map_price", "msrp", "margin"]) {
    assert.ok(!sql.includes(forbidden), `payment schema must not reference ${forbidden}`);
  }
  assert.doesNotMatch(sql, /alter table public\.products[^_]/, "migration must not alter the products table");
});

test("migration documents a rollback path", () => {
  assert.match(sql, /ROLLBACK RECIPE/);
  for (const table of PAYMENT_TABLES) {
    assert.match(sql, new RegExp(`drop table public\\.${table}`), `rollback must drop ${table}`);
  }
});

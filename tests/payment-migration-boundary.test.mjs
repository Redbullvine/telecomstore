// Static boundary checks on the payment migrations: RLS everywhere, no
// anonymous access path, webhook idempotency key, no supplier data leakage,
// and no table collisions between the quote migration and the direct-checkout
// order-tracking migration it builds on.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const quoteSql = await readFile(
  new URL("../supabase/migrations/20260805120000_quote_to_payment.sql", import.meta.url),
  "utf8"
);
const orderSql = await readFile(
  new URL("../supabase/migrations/20260803120000_stripe_order_tracking.sql", import.meta.url),
  "utf8"
);

const QUOTE_TABLES = [
  "quote_requests",
  "quote_request_items",
  "payments",
  "quote_status_history",
  "quote_request_notes"
];

test("every quote payment table enables row level security", () => {
  for (const table of QUOTE_TABLES) {
    assert.match(quoteSql, new RegExp(`alter table public\\.${table} enable row level security`),
      `${table} must enable RLS`);
  }
});

test("no quote policy grants anything to anon", () => {
  assert.doesNotMatch(quoteSql, /to\s+anon(?![a-z])/i, "no payment policy may target the anon role");
});

test("anon privileges are explicitly revoked on every quote table", () => {
  for (const table of QUOTE_TABLES) {
    assert.match(quoteSql, new RegExp(`revoke all on table public\\.${table} from anon`),
      `${table} must revoke anon privileges`);
  }
});

test("authenticated write privileges are revoked (service role is the only writer)", () => {
  assert.match(quoteSql, /revoke insert, update, delete, truncate, references, trigger[\s\S]*?from authenticated/,
    "authenticated clients must be read-only on quote payment tables");
});

test("admin read policies are gated on is_admin()", () => {
  const policyCount = (quoteSql.match(/public\.is_admin\(\)/g) || []).length;
  assert.ok(policyCount >= QUOTE_TABLES.length, "each quote table needs an is_admin-gated select policy");
});

test("the shared stripe_events ledger keeps its unique event-id idempotency key", () => {
  assert.match(orderSql, /constraint stripe_events_unique_event unique \(stripe_event_id\)/);
});

test("the quote migration does not re-create tables owned by the order-tracking migration", () => {
  for (const shared of ["stripe_events", "orders", "order_items"]) {
    assert.doesNotMatch(quoteSql, new RegExp(`create table if not exists public\\.${shared}[^_]`),
      `quote migration must not create ${shared} — migration 20260803 owns it`);
  }
});

test("quote status transitions are trigger-enforced", () => {
  assert.match(quoteSql, /create or replace function public\.enforce_quote_status_transition/);
  assert.match(quoteSql, /create trigger quote_requests_status_transition\s+before update of status on public\.quote_requests/);
});

test("total arithmetic is check-constrained", () => {
  assert.match(quoteSql, /final_total = product_subtotal \+ shipping_amount \+ tax_amount/);
});

test("no supplier data leaks into the payment schema", () => {
  for (const sql of [quoteSql, orderSql]) {
    for (const forbidden of ["supplier_sku", "supplier_cost", "wholesale", "map_price", "msrp", "margin"]) {
      assert.ok(!sql.includes(forbidden), `payment schema must not reference ${forbidden}`);
    }
  }
  assert.doesNotMatch(quoteSql, /alter table public\.products[^_]/, "quote migration must not alter the products table");
});

test("the quote migration documents a rollback path that spares shared tables", () => {
  assert.match(quoteSql, /ROLLBACK RECIPE/);
  for (const table of QUOTE_TABLES) {
    assert.match(quoteSql, new RegExp(`drop table public\\.${table}`), `rollback must drop ${table}`);
  }
  assert.doesNotMatch(quoteSql, /drop table public\.orders/, "rollback must not drop the shared orders table");
  assert.doesNotMatch(quoteSql, /drop table public\.stripe_events/, "rollback must not drop the shared ledger");
});

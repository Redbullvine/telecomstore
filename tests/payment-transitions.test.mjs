import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ALLOWED_TRANSITIONS, QUOTE_STATUSES, canTransition, WEBHOOK_SETTABLE_STATUSES } from "../netlify/lib/transitions.mjs";

const migrationSource = await readFile(
  new URL("../supabase/migrations/20260805120000_quote_to_payment.sql", import.meta.url),
  "utf8"
);

test("allowed transitions include the full quote lifecycle", () => {
  assert.equal(canTransition("new", "reviewing"), true);
  assert.equal(canTransition("reviewing", "quoted"), true);
  assert.equal(canTransition("quoted", "payment_sent"), true);
  assert.equal(canTransition("payment_sent", "paid"), true);
  assert.equal(canTransition("paid", "fulfilled"), true);
  assert.equal(canTransition("paid", "refunded"), true);
  assert.equal(canTransition("fulfilled", "refunded"), true);
  assert.equal(canTransition("payment_sent", "quoted"), true); // re-price
  assert.equal(canTransition("canceled", "reviewing"), true); // reopen
});

test("dangerous or nonsensical transitions are blocked", () => {
  assert.equal(canTransition("new", "paid"), false);
  assert.equal(canTransition("new", "payment_sent"), false);
  assert.equal(canTransition("reviewing", "paid"), false);
  assert.equal(canTransition("paid", "new"), false);
  assert.equal(canTransition("paid", "canceled"), false);
  assert.equal(canTransition("refunded", "paid"), false);
  assert.equal(canTransition("refunded", "reviewing"), false);
  assert.equal(canTransition("canceled", "paid"), false);
});

test("same-status update is always allowed (idempotent writes)", () => {
  for (const status of QUOTE_STATUSES) assert.equal(canTransition(status, status), true);
});

test("webhooks may only set paid or refunded", () => {
  assert.deepEqual([...WEBHOOK_SETTABLE_STATUSES].sort(), ["paid", "refunded"]);
});

test("SQL trigger mirrors the JS transition table exactly", () => {
  const triggerBody = migrationSource.slice(
    migrationSource.indexOf("enforce_quote_status_transition"),
    migrationSource.indexOf("quote_requests_status_transition")
  );
  for (const [from, targets] of Object.entries(ALLOWED_TRANSITIONS)) {
    if (from === "refunded") continue; // terminal: covered by the else-false branch
    const line = triggerBody.split("\n").find((l) => l.includes(`when '${from}'`));
    assert.ok(line, `SQL trigger must handle status '${from}'`);
    for (const target of targets) {
      assert.ok(line.includes(`'${target}'`), `SQL '${from}' branch must allow '${target}'`);
    }
    // No extra targets: count quoted statuses on the line's IN list.
    const quoted = [...line.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).slice(1);
    assert.deepEqual(quoted.sort(), [...targets].sort(), `SQL '${from}' branch must allow exactly ${targets}`);
  }
  assert.match(triggerBody, /else false/, "unlisted statuses (refunded) must be terminal");
});

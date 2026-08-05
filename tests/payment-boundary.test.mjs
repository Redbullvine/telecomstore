// Source-level security boundaries for the payment system:
//   * no server secret names or Stripe SDK usage inside client code (src/)
//   * every admin endpoint authenticates before acting
//   * the public submission path validates and never trusts browser identity
//   * direct checkout is hard-gated on approvals + shipping/tax resolution

import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function readSource(relative) {
  return readFile(path.join(root, relative), "utf8");
}

async function collectFiles(dir, extensions) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await collectFiles(full, extensions));
    else if (extensions.some((ext) => entry.name.endsWith(ext))) out.push(full);
  }
  return out;
}

test("client code never references server secrets or the Stripe SDK", async () => {
  const files = await collectFiles(path.join(root, "src"), [".js", ".jsx", ".mjs", ".ts", ".tsx"]);
  assert.ok(files.length > 0);
  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.ok(!source.includes("SUPABASE_SERVICE_ROLE_KEY"), `${file} must not reference the service role key`);
    assert.ok(!source.includes("STRIPE_SECRET_KEY"), `${file} must not reference the Stripe secret key`);
    assert.ok(!source.includes("STRIPE_WEBHOOK_SECRET"), `${file} must not reference the webhook secret`);
    assert.doesNotMatch(source, /from ["']stripe["']/, `${file} must not import the Stripe server SDK`);
    assert.ok(!source.includes("netlify/lib"), `${file} must not import server-side payment modules`);
  }
});

test("admin endpoints authenticate before doing anything", async () => {
  for (const fn of ["admin-quote-actions.mjs", "admin-payments-config.mjs"]) {
    const source = await readSource(`netlify/functions/${fn}`);
    assert.match(source, /requireAdmin\(req\)/, `${fn} must call requireAdmin`);
    const authIndex = source.indexOf("requireAdmin(req)");
    const serviceIndex = source.indexOf("getServiceClient()");
    if (serviceIndex !== -1) {
      assert.ok(authIndex < serviceIndex, `${fn} must authenticate before touching the database`);
    }
  }
});

test("admin auth resolves the profile with the service client, not the caller's", async () => {
  const source = await readSource("netlify/lib/auth.mjs");
  assert.match(source, /service\s*\n?\s*\.from\("profiles"\)/, "profile lookup must use the service client");
  assert.match(source, /profile\.approved/);
  assert.match(source, /PAYMENT_ADMIN_ROLES\.includes\(profile\.role\)/);
});

test("public quote submission snapshots product identity server-side", async () => {
  const source = await readSource("netlify/functions/submit-quote-request.mjs");
  assert.match(source, /validateQuoteSubmission/);
  assert.match(source, /\.from\("products"\)/, "must look products up server-side");
  assert.match(source, /product\.status !== "available"/, "must reject unavailable products");
  assert.match(source, /isRateLimited/, "must rate limit");
  assert.ok(!source.includes("requireAdmin"), "public path must not demand admin auth");
  assert.ok(!/body\.(items\[[^\]]*\]\.)?(price|unit_amount|title)/.test(source),
    "browser-supplied price/title fields must never be read");
});

test("direct checkout is gated on explicit approval and truthful shipping/tax", async () => {
  const source = await readSource("netlify/functions/create-checkout-session.mjs");
  assert.match(source, /product_checkout_approvals/);
  assert.match(source, /approval\?\.approved === true/);
  assert.match(source, /resolveShippingAndTax/);
  assert.match(source, /function resolveShippingAndTax\(\) \{\s*return null;/, "shipping/tax resolver must refuse until real rules exist");
  assert.match(source, /toCents\(product\.price\)/, "price must come from the curated catalog");
  assert.ok(!source.includes("body.price") && !source.includes("item.price"),
    "browser price must never be read");
});

test("webhook handler verifies signatures on the raw body and checks livemode", async () => {
  const source = await readSource("netlify/functions/stripe-webhook.mjs");
  assert.match(source, /constructEvent\(rawBody, signature, webhookSecret\)/);
  assert.match(source, /req\.text\(\)/, "must verify the raw body, not parsed JSON");
  assert.match(source, /event\.livemode/, "must compare event livemode to key mode");
  const verifyIndex = source.indexOf("constructEvent(");
  const recordIndex = source.indexOf("await recordEvent(");
  assert.ok(recordIndex !== -1 && verifyIndex < recordIndex,
    "signature verification must precede any processing");
});

test("stripe writes carry idempotency keys", async () => {
  const source = await readSource("netlify/functions/admin-quote-actions.mjs");
  const creates = source.match(/stripe\.(customers|invoices|invoiceItems|prices|paymentLinks)\.create\(/g) || [];
  const keys = source.match(/idempotencyKey:/g) || [];
  assert.ok(creates.length > 0);
  assert.ok(keys.length >= creates.length, "every Stripe create call needs an idempotency key");
});

test("no payment source file ever logs a secret-bearing object", async () => {
  const serverFiles = await collectFiles(path.join(root, "netlify"), [".mjs"]);
  for (const file of serverFiles) {
    const source = await readFile(file, "utf8");
    assert.ok(!/console\.log\([^)]*(secretKey|serviceRoleKey|webhookSecret|token)/i.test(source),
      `${file} must not log credentials`);
  }
});

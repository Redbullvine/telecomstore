# CLAUDE OGT Status

- Task: CLAUDE OGT 1 — Stripe, Payments, and Admin Orders
- Worktree: `C:\Users\redbu\Projects\telecomstore-ogt-claude-stripe`
- Branch: `ogt/claude-stripe`
- Starting main commit: `206b9002be79cfe4034bc6879d4842174e7d5e5d`
- BAINTU main commit integrated: `cfb20303882435dddc05c26633f2f66dd9cceeac` (merged into this branch)
- Last updated: 2026-08-05 (synchronized with BAINTU main; ready to merge)

## Completed

- Quote-to-payment system: migration `20260805120000_quote_to_payment.sql`
  (quote_requests/items, payments, status history, notes; RLS, anon revoked,
  transition trigger), quote submission + admin action functions, admin
  Payment Center (`/admin/payments`, wired via SHARED main.jsx commit),
  static payment success/cancel pages, `docs/PAYMENTS.md`.
- Payment-integration reconciliation with the opening-commerce Stripe stack
  that arrived in main via BAINTU's merge:
  - ONE unified `/api/stripe-webhook` (`stripe-webhook.mts`): shared
    signature verification, livemode/key-mode guard, durable stripe_events
    ledger + failed-event reopen; quote events dispatch to the quote core,
    direct-checkout sessions to the order workflow. Superseded quote-branch
    duplicates deleted (`stripe-webhook.mjs`, `create-checkout-session.mjs`).
  - Quote migration now builds on `20260803120000_stripe_order_tracking.sql`
    (no table collisions; shared `stripe_events`/`orders` untouched).
- Storefront, catalog, product data, styling: untouched (BAINTU-owned).

## Tests

- 190 tests: 179 pass, 0 fail, 11 skipped (pre-existing DB-gated suites).
  Includes cross-system webhook dispatch, ledger dedup/reopen, livemode
  mismatch, tamper rejection, migration boundaries, secret boundaries.
- Production build passes; `git diff --check` clean; bundle has no secret
  patterns. Lint/tsconfig: not configured in repo (N/A).

## Shared-file commits

- `SHARED: add stripe server dependency for payment functions` (superseded by
  main's identical stripe ^22.4.0 — merged cleanly)
- `SHARED: register admin Payment Center route and sidebar link` (main.jsx:
  icon import, route, sidebar entry, title — 5 lines)

## Remaining blockers (deployment configuration, not code)

- Netlify env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
  SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL (server) MISSING — all payment
  functions fail safe (503) until set. Presence audit only; no values seen.
- Stripe dashboard webhook endpoint must be created after deploy
  (events list in docs/PAYMENTS.md).
- Production migrations 20260803 + 20260805 to apply at release step.

## OGT 2 — COMPLETE (2026-08-05)

- Storefront quote form posts to `/api/quote-requests` (server-side SKU
  snapshot from the approved pricing bundle, full shipping address, shipping
  disclosure, reference code) with the Netlify Forms lead path as fallback.
- Quote expiration gates all payment vehicles; one-time Checkout Sessions
  (exact confirmed amount, client_reference_id, 24h expiry, idempotent +
  reused on repeated clicks); webhook verifies amount + currency before any
  paid transition; delayed payment methods handled; success page confirms
  server-side via `/api/checkout-status`.
- Migration 009 `quote_expiry_and_snapshot` applied to production (additive).
- BAINTU's Petra image publication (PR #3, `e3274778`) merged in; their
  migration `20260805213000_publish_petra_product_images.sql` is NOT yet
  applied to production — BAINTU's release step, untouched by Claude.
- Tests: 193 pass / 0 fail (11 pre-existing DB-gated skips). Build clean.
- Stripe remains fail-safe OFF pending Netlify env keys + Dashboard webhook
  (exact steps in docs/PAYMENTS.md).

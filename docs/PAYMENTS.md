# Telecom Store — Payments (Stripe quote-to-payment)

Built by CLAUDE OGT 1 on branch `ogt/claude-stripe`. This document is the
operating manual for the payment system: architecture, configuration,
integration steps, testing, and rollback.

## Payment model

Primary flow is **quote-to-payment** (works for the entire catalog):

1. Customer submits a quote request (`POST /api/quote-requests`) with contact
   info, shipping address, and `(product_id, quantity)` pairs.
2. Product titles/SKU/MPN/GTIN are snapshotted **server-side** from the curated
   catalog. Browser-supplied identity or pricing is never trusted.
3. Admin reviews in the **Payment Center**, enters unit prices, shipping, and
   tax; totals are validated in integer cents (`subtotal + shipping + tax =
   final total`), and the request becomes `quoted`.
4. Admin creates a **Stripe invoice** (emailed by Stripe) or a **secure
   payment link**. Status becomes `payment_sent`; an `orders` row and a
   `payments` row are recorded.
5. Customer pays on Stripe-hosted pages. No card data ever touches our site.
6. The **webhook** (`POST /api/stripe-webhook`) verifies the signature,
   dedupes by Stripe event id, and moves the request to `paid` (or records
   failure/refund) under guarded status transitions.
7. Admin sees live status, payment records, status history, and internal notes.

**Direct checkout** (`POST /api/checkout-session`) exists but is hard-gated:
it requires an explicit row in `product_checkout_approvals` AND resolvable
shipping+tax rules. The rules resolver intentionally returns `null` today, so
every direct-checkout attempt returns the quote fallback message. Do not
enable it by inventing shipping or assuming zero tax.

## Status flow

`new → reviewing → quoted → payment_sent → paid → fulfilled`
with `canceled` (reopenable to `reviewing`), `refunded` (terminal, from
`paid`/`fulfilled`), and `payment_sent → quoted` for re-pricing. Transitions
are enforced twice: in `netlify/lib/transitions.mjs` and by the DB trigger
`enforce_quote_status_transition()`. Webhooks may only set `paid`/`refunded`.

## Files

| Area | Path |
|---|---|
| Migration 007 | `supabase/migrations/20260805120000_quote_to_payment.sql` |
| Server libs | `netlify/lib/*.mjs` |
| Quote submission | `netlify/functions/submit-quote-request.mjs` → `/api/quote-requests` |
| Admin actions | `netlify/functions/admin-quote-actions.mjs` → `/api/admin/quotes/:id/:action` |
| Direct checkout (gated) | `netlify/functions/create-checkout-session.mjs` → `/api/checkout-session` |
| Webhook | `netlify/functions/stripe-webhook.mjs` → `/api/stripe-webhook` |
| Config audit | `netlify/functions/admin-payments-config.mjs` → `/api/admin/payments-config` |
| Success / cancel pages | `public/payment-success.html`, `public/payment-cancel.html` |
| Admin UI | `src/admin/PaymentCenter.jsx`, `src/admin/payments-api.mjs` |
| Tests | `tests/payment-*.test.mjs`, `tests/stripe-webhook.test.mjs` |

## Required environment variables (Netlify, names only)

| Name | Purpose | Status at build time |
|---|---|---|
| `STRIPE_SECRET_KEY` | server Stripe calls (`sk_test_`/`sk_live_`) | MISSING |
| `STRIPE_WEBHOOK_SECRET` | webhook signature verification (`whsec_`) | MISSING |
| `SUPABASE_SERVICE_ROLE_KEY` | server DB writes (bypasses RLS; server-only) | MISSING |
| `SUPABASE_URL` | server DB URL (falls back to `VITE_SUPABASE_URL`) | present via VITE fallback |
| `PAYMENT_SUCCESS_URL` / `PAYMENT_CANCEL_URL` | optional overrides; default `<site>/payment-success.html` / `<site>/payment-cancel.html` | optional |

`STRIPE_PUBLISHABLE_KEY` / `VITE_STRIPE_PUBLISHABLE_KEY` are **not required**
by this flow (all payment UIs are Stripe-hosted). Add them only when an
embedded checkout is built.

Secrets are never committed, never logged, and never returned by any endpoint.
`/api/admin/payments-config` reports presence/mode only.

## Deployment / integration checklist (run at OGT final integration)

1. BAINTU reports `SAFE FOR CLAUDE OGT 1 TO MERGE: YES`.
2. Fetch and merge latest `main` into `ogt/claude-stripe`; re-run tests + build.
3. Wire the Payment Center into the admin router in `src/main.jsx`
   (single `SHARED:` commit):
   - `import PaymentCenterPage from "./admin/PaymentCenter.jsx";`
   - route: `if (route.path === "/admin/payments") page = <PaymentCenterPage {...commonProps} />;`
   - sidebar: `<SidebarLink icon={<CreditCard size={18} />} label="Payments" to="/admin/payments" route={route} />`
   - title: add `"/admin/payments": "Payment Center"` to `adminTitle`'s map if applicable.
4. Merge to `main`, push, let Netlify deploy production normally.
5. Apply migration 007 to production Supabase (after backup; see rollback
   recipe at the bottom of the migration file).
6. Set env vars in Netlify (names above), redeploy so functions pick them up.
7. In Stripe dashboard: create webhook endpoint
   `https://telecomstore.net/api/stripe-webhook` with events:
   `checkout.session.completed`, `checkout.session.expired`, `invoice.paid`,
   `invoice.payment_failed`, `invoice.voided`, `invoice.marked_uncollectible`,
   `payment_intent.payment_failed`, `charge.refunded`. Put its signing secret
   in `STRIPE_WEBHOOK_SECRET`.
8. Test-mode validation first (test keys + Stripe test clocks/cards), then
   swap to live keys.
9. Live smoke test WITHOUT a real charge: submit a quote, price it, create an
   invoice, verify webhook receipt on a voided invoice.

## Rollback

- Code: revert the merge commit on `main`; Netlify redeploys the previous
  production deploy (or restore via the Netlify deploys UI).
- Database: reviewed down-migration in the ROLLBACK RECIPE section of
  migration 007 (drops only payment tables; touches nothing else).
- Stripe: disable the webhook endpoint; no other state to undo. Invoices or
  links already sent can be voided/deactivated from the Stripe dashboard.

## Security properties (tested)

- Webhook: signature required, event-id dedup (unique index), livemode/key
  mode must match, unknown event types recorded as ignored, failed events
  re-openable for Stripe retry, transitions guarded in app + DB.
- Quote submission: server-side product lookup, availability check, qty
  bounds (1–10 000), ≤50 items, email/phone/address validation, honeypot,
  per-email and per-IP rate limits, generic public errors.
- Admin actions: Supabase Bearer token → user → `profiles.approved` +
  `role='admin'` checked with the service client; browser can never set
  prices/status directly (RLS = SELECT only for admins; writes revoked).
- Stripe calls: deterministic idempotency keys (quote id + action + amount).
- Money: integer-cent arithmetic everywhere; `final = subtotal+shipping+tax`
  enforced in the function, the UI preview, and a DB check constraint.
- Return URLs: must be https on our own origin.
- No supplier identity, supplier SKU, cost, or margin exists anywhere in the
  payment schema or any customer-facing output.

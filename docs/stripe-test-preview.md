# Stripe test-mode preview — configuration & checklist

Status: **preparation only.** Nothing is deployed, no secrets exist in the
repository, and checkout remains disabled for every product until Danny
approves prices and shipping classes. This document configures a Netlify
**preview** context against **Stripe test mode** and a **disposable Supabase
project** — never production keys.

## Required environment variables (Netlify UI → Site settings → Environment)

Set these for the *Deploy Preview / branch* context only. Never commit values.

| Variable | Value source | Notes |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | Stripe dashboard → Developers → API keys → **test mode** (`sk_test_...`) | Server functions only; never exposed to the browser |
| `STRIPE_WEBHOOK_SECRET` | Stripe dashboard → Webhooks → the preview endpoint's signing secret (`whsec_...`) | Endpoint: `https://<preview-host>/api/stripe-webhook` |
| `PUBLIC_SITE_URL` | The preview URL (e.g. `https://deploy-preview-N--site.netlify.app`) | Used for success/cancel redirect URLs |
| `SUPABASE_URL` | The **test** Supabase project URL — never the production project | Order storage target |
| `SUPABASE_SERVICE_ROLE_KEY` | The **test** project's service-role key | Server functions only; RLS-bypassing; never in browser code |

The webhook function refuses requests with `503 Webhook is not configured`
if any variable is missing (names are logged, values never are).

Webhook events to subscribe the preview endpoint to:
`checkout.session.completed`, `checkout.session.async_payment_succeeded`,
`checkout.session.async_payment_failed`, `payment_intent.payment_failed`,
`charge.refunded`.

Before testing, apply migration `20260803120000_stripe_order_tracking.sql` to
the **test** Supabase project only (`supabase db push` against the disposable
project, or `supabase db reset` locally). Never to production without separate
authorization.

## Test-mode checklist

Use Stripe test cards (<https://docs.stripe.com/testing>). Verify each row and
record the result before any production consideration.

| # | Scenario | Steps | Expected |
| --- | --- | --- | --- |
| 1 | Successful payment | Card `4242 4242 4242 4242` | Redirect to `/checkout/success`; order row `payment_status=paid`; item rows priced from server bundle |
| 2 | Declined card | Card `4000 0000 0000 0002` | Stripe blocks completion; on `payment_intent.payment_failed`, any recorded order becomes `failed`; no paid order exists |
| 3 | Abandoned checkout | Start checkout, close the tab | No order row is created (no completed event); ledger may hold nothing for the session |
| 4 | Duplicate webhook | Stripe CLI: resend the same event id (`stripe events resend evt_...`) | Second delivery answers `{received, duplicate}`; still exactly one order |
| 5 | Refund | Refund the payment in the Stripe test dashboard | `charge.refunded` sets `refunded` (full) or `partially_refunded` (partial) |
| 6 | Tax calculation | Taxable product with automatic tax; US address | `amount_tax_cents` recorded and matches Stripe totals |
| 7 | Shipping charge | Product with a Stripe shipping rate | `amount_shipping_cents` recorded; total = subtotal + tax + shipping |
| 8 | Order recording | After #1, inspect `orders`/`order_items` in the test project | All Stripe IDs present (session, payment intent, customer, event); shipping address stored; fulfillment `unfulfilled` |
| 9 | Customer success page | Complete #1 | `/checkout/success` renders with the session reference |
| 10 | Cancellation page | Click back/cancel from Stripe | `/checkout/cancel` renders; no order created |

Also verify negative boundaries: quote-only SKUs are refused by
`create-checkout-session` (400), an invalid webhook signature returns 400,
and anonymous Supabase clients can read nothing from the order tables.

# Opening commerce runbook

## Catalog and pricing

The public catalog is generated from the approved review JSON, not the Petra CSV:

```powershell
node scripts/generate-opening-commerce-catalog.mjs --source "C:\path\to\opening-catalog-final-approved.json"
```

The generator excludes `PSG100`, `PSG200`, `PSG300`, `PSG400`, and `BHOC05`, asserts exactly 206 unique public SKUs, and writes only sanitized public fields. It also creates `operations/opening-pricing-template.csv`; this operational file contains no supplier cost or supplier identifier.

Complete the pricing template only after retail price, shipping, destination, and tax decisions are approved. Validate it with:

```powershell
node scripts/validate-opening-pricing.mjs --input operations/opening-pricing-template.csv
```

Use `--partial` only for a deliberate partial validation workflow. The validator will not activate checkout unless a positive price, explicit shipping class, allowed two-letter country codes, Stripe shipping-rate ID, taxable flag, and compatible automatic-tax flag are present. A product becomes purchasable only when the validated output sets `checkout_active: true` and `price_mode: fixed`. Otherwise the storefront remains quote-only.

## Stripe test mode and local checkout

Set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `PUBLIC_SITE_URL` in Netlify’s encrypted environment configuration or an ignored local environment file. They are server-only: never prefix them with `VITE_`, paste them into source, or commit them. Use test-mode values only.

Run the site through Netlify’s local development server so `/api/create-checkout-session` and `/api/stripe-webhook` resolve. Use the Stripe CLI in test mode to forward signed test webhooks to the local webhook URL, then complete a Stripe test-card checkout. Confirm the signed `checkout.session.completed` event is logged once with only event/session identifiers, public SKUs, total, currency, and payment status. The current idempotency set is process-local; durable order/event storage must be designed and approved before fulfillment automation.

## Deploy Preview verification

Create a Deploy Preview only after authorization to push/open a PR. Configure test-mode secrets in the preview context, verify the catalog count and exclusions, search/filter/details/quote/cart behavior, success and cancel pages, supported countries, the approved shipping rate, automatic-tax behavior, and a complete test-mode order. The success redirect alone is not proof of payment; only a valid signed webhook confirms completion.

## Live-payment gate

Before enabling any product, approve its retail price, shipping class, destination list, Stripe shipping rate, taxable status, and automatic-tax choice. Then validate the pricing file, review both generated pricing artifacts, run tests/build, and use a test-mode Deploy Preview.

Live mode additionally requires separate explicit authorization, live Stripe credentials stored by Netlify, registered live webhook endpoint/signing secret, durable idempotent order storage, fulfillment ownership, tax/legal review, shipping validation, refund/support procedures, monitoring, and a completed live-readiness review. This branch is not authorized for live payments.

## Rollback

Disable checkout by setting every pricing row to `checkout_active=false`, blanking its public price/configuration as appropriate, validating again, and deploying the reviewed rollback. Remove the checkout function route or revert the commerce commit if the entire feature must be withdrawn. Revoke or rotate Stripe secrets through Netlify if exposure is suspected; never commit a replacement. Existing quote workflows remain available.

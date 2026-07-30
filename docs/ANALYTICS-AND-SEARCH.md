# Analytics and Search Verification

## Google Analytics 4 setup

The repository and live homepage were audited before this integration. Neither contained a GA4 loader or measurement ID. The application now loads one GA4 property only when a valid public measurement ID is configured, and it disables GA's automatic initial page view so the SPA route tracker is the single page-view source.

Set these values in **Netlify > Site configuration > Environment variables** and redeploy:

```text
VITE_GA_MEASUREMENT_ID=G-XXXXXXXXXX
VITE_GA_DEBUG=false
```

For local work, copy `.env.example` to `.env.local` and set the same variables there. GA measurement IDs are public identifiers, not secrets. The loader ignores missing or malformed IDs and will not insert the same Google tag twice.

## Search Console verification

Choose the **HTML tag** verification method in Google Search Console. Copy only the value from the tag's `content` attribute into Netlify:

```text
VITE_GOOGLE_SITE_VERIFICATION=verification-token-from-search-console
```

After redeploying, view the homepage source and confirm a `google-site-verification` meta tag is in `<head>`, then click **Verify** in Search Console. The token is public verification material; no Google account credentials or API keys belong in the repository. DNS verification is also supported operationally and requires no code change.

## Event map

Every emitted event automatically includes `page_route`. Product events use `product_id`, `product_name`, and `category` when those fields are available. Contact values and form contents are not sent to GA.

| Event | Firing point |
| --- | --- |
| `page_view` | Initial render and every `pushState`/browser back-forward route change handled by `useRoute` |
| `site_search` | A non-empty storefront search is submitted; includes a redacted-safe `search_term`, category, and result count |
| `category_view` | The initial catalog finishes loading and whenever the selected category changes |
| `product_click` | The Details action on a catalog product card is clicked |
| `product_view` | The product details modal opens |
| `outbound_vendor_click` | Any external HTTP(S) link is clicked; includes the destination hostname or a future `data-vendor` label |
| `contact_click` | A configured `mailto:` or `tel:` link is used; sends the method and UI source, never the address or number. The current storefront exposes email links and has no outbound phone CTA. |
| `quote_request` | Netlify confirms successful submission of the quote-request form; failed/invalid submissions do not count |
| `checkout_start` | Available through `trackCheckoutStart()` for a future real checkout entry point. It is intentionally not emitted now because this application has no checkout. |
| `purchase` | Available through `trackConfirmedPurchase()`, which requires both `confirmed: true` and a transaction ID. It is intentionally not called because no confirmed-purchase callback exists in this quote-only application. |

The older lead-detail events already present in the storefront still fire through the same single GA transport for funnel diagnostics. `quote_request` is the conversion event to mark as a key event in GA4.

## Safe testing without duplicate production events

1. Use a separate GA4 test web stream and its measurement ID in `.env.local` or a Netlify deploy preview. Do not use the production ID for routine local testing.
2. Set `VITE_GA_DEBUG=true` only in that test environment and use GA4 DebugView.
3. In browser developer tools, filter Network requests for `google-analytics.com/g/collect`. One action should create one request for the named conversion event.
4. Confirm navigation emits one `page_view`. The GA config uses `send_page_view: false`, so a second automatic page view indicates another tag was added outside this repository (for example, Netlify snippet injection or Google Tag Manager).
5. Before production deployment, search the rendered page and Netlify settings for any separately injected `gtag.js` or GTM container. Keep a single owner for each measurement ID.

Automated tests verify one-time loader initialization, manual SPA page views, search-term contact-data redaction, purchase confirmation guards, scanner-path routing rules, and the SEO files.

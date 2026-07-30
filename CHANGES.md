# Telecom Store — storefront and lead workflow update

Updates the public storefront with an AllData-style retail layout, persistent quote list, Netlify lead forms, analytics hooks, and production routing/SEO support. The private inventory workflows and existing Supabase data wiring remain intact.

## Main areas changed
- `index.html` and `src/styles.css` — storefront presentation, fonts, favicon, and no-JavaScript forms fallback
- `src/main.jsx` — catalog interactions, persistent quote list, lead forms, and analytics event calls
- `src/config/contact.js` — centralized public contact configuration with outbound phone disabled until a number is confirmed
- `src/lib/analytics.mjs` — guarded GA4 initialization and event helpers
- `public/`, `netlify.toml`, and `netlify/edge-functions/` — forms, SEO files, real 404 behavior, and scanner-path handling
- `tests/` and `docs/ANALYTICS-AND-SEARCH.md` — automated coverage and operating instructions

## What changed in the UI
- Utility bar + trust badges, large part-number search header, sticky dark category nav with live counts
- Industrial hero, 4-up trust strip, retail product cards (brand + part no. + condition + qty)
- Product detail modal with quantity stepper
- Multi-item quote drawer that persists locally and submits the `quote-request` Netlify form
- Item inquiry, sell-equipment, and buyer-list lead forms with static fallbacks

## Product data behavior
`fetchPublicProducts()` still returns only products with `status = 'available'`. Categories present in that result power the storefront navigation. If Supabase is not configured, the existing local product fallback remains available.

Verification commands:

```text
npm test
npm run build
```

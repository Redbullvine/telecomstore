# Storefront catalog validation

| Check | Result |
| --- | ---: |
| Public products | 206 |
| Unique public SKUs | 206 |
| Unique GTINs | 206 |
| Unique product slugs | 206 |
| Categories | 7 |
| Manufacturers | 26 |
| Approved fixed-price records | 8 |
| Request-quote records | 198 |
| Checkout-enabled records | 0 |
| Sitemap URLs | 240 |
| Validation errors | 0 |

The public catalog contains only public product identity and approved storefront content. It contains no supplier SKU, supplier cost, MAP, MSRP, margin, raw supplier description, or source-row fields. Product, category, and manufacturer URLs are represented in the sitemap and mapped to the SPA shell by Netlify.

## Browser QA

Local-only browser checks used the sanitized bundled catalog with Supabase variables blank. The desktop home rendered 206 cards, 206 placeholders, eight approved-price notices, and no console errors. Dedicated product SEO emitted Organization, Product, and BreadcrumbList schemas. The Telecom Tools category rendered nine products; the Ideal manufacturer page rendered 17. Exact-GTIN search returned the correct single product and reset restored 206. Product and quote-list inquiry paths preserved title, MPN, GTIN, quantity, and product-page URL while requiring name, valid email, phone, quantity, and message. At a 390-pixel viewport, home and product detail pages had no horizontal page overflow; category navigation remained horizontally scrollable and readable.

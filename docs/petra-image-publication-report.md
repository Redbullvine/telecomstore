# Petra product image publication audit

Generated: 2026-08-05T21:53:19.737Z

Petra authorized Telecom Store to display product image URLs supplied in its CSV. The private source CSV and supplier identifiers remain untracked. Public image URLs use the S3 regional HTTPS form required for secure storefront delivery.

| Measure | Count |
| --- | ---: |
| Approved catalog products | 206 |
| Products matched to Petra rows | 206 |
| Supplier-SKU matches | 43 |
| Exact MPN matches | 163 |
| GTIN fallback matches | 0 |
| Primary images published | 206 |
| Alternate images | 0 |
| Placeholder-only products | 0 |
| Invalid image URLs | 0 |
| Unmatched CSV rows outside the opening catalog | 2360 |
| Ambiguous matches | 0 |
| Duplicate URL groups | 0 |
| Restricted products skipped | 0 |
| Rights set to approved | 206 |
| Supplier-image publication enabled | 206 |

The prior byte-level audit found one duplicate-content group (MHX-LHDME2 and MHX-LHDME4) even though their source URLs differ. Both remain traceable to separate exact Petra MPN rows and are included under the new blanket Petra authorization.

Duplicate URL groups: none.

## Reversible restrictions

The protected database restriction table can suppress supplier images immediately by product, brand/manufacturer, or supplier SKU without deleting product or catalog data. Anonymous users receive no table privileges. The storefront RPC exposes only the selected approved URL and never returns a supplier SKU or supplier table field.

## Validation evidence

- All 206 normalized HTTPS image URLs returned a valid image response during the publication audit.
- A clean disposable Supabase rebuild applied every migration in order, including the Petra image migration.
- With 206 fake local products, the migration created 206 approved, publishable primary image rows and the anonymous RPC returned 206 products with 206 photos.
- Anonymous roles had no direct `products`, `product_images`, or `product_image_restrictions` read privilege; anonymous RPC execution remained enabled.
- Local product, brand, and supplier-SKU restrictions suppressed 1, 7, and 1 photos respectively without removing any product rows.
- Desktop storefront QA loaded twelve 600×600 samples across Antennas Direct and APC; five detail pages across five manufacturers loaded the correct 600×600 photo.
- Mobile QA at 390×844 had no horizontal overflow and loaded the same responsive, contained product imagery.
- The graceful placeholder was exercised locally with two temporarily restricted products. Both rendered `Image pending` instead of a broken image; no restriction remained afterward.

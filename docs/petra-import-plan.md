# Petra product import plan (design only — not executed)

Status: **planning artifact**. Nothing here has been run. No production database,
migration, Supabase policy, or deployment is touched by this document or by
`scripts/prepare-petra-catalog.mjs`. The preparation script is a dry run that
only reads a local CSV and writes review files under `tmp/catalog-prep/`.

This plan describes the eventual transactional loader that would run **after**
the dry-run output has been human-reviewed and after BAINTU's security
migration work is complete and merged. It maps directly onto the tables created
in `supabase/migrations/20260801140000_supplier_catalog_architecture.sql`.

## Vocabulary boundaries (must never blur)

| Concept | Column | Visibility |
| --- | --- | --- |
| Telecom Store public SKU | `products.sku` | public (RPC) |
| Manufacturer part number | `products.manufacturer_mpn` | public (RPC) |
| Petra supplier SKU | `supplier_products.supplier_sku` | private (RLS) |
| GTIN/UPC/EAN | `products.gtin` (validated) | public (RPC) |
| Supplier wholesale cost (Petra `PRICE`) | `supplier_product_snapshots.supplier_cost` | admin-only |
| MAP / MSRP | `supplier_product_snapshots.map_price` / `.msrp` | admin-only |
| Supplier inventory (`AVAILABLE`) | `supplier_products.supplier_quantity` | private (RLS) |
| Public availability | derived in `get_public_product_catalog()` | public |
| Raw supplier title/description | `supplier_products.supplier_*` | private |
| Curated storefront title/description | `products.title` / `.long_description` | public |
| Supplier image URL | `supplier_products.supplier_image_url` | private |
| Publishable Telecom Store image | `product_images` (`publishable`, `rights_status`) | public when approved |

The public projection is `public.get_public_product_catalog()`. It must never
gain a supplier, cost, raw-quantity, location, or internal-note column.

## Transactional workflow (future `import-petra-catalog.mjs`, service-role)

Run inside a single DB transaction with an explicit `--dry-run` mode that rolls
back at the end. Order:

1. **Resolve supplier.** `insert ... on conflict (lower(code)) do update` on
   `public.suppliers` for `code = 'petra'`. Return `supplier_id`.
2. **Record the catalog run.** Insert `public.supplier_catalog_runs` with
   `source_filename`, `source_sha256` (hash of the local file), `encoding`,
   `source_row_count`, `schema_version`, `status = 'received'`. Keep the source
   file itself local/private — only metadata is stored.
3. **Upsert supplier-controlled records.** For each validated row,
   `insert ... on conflict (supplier_id, supplier_sku) do update` into
   `public.supplier_products` (raw title/desc/category, quantity, availability,
   discontinued/refurbished flags, supplier image URL, dimensions, warranty,
   origin). No cost here — commercial terms go to the snapshot only.
4. **Preserve the private snapshot.** Insert one
   `public.supplier_product_snapshots` row per record for this run, carrying
   `supplier_cost`, `map_price`, `msrp`, `returnable`, `po_eta_date`, and the
   full `raw_payload` JSON. This is the admin-only source of truth for history.
5. **Match or create curated products — only after review.** Do **not**
   auto-create `public.products`. For an approved candidate, either link to an
   existing product (by reviewed GTIN or brand+MPN) or create a curated product
   with a Telecom-Store-assigned `sku` (proposed = manufacturer MPN, per the
   live-catalog convention; never the Petra SKU). Set `status <> 'available'`
   so it stays unpublished.
6. **Link product ↔ supplier.** Insert `public.product_supplier_offers`
   (`product_id`, `supplier_product_id`, `preferred_supplier`, `active`,
   `sourcing_priority`, `handling_days`). One preferred active offer per product.
7. **Store warehouse quantities separately.** Any Telecom-Store-owned stock goes
   to `public.inventory_levels` per `storage_location`. Supplier quantity is
   never copied into warehouse inventory.
8. **Add publishable images.** Insert `public.product_images` with
   `source_type = 'supplier'`, `source_url = supplier image`,
   `rights_status = 'unknown'`, `publishable = false`. A row can become
   `publishable = true` only after `rights_status = 'approved'` (enforced by
   `product_images_publishable_rights_check`) and after the image is copied to
   Telecom-Store-controlled storage.
9. **Keep cost and raw inventory out of the public RPC.** No change to
   `get_public_product_catalog()`.
10. **No auto-publish.** Import leaves every new product unpublished.
11. **Explicit approval to publish.** A product appears publicly only when an
    admin sets `status = 'available'` (and, for price, `products.price` set or
    left null for "Request quote").
12. **Dry-run + rollback.** `--dry-run` wraps everything in `begin; ... rollback;`
    and prints the counts it *would* apply.
13. **Counts.** Emit `accepted`, `rejected`, `skipped`, `updated`, `duplicate`.

## Preconditions before any real import

- BAINTU's security migration merged; migrations 004/005 applied; migration 006
  (revoke anon SELECT) applied and the RPC-only storefront verified.
- Image-rights decision for Petra supplier imagery (all 50 opening candidates
  currently `rights_review_required`).
- Human review of `tmp/catalog-prep/opening-catalog.csv` (titles, categories,
  prices) and sign-off on the Telecom-Store SKU rule.
- Petra supplier record and `storage_location` rows exist.

## What this plan explicitly does NOT do

No `supabase db push`, no `apply_migration`, no `execute_sql`, no production
writes, no Netlify deploy, no Git push/merge. Those remain separate, reviewed,
human-triggered steps.

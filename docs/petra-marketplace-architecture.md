# Marketplace supplier architecture checkpoint

This document describes the approved implementation boundary. The migration and importer have been exercised only in a disposable local Supabase database. Nothing has been applied to production and no product has been published.

## Existing supplier-neutral foundation

| Required role | Existing structure | Dry-run use |
| --- | --- | --- |
| Canonical products | `public.products` | Stable public identity and URL; never deleted because one supplier stops carrying an item |
| Supplier products | `public.supplier_products` | Supplier SKU, exact manufacturer MPN, validated GTIN, descriptive fields, inventory flags, and supplier image reference |
| Supplier inventory | `public.supplier_products` plus `public.supplier_product_snapshots` | Current supplier availability plus immutable per-refresh observations |
| Supplier prices | `public.supplier_product_snapshots` | Private supplier cost, MAP, MSRP, and raw refresh evidence |
| Supplier images | `supplier_products.supplier_image_url` plus controlled `public.product_images` | Private source reference separated from approved public image publication |
| Catalog refresh runs | `public.supplier_catalog_runs` | Source hash, snapshot time, row counts, validation state, and refresh audit trail |
| Multi-supplier offers | `public.product_supplier_offers` | Links any number of supplier listings to one canonical product |
| Owned inventory | `public.inventory_levels` | Telecom Store inventory remains distinct from supplier availability |

These private supplier tables already use row-level security and are not part of the anonymous storefront catalog RPC.

## Additive review and publication structures

Migration `20260806120000_supplier_marketplace_review.sql` adds:

- `marketplace_departments`: the eight stable public department identities.
- `supplier_restrictions`: private source evidence, restriction type, effective state, reviewer, and resolution.
- `supplier_product_quarantine`: private identity-conflict evidence and resolution state.
- `pricing_reviews`: private calculation inputs, candidate price, review status, reviewer, and approval state.
- `marketplace_publications`: an explicit, default-deny publication record connecting a reviewed supplier listing to a canonical public product.

The new private tables have RLS enabled and anonymous privileges revoked. The security-definer `get_public_marketplace_catalog(text)` RPC returns a strict public allowlist and only approved publication rows that continue to satisfy inventory, restriction, quarantine, clearance, pricing, and image gates.

## Matching and publication boundary

1. Upsert the private supplier listing by supplier plus supplier SKU.
2. Match a canonical product only by an exact normalized manufacturer/MPN identity. GTIN fallback is permitted only for a future source whose identifier fidelity is independently verified.
3. Never match by title.
4. Quarantine contradictory identities and malformed GTINs for review.
5. Create or change public catalog records only in a separately approved publication step. The private importer never writes canonical products, offers, publications, public prices, or public images.

The August 5 workbook contains only 104 values that happen to pass checksum validation, while 2,483 are invalid or missing. Because the export exhibits widespread numeric truncation/rounding, GTIN fallback matching is disabled for the entire snapshot—including those 104 values. Values must not be reconstructed. This does not prevent the private supplier-row import, because supplier SKU remains the supplier-layer key, but it eliminates GTIN fallback until better source data is obtained.

## Repeatable private refresh

The dry-run command reads a workbook outside the repository and writes complete transformed records only below ignored `tmp/`:

```powershell
node scripts/prepare-petra-marketplace.mjs --source "C:\path\outside\repo\prodlist.xlsx" --prior "C:\path\outside\repo\prior.csv" --output "tmp\petra-marketplace-dry-run" --report "docs\petra-marketplace-dry-run-report.md"
```

The tracked report contains aggregate counts only. The workbook, supplier SKUs, supplier costs, MAP/MSRP values, private notes, raw rows, restriction evidence, and margin calculations remain outside tracked/public artifacts.

After the private plan is generated, its validation-only command is:

```powershell
node scripts/import-petra-marketplace.mjs --dry-run
```

The importer has no production mode. `--apply-local` accepts only a guarded loopback PostgreSQL connection and was validated with clean rebuild, idempotency, and forced-rollback tests. The `/shop` client reads only the sanitized marketplace RPC and has no private-plan or static-catalog fallback. Until individual publication approvals exist, it deliberately returns zero products and uses `noindex` metadata.

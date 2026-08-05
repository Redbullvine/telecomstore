# Guarded production import gate (prepared — NOT authorized)

Status: **capability prepared, execution forbidden.** Nothing in this branch
authorizes a production import. `scripts/import-petra-production.mjs` refuses
to act unless every safeguard below passes, and the one-time confirmation file
does not exist and must not be created until Danny explicitly authorizes a run.

## Why a separate wrapper

`scripts/import-petra-catalog.mjs` (the local importer) structurally cannot
name a production mode — its mode set is `{dry-run, apply-local}` and a test
pins `apply-production` out of it. Production capability exists only behind
`import-petra-production.mjs`, whose every gate is pure and unit-tested in
`tests/production-gate.test.mjs` with an injected fake DB client, so `npm test`
never opens any connection.

## Authorization safeguards (all required)

| # | Gate | Failure stage |
|---|------|---------------|
| 1 | `--apply-production` (or `--dry-run`) given explicitly; no default action | `mode` |
| 2 | `TELECOMSTORE_PRODUCTION_IMPORT=AUTHORIZE_REVIEWED_TELECOM_CATALOG` exactly | `authorization` |
| 3 | `--project-ref` exactly equals the expected production project reference | `authorization` |
| 4 | every record `opening_approved === true` | `source_validation` |
| 5 | every record `price_mode=request_quote`, `public_price=null`, `publish_supplier_image=false`, `image_rights_status=pending` | `source_validation` |
| 6 | deep scan: no cost/MAP/MSRP/credential/JWT key or value; supplier SKU/quantity/image fields only under `_private*` | `source_validation` |
| 7 | DB host must be exactly `db.<ref>.supabase.co` for the authorized ref | `db_host` |
| 8 | `--apply-production` refuses in CI (`CI`/`GITHUB_ACTIONS`) | `ci_guard` |
| 9 | snapshot dir required for apply and must be OUTSIDE the repository | `snapshot_dir` |
| 10 | complete read-only dry-run (snapshot + reconciliation plan) always precedes any write | flow |
| 11 | any SKU-identity or GTIN-ownership conflict stops the run before `BEGIN` | `identity_conflicts` |
| 12 | typed confirmation `IMPORT REVIEWED TELECOM CATALOG` immediately before `BEGIN` — interactive prompt, or (non-interactive) a one-time confirmation file with exactly that phrase. Neither is satisfied by anything in this repository. | `confirmation` |

## Existing-product protection

`planReconciliation()` compares each source record against every existing
production product:

- **GTIN owned by a different SKU** → conflict, import stops.
- **Same public SKU but different manufacturer MPN or GTIN** → conflict, stops.
- **Same SKU with matching identity** → safe reconcile: `unchanged` when all
  curated fields already match (idempotent rerun), `safe_update` otherwise.
- **Existing products absent from the source** (including the live 3M copper
  splicing products) are never touched by any statement.

## Transaction behavior

The apply phase is a single `BEGIN … COMMIT`. Any error triggers `ROLLBACK`,
a nonzero exit, and a redacted `failed stage` report. Reruns are idempotent
(plan-driven upserts; second run reports the whole set as `unchanged`).
Zero `public.product_images` rows are inserted; supplier image URLs live only
in private supplier tables; supplier cost/MAP/MSRP do not exist in the source
(gate 6) and are never written. Logs pass through `redact()` which masks
connection strings, JWTs, and cost-like key values.

## Preflight snapshot (read-only, preserved outside the repo)

Captured before any write and written to `--snapshot-dir` (must be outside the
repository): migration ledger count, `products` count and the full public
field rows of existing products (the live four), `suppliers`,
`supplier_products`, `product_supplier_offers`, `inventory_levels`,
`product_images` counts, and the anonymous RPC row count. Schema/policy
fingerprints: capture `supabase migration list` output and
`pg_policies`/`information_schema.columns` digests in the same snapshot file
during the authorized run.

## Post-import verification (the future authorized run must confirm)

1. `products` count = preflight count + planned inserts.
2. The four pre-existing live products' rows are byte-identical to snapshot.
3. Every imported product: `status='available'`, `price IS NULL`,
   RPC `public_availability='quote_only'`, note `Request quote`.
4. `product_images` count unchanged (zero Petra images published).
5. Anonymous RPC succeeds; anonymous direct `products` SELECT still denied.
6. RPC projection contains no supplier cost / supplier SKU / supplier
   quantity / private image URL columns.
7. Live-site smoke test: quote controls, search, and category filters include
   the imported products.
8. On any check failure: restore path is the snapshot + the transactional
   nature of the import (a failed run rolled back; a bad committed run is
   reverted by deleting the catalog run's linked rows in a reviewed,
   separately authorized transaction).

## What this branch does NOT do

No production connection was opened. No import executed. No confirmation file
created. No push, merge, or deploy.

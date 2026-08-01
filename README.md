# Telecom Store Inventory App

Telecom Store is a quote-request public storefront plus a private warehouse inventory management system for telecom material.

## Quick Start

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

Analytics, Search Console verification, event locations, and safe test instructions are documented in [`docs/ANALYTICS-AND-SEARCH.md`](docs/ANALYTICS-AND-SEARCH.md).

Netlify build settings:

```text
Build command: npm run build
Publish directory: dist
```

## Public Storefront

Route: `/`

Customers can browse products where `status = available`, search by SKU, barcode, brand, title, category, description, and request a quote. There is no checkout yet.

If Supabase is not configured, the public storefront falls back to `src/data/products.json`.

## Admin App

Routes:

```text
/login
/admin
/admin/inventory
/admin/inventory/new
/admin/inventory/:id/edit
/admin/scan
/admin/import
/admin/categories
/admin/locations
/admin/activity
```

Admin features include inventory counts, status workflows, item add/edit, duplicate item, scan item, bulk import, categories, storage locations, photo upload, activity log, archive, and admin-only hard delete.

## Supabase Setup

1. Create a Supabase project.
2. Run the SQL migrations in order:

```text
supabase/migrations/20260703191104_photo_intake.sql
supabase/migrations/20260703204304_fix_delete_activity_trigger.sql
supabase/migrations/20260801140000_supplier_catalog_architecture.sql
supabase/migrations/20260801140500_public_product_catalog_rpc.sql
```

3. Add environment variables locally and in Netlify:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

Use `.env.example` as the template. Do not commit real secrets.

4. Confirm the `product-images` storage bucket exists. The migration creates it and adds policies.

## Approve Users

Users can request access from `/login`.

To approve a user, open Supabase Table Editor and update the user's row in `profiles`:

```text
approved = true
role = admin
```

or:

```text
approved = true
role = inventory
```

Roles:

```text
admin      full inventory access plus hard delete
inventory  add/edit/import/scan/status/photo access
viewer     no admin app access
```

## Add Item Manually

1. Log in as an approved `admin` or `inventory` user.
2. Go to `/admin/inventory/new`.
3. Enter SKU, barcode, brand, title, category, quantity, location, descriptions, status, and photos.
4. Use `Save draft` for internal work or `Publish available` to show it publicly.

## Scan Page

Route: `/admin/scan`

Supported flows:

- USB barcode scanner: focus stays in the scan input; scanner types and presses Enter.
- Bluetooth barcode scanner: same as USB scanner.
- Manual entry: type SKU/barcode and press Enter.
- Camera scan: uses the browser `BarcodeDetector` API when available, otherwise `@zxing/browser`.

Scan behavior:

1. Scan or enter SKU/barcode.
2. App searches existing products by SKU or barcode.
3. If found, it opens the existing edit screen with a duplicate warning.
4. If not found, it creates a draft item and opens edit so photos/details can be finished.

## Spreadsheet Import

Route: `/admin/import`

Supported files:

```text
CSV via papaparse
XLSX/XLS via xlsx
```

Workflow:

1. Upload a CSV/XLSX/XLS file.
2. Preview rows.
3. Map columns to product fields.
4. Validate required `title` and either `sku` or `barcode`.
5. Detect duplicates by SKU/barcode.
6. Choose duplicate handling:
   - skip duplicates
   - update existing
   - create new drafts
7. Import rows. Rows default to `draft` unless the status column says `available`.

Expected import columns:

```text
sku
barcode
brand
title
category
condition
quantity_available
unit
price
price_note
warehouse_location
aisle
rack
shelf
pallet
short_description
long_description
status
photo_main
photo_label
photo_extra_1
photo_extra_2
```

## Publish, Hold, Sell, Archive, Delete

From `/admin/inventory`:

- `Available` publishes an item publicly.
- `Hold` keeps it internal and reserved.
- `Sold` keeps it internal and sold.
- `Archive` keeps history without public display.
- Hard delete is visible only to `admin` role and requires confirmation.

Prefer archive/status changes over hard delete.

## Product Photos

Admin users upload photos to Supabase Storage bucket:

```text
product-images
```

Fields:

```text
photo_main
photo_label
photo_extra_1
photo_extra_2
```

The public storefront uses `photo_main` first. If no photo exists, it shows a clean SKU/brand placeholder.

## Inventory Intake Docs

Use:

```text
docs/inventory-intake-template.csv
docs/PHOTO-NAMING-GUIDE.md
docs/WAREHOUSE-PHOTO-CHECKLIST.txt
```

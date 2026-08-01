-- ============================================================================
-- Migration 004: supplier-aware catalog architecture
--
-- This migration is additive and does not import supplier data, publish
-- products, set retail prices, or change storefront queries.
-- ============================================================================

begin;

-- --------------------------------------------------------------------------
-- 1. Curated Telecom Store product fields
-- --------------------------------------------------------------------------
-- products.sku remains the Telecom Store-controlled internal/public SKU.
-- It must never be populated automatically from a supplier SKU.
--
-- Existing compatibility columns remain in place:
--   barcode              legacy barcode field; use gtin for validated GTINs
--   price                curated Telecom Store retail/quote price
--   quantity_available   legacy storefront/admin compatibility cache
--   category             legacy category text
--   photo_*              legacy storefront image slots
--
-- A later migration may make products.sku unique/not-null after existing data
-- has been audited and Telecom Store's SKU-generation rule has been approved.

alter table public.products
  add column if not exists slug text,
  add column if not exists manufacturer_mpn text,
  add column if not exists gtin text,
  add column if not exists category_id uuid references public.categories(id) on delete set null,
  add column if not exists specifications jsonb not null default '{}'::jsonb,
  add column if not exists currency_code text not null default 'USD',
  add column if not exists meta_title text,
  add column if not exists meta_description text,
  add column if not exists search_keywords text[] not null default '{}'::text[],
  add column if not exists google_product_category text,
  add column if not exists canonical_url_override text,
  add column if not exists published_at timestamptz;

alter table public.products
  drop constraint if exists products_slug_format_check,
  add constraint products_slug_format_check
    check (slug is null or slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  drop constraint if exists products_gtin_format_check,
  add constraint products_gtin_format_check
    check (gtin is null or gtin ~ '^([0-9]{8}|[0-9]{12}|[0-9]{13}|[0-9]{14})$'),
  drop constraint if exists products_currency_code_check,
  add constraint products_currency_code_check
    check (currency_code ~ '^[A-Z]{3}$'),
  drop constraint if exists products_specifications_object_check,
  add constraint products_specifications_object_check
    check (jsonb_typeof(specifications) = 'object');

create unique index if not exists products_slug_unique_idx
  on public.products (lower(slug))
  where slug is not null and btrim(slug) <> '';

-- GTIN is a reviewed matching signal, not a canonical merge key. Keep this
-- non-unique until legacy duplicates, variants, bundles, and review records
-- have been modeled and audited.
create index if not exists products_gtin_lookup_idx
  on public.products (gtin)
  where gtin is not null and btrim(gtin) <> '';

create index if not exists products_brand_mpn_idx
  on public.products (lower(brand), lower(manufacturer_mpn))
  where manufacturer_mpn is not null and btrim(manufacturer_mpn) <> '';

create index if not exists products_category_id_idx
  on public.products (category_id);

comment on column public.products.sku is
  'Telecom Store-controlled internal/public SKU. Never a supplier SKU by default.';
comment on column public.products.manufacturer_mpn is
  'Curated manufacturer part number; distinct from supplier SKU and Telecom Store SKU.';
comment on column public.products.gtin is
  'Curated, validated GTIN/UPC/EAN for the canonical product.';
comment on column public.products.price is
  'Telecom Store-controlled retail or quote price. Never supplier wholesale cost.';
comment on column public.products.quantity_available is
  'Legacy compatibility field. Do not populate directly from supplier inventory.';

-- --------------------------------------------------------------------------
-- 2. Curated category support
-- --------------------------------------------------------------------------

alter table public.categories
  add column if not exists slug text,
  add column if not exists description text,
  add column if not exists active boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

alter table public.categories
  drop constraint if exists categories_slug_format_check,
  add constraint categories_slug_format_check
    check (slug is null or slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$');

create unique index if not exists categories_slug_unique_idx
  on public.categories (lower(slug))
  where slug is not null and btrim(slug) <> '';

drop trigger if exists set_categories_updated_at on public.categories;
create trigger set_categories_updated_at
before update on public.categories
for each row execute function public.set_updated_at();

-- --------------------------------------------------------------------------
-- 3. Suppliers
-- --------------------------------------------------------------------------

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  active boolean not null default true,
  inventory_freshness_hours integer not null default 24
    check (inventory_freshness_hours > 0),
  default_handling_days integer
    check (default_handling_days is null or default_handling_days >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint suppliers_name_not_blank_check
    check (btrim(name) <> ''),
  constraint suppliers_code_format_check
    check (code ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create unique index if not exists suppliers_code_unique_idx
  on public.suppliers (lower(code));

drop trigger if exists set_suppliers_updated_at on public.suppliers;
create trigger set_suppliers_updated_at
before update on public.suppliers
for each row execute function public.set_updated_at();

-- --------------------------------------------------------------------------
-- 4. Catalog run metadata
-- --------------------------------------------------------------------------
-- The source file itself remains local/private. This table stores only run
-- metadata needed for idempotency, lineage, validation, and auditability.

create table if not exists public.supplier_catalog_runs (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  source_filename text not null,
  source_sha256 text not null,
  supplier_exported_at timestamptz,
  encoding text not null,
  source_row_count integer not null check (source_row_count >= 0),
  accepted_row_count integer check (accepted_row_count is null or accepted_row_count >= 0),
  rejected_row_count integer check (rejected_row_count is null or rejected_row_count >= 0),
  schema_version text not null,
  status text not null default 'received'
    check (status in ('received', 'validated', 'loaded', 'rejected', 'failed')),
  validation_summary jsonb not null default '{}'::jsonb,
  notes text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_catalog_runs_text_fields_check
    check (
      btrim(source_filename) <> ''
      and btrim(encoding) <> ''
      and btrim(schema_version) <> ''
    ),
  constraint supplier_catalog_runs_sha256_check
    check (source_sha256 ~ '^[0-9a-fA-F]{64}$'),
  constraint supplier_catalog_runs_validation_object_check
    check (jsonb_typeof(validation_summary) = 'object'),
  constraint supplier_catalog_runs_completed_check
    check (completed_at is null or completed_at >= started_at),
  constraint supplier_catalog_runs_row_counts_check
    check (
      accepted_row_count is null
      or rejected_row_count is null
      or accepted_row_count + rejected_row_count <= source_row_count
    ),
  unique (id, supplier_id)
);

create index if not exists supplier_catalog_runs_supplier_created_idx
  on public.supplier_catalog_runs (supplier_id, created_at desc);

create index if not exists supplier_catalog_runs_status_idx
  on public.supplier_catalog_runs (status, created_at desc);

create index if not exists supplier_catalog_runs_source_hash_idx
  on public.supplier_catalog_runs (supplier_id, source_sha256, created_at desc);

drop trigger if exists set_supplier_catalog_runs_updated_at
  on public.supplier_catalog_runs;
create trigger set_supplier_catalog_runs_updated_at
before update on public.supplier_catalog_runs
for each row execute function public.set_updated_at();

-- --------------------------------------------------------------------------
-- 5. Supplier-controlled product records
-- --------------------------------------------------------------------------
-- These records are never public products. Supplier refreshes may update them.
-- Current quantity/availability fields are caches of the latest accepted run.
-- Wholesale cost, MAP, MSRP, and raw payload remain in the admin-only snapshot
-- table below so accidental broader access to supplier_products cannot expose
-- commercial terms.

create table if not exists public.supplier_products (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  supplier_sku text not null,
  manufacturer_mpn text,
  gtin text,
  brand text,
  supplier_title text,
  supplier_description text,
  supplier_specs text,
  supplier_category text,
  supplier_subcategory text,
  supplier_subcategory_2 text,
  supplier_subcategory_3 text,
  supplier_quantity numeric not null default 0 check (supplier_quantity >= 0),
  supplier_available boolean not null default false,
  discontinued boolean not null default false,
  refurbished boolean not null default false,
  supplier_image_url text,
  unpacked_weight numeric check (unpacked_weight is null or unpacked_weight >= 0),
  shipping_weight numeric check (shipping_weight is null or shipping_weight >= 0),
  weight_unit text,
  length numeric check (length is null or length >= 0),
  width numeric check (width is null or width >= 0),
  height numeric check (height is null or height >= 0),
  dimension_unit text,
  warranty text,
  country_of_origin text,
  current_catalog_run_id uuid,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  source_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_products_seen_check
    check (last_seen_at >= first_seen_at),
  constraint supplier_products_supplier_sku_not_blank_check
    check (btrim(supplier_sku) <> ''),
  constraint supplier_products_gtin_format_check
    check (gtin is null or gtin ~ '^([0-9]{8}|[0-9]{12}|[0-9]{13}|[0-9]{14})$'),
  constraint supplier_products_source_hash_check
    check (source_hash is null or source_hash ~ '^[0-9a-fA-F]{64}$'),
  unique (supplier_id, supplier_sku),
  unique (id, supplier_id),
  foreign key (current_catalog_run_id, supplier_id)
    references public.supplier_catalog_runs(id, supplier_id)
    on delete restrict
);

create index if not exists supplier_products_gtin_idx
  on public.supplier_products (gtin)
  where gtin is not null and btrim(gtin) <> '';

create index if not exists supplier_products_mpn_idx
  on public.supplier_products (lower(manufacturer_mpn))
  where manufacturer_mpn is not null and btrim(manufacturer_mpn) <> '';

create index if not exists supplier_products_brand_idx
  on public.supplier_products (lower(brand))
  where brand is not null and btrim(brand) <> '';

create index if not exists supplier_products_current_availability_idx
  on public.supplier_products (supplier_id, discontinued, supplier_available, supplier_quantity);

create index if not exists supplier_products_last_seen_idx
  on public.supplier_products (supplier_id, last_seen_at desc);

drop trigger if exists set_supplier_products_updated_at on public.supplier_products;
create trigger set_supplier_products_updated_at
before update on public.supplier_products
for each row execute function public.set_updated_at();

-- --------------------------------------------------------------------------
-- 6. Private per-run supplier snapshots
-- --------------------------------------------------------------------------
-- This is the source-of-truth history for supplier commercial terms and raw
-- records. Anonymous and ordinary authenticated users receive no access.

create table if not exists public.supplier_product_snapshots (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null,
  catalog_run_id uuid not null,
  supplier_product_id uuid not null,
  source_row_number integer check (source_row_number is null or source_row_number > 0),
  supplier_cost numeric check (supplier_cost is null or supplier_cost >= 0),
  map_price numeric check (map_price is null or map_price >= 0),
  msrp numeric check (msrp is null or msrp >= 0),
  currency_code text not null default 'USD'
    check (currency_code ~ '^[A-Z]{3}$'),
  supplier_quantity numeric not null default 0 check (supplier_quantity >= 0),
  supplier_available boolean not null default false,
  discontinued boolean not null default false,
  refurbished boolean not null default false,
  returnable boolean,
  po_eta_date date,
  source_hash text,
  raw_payload jsonb not null,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint supplier_product_snapshots_raw_object_check
    check (jsonb_typeof(raw_payload) = 'object'),
  constraint supplier_product_snapshots_source_hash_check
    check (source_hash is null or source_hash ~ '^[0-9a-fA-F]{64}$'),
  unique (catalog_run_id, supplier_product_id),
  foreign key (catalog_run_id, supplier_id)
    references public.supplier_catalog_runs(id, supplier_id)
    on delete restrict,
  foreign key (supplier_product_id, supplier_id)
    references public.supplier_products(id, supplier_id)
    on delete restrict
);

create index if not exists supplier_product_snapshots_product_observed_idx
  on public.supplier_product_snapshots (supplier_product_id, observed_at desc);

create index if not exists supplier_product_snapshots_run_idx
  on public.supplier_product_snapshots (catalog_run_id);

-- --------------------------------------------------------------------------
-- 7. Explicit curated-product-to-supplier relationship
-- --------------------------------------------------------------------------
-- A supplier catalog record can exist before it is linked to a curated
-- Telecom Store product. A curated product can have many supplier offers.
-- supplier_product_id is unique here because one supplier listing should map
-- to at most one canonical Telecom Store product.

create table if not exists public.product_supplier_offers (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  supplier_product_id uuid not null unique
    references public.supplier_products(id) on delete restrict,
  preferred_supplier boolean not null default false,
  active boolean not null default true,
  fulfillment_enabled boolean not null default false,
  sourcing_priority integer not null default 100 check (sourcing_priority >= 0),
  handling_days integer check (handling_days is null or handling_days >= 0),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_supplier_offers_preferred_active_check
    check (not preferred_supplier or active)
);

create unique index if not exists product_supplier_offers_one_preferred_idx
  on public.product_supplier_offers (product_id)
  where preferred_supplier = true and active = true;

create index if not exists product_supplier_offers_product_active_idx
  on public.product_supplier_offers (product_id, active, sourcing_priority);

drop trigger if exists set_product_supplier_offers_updated_at
  on public.product_supplier_offers;
create trigger set_product_supplier_offers_updated_at
before update on public.product_supplier_offers
for each row execute function public.set_updated_at();

-- --------------------------------------------------------------------------
-- 8. Warehouse inventory remains separate from supplier inventory
-- --------------------------------------------------------------------------
-- No automation is created here. available_to_sell is only arithmetic within
-- a warehouse location; storefront availability still requires an explicit,
-- reviewed business rule combining publication, warehouse stock, eligible
-- supplier offers, freshness, lead time, and fulfillment policy.

create table if not exists public.inventory_levels (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  storage_location_id uuid not null
    references public.storage_locations(id) on delete restrict,
  on_hand numeric not null default 0 check (on_hand >= 0),
  reserved numeric not null default 0 check (reserved >= 0),
  damaged numeric not null default 0 check (damaged >= 0),
  available_to_sell numeric generated always as
    (greatest(on_hand - reserved - damaged, 0)) stored,
  last_counted_at timestamptz,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, storage_location_id)
);

create index if not exists inventory_levels_product_available_idx
  on public.inventory_levels (product_id, available_to_sell);

create index if not exists inventory_levels_location_idx
  on public.inventory_levels (storage_location_id);

drop trigger if exists set_inventory_levels_updated_at on public.inventory_levels;
create trigger set_inventory_levels_updated_at
before update on public.inventory_levels
for each row execute function public.set_updated_at();

-- --------------------------------------------------------------------------
-- 9. Controlled storefront image metadata
-- --------------------------------------------------------------------------
-- supplier_products.supplier_image_url preserves the supplier reference.
-- product_images.url/storage_path identify Telecom Store-controlled images.
-- No supplier image is downloaded or declared publishable by this migration.

alter table public.product_images
  add column if not exists source_type text not null default 'warehouse',
  add column if not exists source_url text,
  add column if not exists alt_text text,
  add column if not exists sort_order integer not null default 0,
  add column if not exists is_primary boolean not null default false,
  add column if not exists publishable boolean not null default false,
  add column if not exists rights_status text not null default 'unknown',
  add column if not exists width_pixels integer,
  add column if not exists height_pixels integer,
  add column if not exists updated_at timestamptz not null default now();

alter table public.product_images
  drop constraint if exists product_images_source_type_check,
  add constraint product_images_source_type_check
    check (source_type in ('warehouse', 'supplier', 'manufacturer', 'other')),
  drop constraint if exists product_images_rights_status_check,
  add constraint product_images_rights_status_check
    check (rights_status in ('unknown', 'approved', 'restricted')),
  drop constraint if exists product_images_sort_order_check,
  add constraint product_images_sort_order_check
    check (sort_order >= 0),
  drop constraint if exists product_images_dimensions_check,
  add constraint product_images_dimensions_check
    check (
      (width_pixels is null or width_pixels > 0)
      and (height_pixels is null or height_pixels > 0)
    ),
  drop constraint if exists product_images_publishable_rights_check,
  add constraint product_images_publishable_rights_check
    check (not publishable or rights_status = 'approved');

create unique index if not exists product_images_one_primary_idx
  on public.product_images (product_id)
  where is_primary = true;

create index if not exists product_images_public_order_idx
  on public.product_images (product_id, publishable, sort_order, created_at);

drop trigger if exists set_product_images_updated_at on public.product_images;
create trigger set_product_images_updated_at
before update on public.product_images
for each row execute function public.set_updated_at();

-- Existing migration 002 omitted an UPDATE policy for product_images.
drop policy if exists "Approved inventory users can update product images"
  on public.product_images;
create policy "Approved inventory users can update product images"
on public.product_images for update
to authenticated
using (public.is_approved_inventory_user())
with check (public.is_approved_inventory_user());

-- --------------------------------------------------------------------------
-- 10. RLS: supplier data is private by default
-- --------------------------------------------------------------------------

alter table public.suppliers enable row level security;
alter table public.supplier_catalog_runs enable row level security;
alter table public.supplier_products enable row level security;
alter table public.supplier_product_snapshots enable row level security;
alter table public.product_supplier_offers enable row level security;
alter table public.inventory_levels enable row level security;

-- Supplier directory: inventory staff may read; admins manage.
drop policy if exists "Approved inventory users can read suppliers"
  on public.suppliers;
create policy "Approved inventory users can read suppliers"
on public.suppliers for select
to authenticated
using (public.is_approved_inventory_user());

drop policy if exists "Admins can manage suppliers" on public.suppliers;
create policy "Admins can manage suppliers"
on public.suppliers for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Catalog run history, hashes, source filenames, and validation summaries are
-- admin-only. Authenticated users receive no DELETE policy; catalog history is
-- retained. Service-role import jobs bypass RLS by design.
drop policy if exists "Admins can manage supplier catalog runs"
  on public.supplier_catalog_runs;
drop policy if exists "Admins can read supplier catalog runs"
  on public.supplier_catalog_runs;
create policy "Admins can read supplier catalog runs"
on public.supplier_catalog_runs for select
to authenticated
using (public.is_admin());

drop policy if exists "Admins can insert supplier catalog runs"
  on public.supplier_catalog_runs;
create policy "Admins can insert supplier catalog runs"
on public.supplier_catalog_runs for insert
to authenticated
with check (public.is_admin());

drop policy if exists "Admins can update supplier catalog runs"
  on public.supplier_catalog_runs;
create policy "Admins can update supplier catalog runs"
on public.supplier_catalog_runs for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Inventory staff may read current noncommercial supplier product metadata and
-- availability. Only admins or service-role jobs may change it.
drop policy if exists "Approved inventory users can read supplier products"
  on public.supplier_products;
create policy "Approved inventory users can read supplier products"
on public.supplier_products for select
to authenticated
using (public.is_approved_inventory_user());

drop policy if exists "Admins can manage supplier products"
  on public.supplier_products;
create policy "Admins can manage supplier products"
on public.supplier_products for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Wholesale cost, MAP, MSRP, raw payload, and history are admin-readable but
-- immutable to authenticated clients. The service-role importer writes rows.
drop policy if exists "Admins can manage private supplier snapshots"
  on public.supplier_product_snapshots;
drop policy if exists "Admins can read private supplier snapshots"
  on public.supplier_product_snapshots;
create policy "Admins can read private supplier snapshots"
on public.supplier_product_snapshots for select
to authenticated
using (public.is_admin());

-- Sourcing links are readable by inventory staff but managed by admins.
drop policy if exists "Approved inventory users can read supplier offers"
  on public.product_supplier_offers;
create policy "Approved inventory users can read supplier offers"
on public.product_supplier_offers for select
to authenticated
using (public.is_approved_inventory_user());

drop policy if exists "Admins can manage supplier offers"
  on public.product_supplier_offers;
create policy "Admins can manage supplier offers"
on public.product_supplier_offers for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Warehouse balances are readable/insertable/updatable by approved inventory
-- users. Only admins may delete an already-zero balance row.
drop policy if exists "Approved inventory users can manage inventory levels"
  on public.inventory_levels;
drop policy if exists "Approved inventory users can read inventory levels"
  on public.inventory_levels;
create policy "Approved inventory users can read inventory levels"
on public.inventory_levels for select
to authenticated
using (public.is_approved_inventory_user());

drop policy if exists "Approved inventory users can insert inventory levels"
  on public.inventory_levels;
create policy "Approved inventory users can insert inventory levels"
on public.inventory_levels for insert
to authenticated
with check (public.is_approved_inventory_user());

drop policy if exists "Approved inventory users can update inventory levels"
  on public.inventory_levels;
create policy "Approved inventory users can update inventory levels"
on public.inventory_levels for update
to authenticated
using (public.is_approved_inventory_user())
with check (public.is_approved_inventory_user());

drop policy if exists "Admins can delete empty inventory levels"
  on public.inventory_levels;
create policy "Admins can delete empty inventory levels"
on public.inventory_levels for delete
to authenticated
using (
  public.is_admin()
  and on_hand = 0
  and reserved = 0
  and damaged = 0
);

-- No anon policies and no public grants are created for suppliers,
-- supplier_catalog_runs, supplier_products, supplier_product_snapshots,
-- product_supplier_offers, or inventory_levels.

commit;

-- ============================================================================
-- DEFERRED FOLLOW-UP (NOT PART OF THIS MIGRATION)
-- ============================================================================
-- 1. Audit/backfill existing products.sku, then add a case-insensitive unique
--    constraint and an approved Telecom Store SKU generator.
-- 2. Backfill products.gtin from validated barcode values and category_id from
--    curated mappings. Do not copy supplier content without human approval.
-- 3. Apply migration 005 to create the explicit public storefront RPC.
-- 4. Only after the RPC-only storefront is deployed and verified, apply the
--    separately reviewed migration 006 to remove anonymous products SELECT.
-- 5. Define the reviewed public availability calculation and keep raw supplier
--    quantities and warehouse location-level quantities private.
-- 6. Add product routes, JSON-LD, Merchant feed generation, and image-copying
--    only after the relevant product, price, availability, and rights reviews.
--
-- ============================================================================
-- ROLLBACK RECIPE
-- ============================================================================
-- Roll back only after dependent application code and data have been removed.
-- Execute in this order in a separately reviewed down migration:
--
--   drop table public.inventory_levels;
--   drop table public.product_supplier_offers;
--   drop table public.supplier_product_snapshots;
--   drop table public.supplier_products;
--   drop table public.supplier_catalog_runs;
--   drop table public.suppliers;
--
-- Then remove only the new product_images, categories, and products columns,
-- indexes, constraints, triggers, comments, and policy added above. Existing
-- migrations 001-003 and their original data must remain intact.

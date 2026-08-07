\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email, created_at, updated_at)
values ('00000000-0000-4000-8000-000000000771', 'marketplace-test@example.invalid', now(), now());

insert into public.products
  (id, sku, brand, title, category, status, slug, manufacturer_mpn,
   short_description, long_description, published_at)
values
  ('00000000-0000-4000-8000-000000000772', 'TEST-PUBLIC-1', 'Example Brand',
   'Example Marketplace Product', 'Electronics', 'available',
   'example-marketplace-product', 'EXAMPLE-MPN-1', 'Public description.',
   'Long public description.', now());

insert into public.supplier_products
  (id, supplier_id, supplier_sku, manufacturer_mpn, brand, supplier_title,
   supplier_category, supplier_quantity, supplier_available, discontinued,
   marketplace_department_slug, current_catalog_run_id)
select
  '00000000-0000-4000-8000-000000000773', s.id, 'TEST-SUPPLIER-1',
  'EXAMPLE-MPN-1', 'Example Brand', 'Private source title', 'Electronics',
  5, true, false, 'electronics', r.id
from public.suppliers s
join lateral (
  select id from public.supplier_catalog_runs where supplier_id = s.id and status = 'loaded' order by created_at desc limit 1
) r on true
where s.code = 'petra';

insert into public.product_supplier_offers
  (product_id, supplier_product_id, active, fulfillment_enabled)
values
  ('00000000-0000-4000-8000-000000000772', '00000000-0000-4000-8000-000000000773', true, false);

insert into public.marketplace_publications
  (product_id, department_slug, publication_status, price_mode, public_price,
   image_publication_approved, approved_by, approved_at, published_at)
values
  ('00000000-0000-4000-8000-000000000772', 'electronics', 'approved',
   'request_quote', null, false, '00000000-0000-4000-8000-000000000771', now(), now());

do $$
begin
  if (select count(*) from public.get_public_marketplace_catalog(null) where sku = 'TEST-PUBLIC-1') <> 1 then
    raise exception 'approved, in-stock, unrestricted request-quote product must be visible';
  end if;
  if pg_get_function_result('public.get_public_marketplace_catalog(text)'::regprocedure)
    ~* 'supplier_sku|supplier_cost|map_price|msrp|gross_margin|source_evidence' then
    raise exception 'public function exposes a private column';
  end if;
end $$;

insert into public.supplier_restrictions
  (supplier_product_id, catalog_run_id, restriction_type, review_status, source_evidence)
select '00000000-0000-4000-8000-000000000773', current_catalog_run_id,
  'internet_sale', 'blocked', 'Synthetic test restriction'
from public.supplier_products where id = '00000000-0000-4000-8000-000000000773';

do $$ begin
  if exists (select 1 from public.get_public_marketplace_catalog(null) where sku = 'TEST-PUBLIC-1') then
    raise exception 'restricted product leaked';
  end if;
end $$;

update public.supplier_restrictions
set review_status = 'cleared', reviewed_at = now(), reviewed_by = '00000000-0000-4000-8000-000000000771'
where supplier_product_id = '00000000-0000-4000-8000-000000000773';

insert into public.supplier_product_quarantine
  (supplier_product_id, catalog_run_id, reason, evidence)
select id, current_catalog_run_id, 'identity_conflict', '{"synthetic":true}'::jsonb
from public.supplier_products where id = '00000000-0000-4000-8000-000000000773';

do $$ begin
  if exists (select 1 from public.get_public_marketplace_catalog(null) where sku = 'TEST-PUBLIC-1') then
    raise exception 'quarantined product leaked';
  end if;
end $$;

update public.supplier_product_quarantine
set status = 'resolved', resolved_at = now(), resolved_by = '00000000-0000-4000-8000-000000000771'
where supplier_product_id = '00000000-0000-4000-8000-000000000773';

update public.supplier_products set supplier_quantity = 0, supplier_available = false
where id = '00000000-0000-4000-8000-000000000773';
do $$ begin
  if exists (select 1 from public.get_public_marketplace_catalog(null) where sku = 'TEST-PUBLIC-1') then
    raise exception 'zero-stock product leaked';
  end if;
end $$;
update public.supplier_products set supplier_quantity = 5, supplier_available = true
where id = '00000000-0000-4000-8000-000000000773';

update public.marketplace_publications set price_mode = 'fixed', public_price = 49.95
where product_id = '00000000-0000-4000-8000-000000000772';
do $$ begin
  if exists (select 1 from public.get_public_marketplace_catalog(null) where sku = 'TEST-PUBLIC-1') then
    raise exception 'fixed price without an approved private review leaked';
  end if;
end $$;

insert into public.pricing_reviews
  (supplier_product_id, product_id, catalog_run_id, status, reason,
   approval_status, approved_public_price, reviewed_by, reviewed_at)
select id, '00000000-0000-4000-8000-000000000772', current_catalog_run_id,
  'price_ready', 'synthetic_boundary_test', 'approved', 49.95,
  '00000000-0000-4000-8000-000000000771', now()
from public.supplier_products where id = '00000000-0000-4000-8000-000000000773';

do $$ begin
  if (select public_price from public.get_public_marketplace_catalog(null) where sku = 'TEST-PUBLIC-1') <> 49.95 then
    raise exception 'approved public price did not pass';
  end if;
  if (select image_url from public.get_public_marketplace_catalog(null) where sku = 'TEST-PUBLIC-1') is not null then
    raise exception 'unapproved image leaked';
  end if;
end $$;

insert into public.product_images
  (product_id, url, image_type, source_type, alt_text, is_primary, publishable, rights_status)
values
  ('00000000-0000-4000-8000-000000000772', 'https://example.invalid/approved.jpg',
   'item', 'manufacturer', 'Example Marketplace Product', true, true, 'approved');
update public.marketplace_publications set image_publication_approved = true
where product_id = '00000000-0000-4000-8000-000000000772';

do $$ begin
  if (select image_url from public.get_public_marketplace_catalog(null) where sku = 'TEST-PUBLIC-1') is distinct from 'https://example.invalid/approved.jpg' then
    raise exception 'approved image did not pass';
  end if;
end $$;

set local role anon;
do $$ begin
  if (select count(*) from public.get_public_marketplace_catalog('TEST-SUPPLIER-1')) <> 1 then
    raise exception 'internal supplier SKU search must find the public product without exposing the SKU';
  end if;
end $$;

reset role;

do $$
declare
  private_table text;
  private_tables text[] := array[
    'suppliers',
    'supplier_catalog_runs',
    'supplier_products',
    'supplier_product_snapshots',
    'product_supplier_offers',
    'inventory_levels',
    'marketplace_departments',
    'supplier_restrictions',
    'supplier_product_quarantine',
    'pricing_reviews',
    'marketplace_publications'
  ];
begin
  foreach private_table in array private_tables loop
    if has_table_privilege('anon', format('public.%I', private_table), 'select')
      or has_table_privilege('anon', format('public.%I', private_table), 'insert')
      or has_table_privilege('anon', format('public.%I', private_table), 'update')
      or has_table_privilege('anon', format('public.%I', private_table), 'delete')
      or has_table_privilege('anon', format('public.%I', private_table), 'truncate')
      or has_table_privilege('anon', format('public.%I', private_table), 'references')
      or has_table_privilege('anon', format('public.%I', private_table), 'trigger') then
      raise exception 'anon retains a direct privilege on public.%', private_table;
    end if;

    if not has_table_privilege('authenticated', format('public.%I', private_table), 'select') then
      raise exception 'authenticated staff lost select on public.%', private_table;
    end if;
    if not has_table_privilege('service_role', format('public.%I', private_table), 'select') then
      raise exception 'service_role lost select on public.%', private_table;
    end if;
  end loop;

  if exists (
    select 1
    from information_schema.role_table_grants
    where grantee = 'PUBLIC'
      and table_schema = 'public'
      and table_name = any(private_tables)
  ) then
    raise exception 'PUBLIC retains a direct supplier/marketplace table privilege';
  end if;

  if not has_function_privilege('anon', 'public.get_public_marketplace_catalog(text)', 'execute') then
    raise exception 'anon lost sanitized marketplace RPC access';
  end if;
end $$;

rollback;

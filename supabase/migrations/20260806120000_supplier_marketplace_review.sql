-- Supplier-neutral marketplace review and publication boundary.
--
-- This migration is additive. It imports no supplier rows, creates no public
-- product publication, approves no price/image, and changes no existing
-- telecom storefront RPC.

begin;

create table if not exists public.marketplace_departments (
  slug text primary key check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (btrim(name) <> ''),
  description text not null default '',
  sort_order integer not null default 100 check (sort_order >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.marketplace_departments (slug, name, description, sort_order)
values
  ('electronics', 'Electronics', 'Audio, video, computing, mobile, and connected electronics.', 10),
  ('home-kitchen', 'Home & Kitchen', 'Products for the home, office, and kitchen.', 20),
  ('tools', 'Tools & Home Improvement', 'Tools, installation products, and home-improvement equipment.', 30),
  ('automotive-marine', 'Automotive & Marine', 'Automotive and marine electronics and accessories.', 40),
  ('outdoor-fitness', 'Outdoor & Fitness', 'Outdoor, recreation, and fitness products.', 50),
  ('health-beauty', 'Health & Beauty', 'Health, wellness, and personal-care products.', 60),
  ('appliance-parts', 'Appliance Parts', 'Appliance replacement parts and accessories.', 70),
  ('deals', 'Deals', 'Individually approved limited-quantity and clearance products.', 80)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  sort_order = excluded.sort_order;

drop trigger if exists set_marketplace_departments_updated_at on public.marketplace_departments;
create trigger set_marketplace_departments_updated_at
before update on public.marketplace_departments
for each row execute function public.set_updated_at();

alter table public.supplier_products
  add column if not exists marketplace_department_slug text
    references public.marketplace_departments(slug) on delete set null;

create index if not exists supplier_products_marketplace_department_idx
  on public.supplier_products (marketplace_department_slug, supplier_available, discontinued);

create table if not exists public.supplier_restrictions (
  id uuid primary key default gen_random_uuid(),
  supplier_product_id uuid not null references public.supplier_products(id) on delete cascade,
  catalog_run_id uuid references public.supplier_catalog_runs(id) on delete restrict,
  restriction_type text not null
    check (restriction_type in ('internet_sale', 'territory', 'dealer_authorization', 'other')),
  review_status text not null default 'blocked'
    check (review_status in ('blocked', 'pending', 'cleared')),
  source_evidence text not null check (btrim(source_evidence) <> ''),
  active boolean not null default true,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  resolution_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_restrictions_review_check check (
    review_status <> 'cleared' or reviewed_at is not null
  ),
  unique (supplier_product_id, catalog_run_id, restriction_type)
);

create index if not exists supplier_restrictions_active_product_idx
  on public.supplier_restrictions (supplier_product_id, review_status)
  where active;

drop trigger if exists set_supplier_restrictions_updated_at on public.supplier_restrictions;
create trigger set_supplier_restrictions_updated_at
before update on public.supplier_restrictions
for each row execute function public.set_updated_at();

create table if not exists public.supplier_product_quarantine (
  id uuid primary key default gen_random_uuid(),
  supplier_product_id uuid not null references public.supplier_products(id) on delete cascade,
  catalog_run_id uuid not null references public.supplier_catalog_runs(id) on delete restrict,
  reason text not null
    check (reason in ('identity_conflict', 'missing_identity', 'ambiguous_mpn', 'ambiguous_gtin', 'manual_review')),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  status text not null default 'quarantined'
    check (status in ('quarantined', 'resolved', 'rejected')),
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  resolution_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_product_quarantine_resolution_check check (
    status = 'quarantined' or resolved_at is not null
  ),
  unique (supplier_product_id, catalog_run_id, reason)
);

create index if not exists supplier_product_quarantine_open_idx
  on public.supplier_product_quarantine (supplier_product_id, status)
  where status = 'quarantined';

drop trigger if exists set_supplier_product_quarantine_updated_at on public.supplier_product_quarantine;
create trigger set_supplier_product_quarantine_updated_at
before update on public.supplier_product_quarantine
for each row execute function public.set_updated_at();

create table if not exists public.pricing_reviews (
  id uuid primary key default gen_random_uuid(),
  supplier_product_id uuid not null references public.supplier_products(id) on delete cascade,
  product_id uuid references public.products(id) on delete restrict,
  catalog_run_id uuid not null references public.supplier_catalog_runs(id) on delete restrict,
  status text not null check (status in (
    'price_ready', 'market_review_required', 'quote_only', 'unprofitable',
    'map_review', 'discontinued_clearance'
  )),
  reason text not null check (btrim(reason) <> ''),
  supplier_cost numeric check (supplier_cost is null or supplier_cost >= 0),
  map_price numeric check (map_price is null or map_price >= 0),
  msrp numeric check (msrp is null or msrp >= 0),
  margin_floor_30 numeric check (margin_floor_30 is null or margin_floor_30 >= 0),
  margin_floor_20 numeric check (margin_floor_20 is null or margin_floor_20 >= 0),
  candidate_price numeric check (candidate_price is null or candidate_price >= 0),
  gross_profit numeric,
  gross_margin numeric,
  market_evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(market_evidence) = 'object'),
  approval_status text not null default 'pending'
    check (approval_status in ('pending', 'approved', 'rejected')),
  approved_public_price numeric check (approved_public_price is null or approved_public_price > 0),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pricing_reviews_approval_check check (
    approval_status <> 'approved'
    or (approved_public_price is not null and reviewed_at is not null and reviewed_by is not null)
  ),
  unique (supplier_product_id, catalog_run_id)
);

create index if not exists pricing_reviews_product_status_idx
  on public.pricing_reviews (product_id, approval_status, status)
  where product_id is not null;

create index if not exists pricing_reviews_supplier_product_idx
  on public.pricing_reviews (supplier_product_id, created_at desc);

drop trigger if exists set_pricing_reviews_updated_at on public.pricing_reviews;
create trigger set_pricing_reviews_updated_at
before update on public.pricing_reviews
for each row execute function public.set_updated_at();

create table if not exists public.marketplace_publications (
  product_id uuid primary key references public.products(id) on delete restrict,
  department_slug text not null references public.marketplace_departments(slug) on delete restrict,
  subcategory text,
  publication_status text not null default 'draft'
    check (publication_status in ('draft', 'review', 'approved', 'hidden')),
  clearance boolean not null default false,
  price_mode text not null default 'request_quote'
    check (price_mode in ('request_quote', 'fixed')),
  public_price numeric check (public_price is null or public_price > 0),
  image_publication_approved boolean not null default false,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketplace_publications_price_check check (
    (price_mode = 'request_quote' and public_price is null)
    or (price_mode = 'fixed' and public_price is not null)
  ),
  constraint marketplace_publications_approval_check check (
    publication_status <> 'approved'
    or (approved_by is not null and approved_at is not null and published_at is not null)
  ),
  constraint marketplace_publications_deals_check check (
    department_slug <> 'deals' or clearance
  )
);

create index if not exists marketplace_publications_browse_idx
  on public.marketplace_publications (publication_status, department_slug, clearance);

drop trigger if exists set_marketplace_publications_updated_at on public.marketplace_publications;
create trigger set_marketplace_publications_updated_at
before update on public.marketplace_publications
for each row execute function public.set_updated_at();

-- All review and supplier data remains private. Direct table access is never
-- needed by anonymous shoppers; the public contract is the RPC below.
alter table public.marketplace_departments enable row level security;
alter table public.supplier_restrictions enable row level security;
alter table public.supplier_product_quarantine enable row level security;
alter table public.pricing_reviews enable row level security;
alter table public.marketplace_publications enable row level security;

revoke all on table public.marketplace_departments from public, anon;
revoke all on table public.supplier_restrictions from public, anon;
revoke all on table public.supplier_product_quarantine from public, anon;
revoke all on table public.pricing_reviews from public, anon;
revoke all on table public.marketplace_publications from public, anon;

grant select, insert, update, delete on table public.marketplace_departments to authenticated;
grant select, insert, update, delete on table public.supplier_restrictions to authenticated;
grant select, insert, update, delete on table public.supplier_product_quarantine to authenticated;
grant select, insert, update, delete on table public.pricing_reviews to authenticated;
grant select, insert, update, delete on table public.marketplace_publications to authenticated;

create policy "Approved inventory users can read marketplace departments"
on public.marketplace_departments for select to authenticated
using (public.is_approved_inventory_user());
create policy "Admins can manage marketplace departments"
on public.marketplace_departments for all to authenticated
using (public.is_admin()) with check (public.is_admin());

create policy "Admins can manage supplier restrictions"
on public.supplier_restrictions for all to authenticated
using (public.is_admin()) with check (public.is_admin());
create policy "Admins can manage supplier quarantine"
on public.supplier_product_quarantine for all to authenticated
using (public.is_admin()) with check (public.is_admin());
create policy "Admins can manage pricing reviews"
on public.pricing_reviews for all to authenticated
using (public.is_admin()) with check (public.is_admin());
create policy "Admins can manage marketplace publications"
on public.marketplace_publications for all to authenticated
using (public.is_admin()) with check (public.is_admin());

create or replace function public.get_public_marketplace_catalog(p_search text default null)
returns table (
  id uuid,
  sku text,
  slug text,
  brand text,
  title text,
  manufacturer_mpn text,
  gtin text,
  department_slug text,
  department_name text,
  subcategory text,
  short_description text,
  long_description text,
  search_keywords text[],
  availability text,
  clearance boolean,
  price_mode text,
  public_price numeric,
  currency_code text,
  image_url text,
  image_alt text,
  meta_title text,
  meta_description text,
  published_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select
    p.id,
    p.sku,
    p.slug,
    p.brand,
    p.title,
    p.manufacturer_mpn,
    p.gtin,
    mp.department_slug,
    md.name,
    mp.subcategory,
    p.short_description,
    p.long_description,
    p.search_keywords,
    case when mp.clearance then 'Limited quantity—no restock expected' else 'In stock' end,
    mp.clearance,
    mp.price_mode,
    case when mp.price_mode = 'fixed' then mp.public_price else null end,
    p.currency_code,
    case when mp.image_publication_approved then image.url else null end,
    case when mp.image_publication_approved then image.alt_text else null end,
    p.meta_title,
    p.meta_description,
    mp.published_at,
    p.updated_at
  from public.marketplace_publications mp
  join public.products p on p.id = mp.product_id
  join public.marketplace_departments md on md.slug = mp.department_slug and md.active
  left join lateral (
    select pi.url, pi.alt_text
    from public.product_images pi
    where pi.product_id = p.id
      and pi.publishable
      and pi.rights_status = 'approved'
    order by pi.is_primary desc, pi.sort_order, pi.created_at
    limit 1
  ) image on true
  where mp.publication_status = 'approved'
    and p.status = 'available'
    and exists (
      select 1
      from public.product_supplier_offers offer
      join public.supplier_products sp on sp.id = offer.supplier_product_id
      where offer.product_id = p.id
        and offer.active
        and sp.supplier_available
        and sp.supplier_quantity > 0
        and (not sp.discontinued or mp.clearance)
        and not exists (
          select 1 from public.supplier_restrictions sr
          where sr.supplier_product_id = sp.id and sr.active and sr.review_status <> 'cleared'
        )
        and not exists (
          select 1 from public.supplier_product_quarantine q
          where q.supplier_product_id = sp.id and q.status = 'quarantined'
        )
    )
    and (
      mp.price_mode = 'request_quote'
      or exists (
        select 1
        from public.pricing_reviews pr
        join public.product_supplier_offers offer on offer.supplier_product_id = pr.supplier_product_id
        where offer.product_id = p.id
          and pr.product_id = p.id
          and pr.approval_status = 'approved'
          and pr.approved_public_price = mp.public_price
      )
    )
    and (
      nullif(btrim(p_search), '') is null
      or concat_ws(' ', p.title, p.brand, p.manufacturer_mpn, p.gtin, mp.subcategory,
        array_to_string(p.search_keywords, ' ')) ilike '%' || btrim(p_search) || '%'
      or exists (
        select 1
        from public.product_supplier_offers search_offer
        join public.supplier_products search_sp on search_sp.id = search_offer.supplier_product_id
        where search_offer.product_id = p.id
          and search_offer.active
          and search_sp.supplier_sku ilike '%' || btrim(p_search) || '%'
      )
    )
  order by mp.clearance desc, p.brand, p.title;
$$;

comment on function public.get_public_marketplace_catalog(text) is
  'Sanitized marketplace projection. Never expose supplier identity/SKU, cost, MAP, MSRP, raw quantities, notes, restrictions, quarantine, or review data.';

revoke all on function public.get_public_marketplace_catalog(text) from public;
grant execute on function public.get_public_marketplace_catalog(text) to anon, authenticated;

commit;

-- Rollback (after application/publication dependencies are removed):
-- drop function public.get_public_marketplace_catalog(text);
-- drop table public.marketplace_publications;
-- drop table public.pricing_reviews;
-- drop table public.supplier_product_quarantine;
-- drop table public.supplier_restrictions;
-- alter table public.supplier_products drop column marketplace_department_slug;
-- drop table public.marketplace_departments;

-- ============================================================================
-- Migration 005: explicit public storefront product contract
--
-- Apply after migration 004 because this function references curated product
-- columns introduced there. This migration does not import or publish products
-- and does not expose supplier tables or supplier data. Migration 006 remains a
-- separate, deliberately delayed production step.
-- ============================================================================

begin;

-- SECURITY DEFINER is intentional. Anonymous and normal authenticated callers
-- will not need SELECT on public.products after migration 006. The function
-- therefore owns the entire public contract: an explicit return schema, an
-- explicit available-only predicate, no caller-controlled SQL, qualified
-- relation names, and a fixed trusted search_path.
create or replace function public.get_public_product_catalog()
returns table (
  id uuid,
  sku text,
  brand text,
  title text,
  category text,
  condition text,
  public_availability text,
  price numeric,
  currency_code text,
  public_price_note text,
  short_description text,
  long_description text,
  photo_main text,
  photo_label text,
  photo_extra_1 text,
  photo_extra_2 text,
  slug text,
  manufacturer_mpn text,
  gtin text,
  specifications jsonb,
  meta_title text,
  meta_description text,
  search_keywords text[],
  google_product_category text,
  canonical_url_override text,
  published_at timestamptz,
  updated_at timestamptz,
  status text
)
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select
    p.id,
    p.sku,
    p.brand,
    p.title,
    p.category,
    p.condition,
    case
      when p.quantity_available > 0 then 'in_stock'
      when p.quantity_available = 0 then 'out_of_stock'
      else 'quote_only'
    end as public_availability,
    p.price,
    p.currency_code,
    case when p.price is null then 'Request quote' end as public_price_note,
    p.short_description,
    p.long_description,
    p.photo_main,
    p.photo_label,
    p.photo_extra_1,
    p.photo_extra_2,
    p.slug,
    p.manufacturer_mpn,
    p.gtin,
    p.specifications,
    p.meta_title,
    p.meta_description,
    p.search_keywords,
    p.google_product_category,
    p.canonical_url_override,
    p.published_at,
    p.updated_at,
    p.status
  from public.products as p
  where p.status = 'available'
  order by p.updated_at desc nulls last;
$$;

comment on function public.get_public_product_catalog() is
  'Public-safe storefront projection. Never add supplier, cost, raw quantity, location, audit, or internal-note fields.';

-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. Remove that
-- broad privilege and grant only the two application-facing roles.
revoke all on function public.get_public_product_catalog() from public;
grant execute on function public.get_public_product_catalog() to anon, authenticated;

commit;

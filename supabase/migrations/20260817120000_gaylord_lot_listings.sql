-- A Gaylord box is a single mixed-inventory lot. It is publishable without an
-- individual SKU, but still requires a title, category, and main photo in the
-- client storefront before customers can see it.
begin;

alter table public.products
  add column if not exists is_gaylord_lot boolean not null default false;

drop function if exists public.get_public_product_catalog();

create function public.get_public_product_catalog()
returns table (
  id uuid, sku text, brand text, title text, category text, condition text,
  is_gaylord_lot boolean, public_availability text, price numeric, currency_code text,
  public_price_note text, short_description text, long_description text,
  photo_main text, photo_label text, photo_extra_1 text, photo_extra_2 text,
  slug text, manufacturer_mpn text, gtin text, specifications jsonb,
  meta_title text, meta_description text, search_keywords text[],
  google_product_category text, canonical_url_override text,
  published_at timestamptz, updated_at timestamptz, status text
)
language sql stable security definer set search_path = pg_catalog
as $$
  select
    p.id, p.sku, p.brand, p.title, p.category, p.condition, p.is_gaylord_lot,
    case when p.quantity_available > 0 then 'in_stock'
         when p.quantity_available = 0 then 'out_of_stock'
         else 'quote_only' end,
    p.price, p.currency_code, case when p.price is null then 'Request quote' end,
    p.short_description, p.long_description,
    case when image_restriction.blocked is true then null else coalesce(public_image.url, p.photo_main) end,
    p.photo_label, p.photo_extra_1, p.photo_extra_2,
    p.slug, p.manufacturer_mpn, p.gtin, p.specifications,
    p.meta_title, p.meta_description, p.search_keywords,
    p.google_product_category, p.canonical_url_override,
    p.published_at, p.updated_at, p.status
  from public.products p
  left join lateral (
    select true as blocked
    from public.product_image_restrictions r
    where r.active is true
      and (r.product_id = p.id
        or (r.brand is not null and lower(r.brand) = lower(p.brand))
        or (r.supplier_sku is not null and exists (
          select 1 from public.product_supplier_offers offer
          join public.supplier_products sp on sp.id = offer.supplier_product_id
          where offer.product_id = p.id and lower(sp.supplier_sku) = lower(r.supplier_sku)
        )))
    limit 1
  ) image_restriction on true
  left join lateral (
    select pi.url
    from public.product_images pi
    where pi.product_id = p.id and pi.publishable is true and pi.rights_status = 'approved'
      and image_restriction.blocked is null
    order by pi.is_primary desc, pi.sort_order, pi.created_at
    limit 1
  ) public_image on true
  where p.status = 'available'
  order by p.updated_at desc nulls last;
$$;

revoke all on function public.get_public_product_catalog() from public;
grant execute on function public.get_public_product_catalog() to anon, authenticated;

commit;

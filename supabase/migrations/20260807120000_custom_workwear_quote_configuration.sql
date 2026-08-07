-- Non-destructive support for private custom-workwear quote configurations.
-- Apply before deploying the corresponding storefront/functions. This does not
-- publish artwork: the storage bucket remains private and service-role only.

alter table public.quote_request_items
  add column if not exists base_unit_price numeric(12,2)
    check (base_unit_price is null or base_unit_price >= 0),
  add column if not exists configuration jsonb
    check (configuration is null or jsonb_typeof(configuration) = 'object'),
  add column if not exists artwork_reference text
    check (artwork_reference is null or artwork_reference ~ '^[0-9a-f-]{36}\.(png|jpg|svg)$');

comment on column public.quote_request_items.base_unit_price is
  'Public starting price at request time; never represents an unapproved configured selling price.';
comment on column public.quote_request_items.configuration is
  'Customer-selected public workwear options. Must never contain supplier cost or internal pricing.';
comment on column public.quote_request_items.artwork_reference is
  'Opaque reference to privately stored customer artwork; never a public URL.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'workwear-artwork',
  'workwear-artwork',
  false,
  4194304,
  array['image/png','image/jpeg','image/svg+xml']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- No anon or authenticated policy is created for this bucket. Existing
-- storage privileges and policies for unrelated product-photo buckets remain
-- untouched; only the server-side service-role client can access this bucket.

-- Rollback (only after confirming no quote or artwork depends on these fields):
-- delete from storage.buckets where id = 'workwear-artwork';
-- alter table public.quote_request_items
--   drop column artwork_reference,
--   drop column configuration,
--   drop column base_unit_price;

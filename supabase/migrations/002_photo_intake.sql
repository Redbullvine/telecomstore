-- Photo Intake feature: multi-photo records per product + label text field.
-- Additive only. Does not modify or move any existing rows, tables, policies,
-- or the existing photo_main / photo_label / photo_extra_1 / photo_extra_2 columns.

alter table public.products add column if not exists label_text text;

create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  url text not null,
  storage_path text,
  image_type text default 'item' check (image_type in ('label_barcode', 'item', 'other')),
  uploaded_by uuid references auth.users(id),
  created_at timestamptz default now()
);

create index if not exists product_images_product_idx on public.product_images(product_id);
create index if not exists product_images_created_at_idx on public.product_images(created_at desc);

alter table public.product_images enable row level security;

-- Admin-only table: the public storefront keeps reading the photo_* columns on
-- products, so draft/photo-intake image records never surface to customers.
drop policy if exists "Approved inventory users can read product images" on public.product_images;
create policy "Approved inventory users can read product images"
on public.product_images for select
to authenticated
using (public.is_approved_inventory_user());

drop policy if exists "Approved inventory users can insert product images" on public.product_images;
create policy "Approved inventory users can insert product images"
on public.product_images for insert
to authenticated
with check (public.is_approved_inventory_user());

drop policy if exists "Approved inventory users can delete product images" on public.product_images;
create policy "Approved inventory users can delete product images"
on public.product_images for delete
to authenticated
using (public.is_approved_inventory_user());

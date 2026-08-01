-- Reconciled canonical baseline.
-- Production already contained the original local-001 inventory baseline
-- before its recorded migration ledger began. The production ledger version
-- 20260703191104 records the photo-intake migration. This local file combines
-- the original local 001 followed by local 002 so a fresh database can recreate
-- the complete production baseline. Do not repair or replay remote history.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text default 'viewer' check (role in ('admin', 'inventory', 'viewer')),
  approved boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  sku text,
  barcode text,
  brand text,
  title text not null,
  category text,
  condition text,
  quantity_available numeric,
  unit text,
  price numeric,
  price_note text,
  warehouse_location text,
  aisle text,
  rack text,
  shelf text,
  pallet text,
  short_description text,
  long_description text,
  status text default 'draft' check (status in ('draft', 'available', 'hold', 'sold', 'archived')),
  photo_main text,
  photo_label text,
  photo_extra_1 text,
  photo_extra_2 text,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.inventory_activity (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete set null,
  actor_id uuid references auth.users(id),
  action text not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  created_at timestamptz default now()
);

create table if not exists public.storage_locations (
  id uuid primary key default gen_random_uuid(),
  name text,
  aisle text,
  rack text,
  shelf text,
  pallet text,
  notes text,
  created_at timestamptz default now()
);

create index if not exists products_status_idx on public.products(status);
create index if not exists products_sku_idx on public.products(sku);
create index if not exists products_barcode_idx on public.products(barcode);
create index if not exists products_category_idx on public.products(category);
create index if not exists inventory_activity_product_idx on public.inventory_activity(product_id);
create index if not exists inventory_activity_created_at_idx on public.inventory_activity(created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_products_updated_at on public.products;
create trigger set_products_updated_at
before update on public.products
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name')
  )
  on conflict (id) do update
  set email = excluded.email,
      full_name = coalesce(public.profiles.full_name, excluded.full_name),
      updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_approved_inventory_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and approved = true
      and role in ('admin', 'inventory')
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and approved = true
      and role = 'admin'
  );
$$;

create or replace function public.log_product_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  action_name text;
begin
  action_name := lower(TG_OP);

  if TG_OP = 'INSERT' then
    insert into public.inventory_activity (product_id, actor_id, action, before_data, after_data)
    values (new.id, auth.uid(), action_name, null, to_jsonb(new));
    return new;
  elsif TG_OP = 'UPDATE' then
    insert into public.inventory_activity (product_id, actor_id, action, before_data, after_data)
    values (new.id, auth.uid(), action_name, to_jsonb(old), to_jsonb(new));
    return new;
  elsif TG_OP = 'DELETE' then
    insert into public.inventory_activity (product_id, actor_id, action, before_data, after_data)
    values (old.id, auth.uid(), action_name, to_jsonb(old), null);
    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists products_activity_insert on public.products;
create trigger products_activity_insert
after insert on public.products
for each row execute function public.log_product_activity();

drop trigger if exists products_activity_update on public.products;
create trigger products_activity_update
after update on public.products
for each row execute function public.log_product_activity();

drop trigger if exists products_activity_delete on public.products;
create trigger products_activity_delete
after delete on public.products
for each row execute function public.log_product_activity();

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.inventory_activity enable row level security;
alter table public.categories enable row level security;
alter table public.storage_locations enable row level security;

drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile"
on public.profiles for select
to authenticated
using (id = auth.uid());

drop policy if exists "Admins can read profiles" on public.profiles;
create policy "Admins can read profiles"
on public.profiles for select
to authenticated
using (public.is_admin());

drop policy if exists "Admins can update profiles" on public.profiles;
create policy "Admins can update profiles"
on public.profiles for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Public can read available products" on public.products;
create policy "Public can read available products"
on public.products for select
to anon, authenticated
using (status = 'available');

drop policy if exists "Approved inventory users can read all products" on public.products;
create policy "Approved inventory users can read all products"
on public.products for select
to authenticated
using (public.is_approved_inventory_user());

drop policy if exists "Approved inventory users can insert products" on public.products;
create policy "Approved inventory users can insert products"
on public.products for insert
to authenticated
with check (public.is_approved_inventory_user());

drop policy if exists "Approved inventory users can update products" on public.products;
create policy "Approved inventory users can update products"
on public.products for update
to authenticated
using (public.is_approved_inventory_user())
with check (public.is_approved_inventory_user());

drop policy if exists "Admins can hard delete products" on public.products;
create policy "Admins can hard delete products"
on public.products for delete
to authenticated
using (public.is_admin());

drop policy if exists "Approved inventory users can read activity" on public.inventory_activity;
create policy "Approved inventory users can read activity"
on public.inventory_activity for select
to authenticated
using (public.is_approved_inventory_user());

drop policy if exists "Approved inventory users can insert activity" on public.inventory_activity;
create policy "Approved inventory users can insert activity"
on public.inventory_activity for insert
to authenticated
with check (public.is_approved_inventory_user());

drop policy if exists "Approved inventory users can manage categories" on public.categories;
create policy "Approved inventory users can manage categories"
on public.categories for all
to authenticated
using (public.is_approved_inventory_user())
with check (public.is_approved_inventory_user());

drop policy if exists "Approved inventory users can manage storage locations" on public.storage_locations;
create policy "Approved inventory users can manage storage locations"
on public.storage_locations for all
to authenticated
using (public.is_approved_inventory_user())
with check (public.is_approved_inventory_user());

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "Public can view product images" on storage.objects;
create policy "Public can view product images"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'product-images');

drop policy if exists "Approved inventory users can upload product images" on storage.objects;
create policy "Approved inventory users can upload product images"
on storage.objects for insert
to authenticated
with check (bucket_id = 'product-images' and public.is_approved_inventory_user());

drop policy if exists "Approved inventory users can update product images" on storage.objects;
create policy "Approved inventory users can update product images"
on storage.objects for update
to authenticated
using (bucket_id = 'product-images' and public.is_approved_inventory_user())
with check (bucket_id = 'product-images' and public.is_approved_inventory_user());

drop policy if exists "Approved inventory users can delete product images" on storage.objects;
create policy "Approved inventory users can delete product images"
on storage.objects for delete
to authenticated
using (bucket_id = 'product-images' and public.is_approved_inventory_user());

insert into public.categories (name)
values
  ('Copper Splicing'),
  ('Fiber'),
  ('Closures'),
  ('Terminals'),
  ('Cable Hardware'),
  ('Tools'),
  ('Test Equipment'),
  ('Pedestals / Cabinets'),
  ('Misc Telecom Material')
on conflict (name) do nothing;

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

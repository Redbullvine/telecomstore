-- ============================================================================
-- Migration 007: durable Stripe order tracking
--
-- Adds an idempotent Stripe event ledger, orders, and order items. All money
-- values are integer cents exactly as Stripe reports them. This migration is
-- additive: it does not touch products, pricing, suppliers, or the public RPC.
--
-- SECURITY MODEL
--   * Browsers never write these tables. No anon privileges exist at all.
--   * Authenticated users receive SELECT only, and RLS further restricts
--     reads to admins (public.is_admin()).
--   * Only server-side functions using the service role (which bypasses RLS
--     but still needs explicit grants for reproducible fresh builds) may
--     insert or update. No role receives DELETE; payment history is retained.
--   * Idempotency: stripe_events.stripe_event_id is unique, so a replayed
--     webhook records as a duplicate instead of creating a second order, and
--     orders.stripe_checkout_session_id is unique so replays upsert.
-- ============================================================================

begin;

-- --------------------------------------------------------------------------
-- 1. Raw Stripe event ledger (idempotency + audit)
-- --------------------------------------------------------------------------

create table if not exists public.stripe_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null,
  event_type text not null,
  payload jsonb not null,
  processing_status text not null default 'received'
    check (processing_status in ('received', 'processed', 'skipped', 'failed')),
  processing_error text,
  order_id uuid,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint stripe_events_event_id_not_blank_check
    check (btrim(stripe_event_id) <> ''),
  constraint stripe_events_payload_object_check
    check (jsonb_typeof(payload) = 'object'),
  constraint stripe_events_unique_event unique (stripe_event_id)
);

create index if not exists stripe_events_type_received_idx
  on public.stripe_events (event_type, received_at desc);

-- --------------------------------------------------------------------------
-- 2. Orders (one per Stripe checkout session)
-- --------------------------------------------------------------------------

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  stripe_checkout_session_id text not null,
  stripe_payment_intent_id text,
  stripe_customer_id text,
  payment_status text not null default 'pending'
    check (payment_status in ('pending', 'paid', 'failed', 'refunded', 'partially_refunded')),
  fulfillment_status text not null default 'unfulfilled'
    check (fulfillment_status in ('unfulfilled', 'processing', 'shipped', 'delivered', 'canceled')),
  currency_code text not null default 'USD'
    check (currency_code ~ '^[A-Z]{3}$'),
  amount_subtotal_cents integer
    check (amount_subtotal_cents is null or amount_subtotal_cents >= 0),
  amount_tax_cents integer
    check (amount_tax_cents is null or amount_tax_cents >= 0),
  amount_shipping_cents integer
    check (amount_shipping_cents is null or amount_shipping_cents >= 0),
  amount_total_cents integer
    check (amount_total_cents is null or amount_total_cents >= 0),
  customer_email text,
  customer_name text,
  customer_phone text,
  shipping_address jsonb,
  last_stripe_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_session_not_blank_check
    check (btrim(stripe_checkout_session_id) <> ''),
  constraint orders_shipping_address_object_check
    check (shipping_address is null or jsonb_typeof(shipping_address) = 'object'),
  constraint orders_unique_session unique (stripe_checkout_session_id)
);

create index if not exists orders_payment_intent_idx
  on public.orders (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

create index if not exists orders_payment_status_idx
  on public.orders (payment_status, created_at desc);

drop trigger if exists set_orders_updated_at on public.orders;
create trigger set_orders_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

-- Link ledger entries to the order they affected (nullable: some events
-- arrive before an order exists or affect none).
alter table public.stripe_events
  drop constraint if exists stripe_events_order_fk,
  add constraint stripe_events_order_fk
    foreign key (order_id) references public.orders(id) on delete set null;

-- --------------------------------------------------------------------------
-- 3. Order items (server-authoritative pricing snapshot)
-- --------------------------------------------------------------------------
-- unit_amount_cents is copied from the server-side approved pricing bundle at
-- order time, never from the browser. The browser submits only SKU+quantity.

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  public_sku text not null,
  title text,
  quantity integer not null check (quantity > 0),
  unit_amount_cents integer not null check (unit_amount_cents >= 0),
  amount_total_cents integer not null check (amount_total_cents >= 0),
  created_at timestamptz not null default now(),
  constraint order_items_sku_not_blank_check check (btrim(public_sku) <> ''),
  constraint order_items_unique_line unique (order_id, public_sku)
);

create index if not exists order_items_order_idx on public.order_items (order_id);

-- --------------------------------------------------------------------------
-- 4. RLS: browsers never write; admins may read; service role operates
-- --------------------------------------------------------------------------

alter table public.stripe_events enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

-- Remove every default/legacy privilege first, then grant the minimum.
revoke all privileges on table public.stripe_events from anon, authenticated;
revoke all privileges on table public.orders from anon, authenticated;
revoke all privileges on table public.order_items from anon, authenticated;

grant select on table public.orders to authenticated;
grant select on table public.order_items to authenticated;
grant select on table public.stripe_events to authenticated;

drop policy if exists "Admins can read orders" on public.orders;
create policy "Admins can read orders"
on public.orders for select
to authenticated
using (public.is_admin());

drop policy if exists "Admins can read order items" on public.order_items;
create policy "Admins can read order items"
on public.order_items for select
to authenticated
using (public.is_admin());

drop policy if exists "Admins can read stripe events" on public.stripe_events;
create policy "Admins can read stripe events"
on public.stripe_events for select
to authenticated
using (public.is_admin());

-- The server-side webhook/order workflow runs as service_role. RLS is
-- bypassed for it, but explicit grants keep fresh builds reproducible.
-- No DELETE anywhere: payment history is retained.
grant select, insert, update on table public.stripe_events to service_role;
grant select, insert, update on table public.orders to service_role;
grant select, insert, update on table public.order_items to service_role;

-- No anon grants and no anon policies exist for any of these tables.

commit;

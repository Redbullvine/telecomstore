-- ============================================================================
-- Migration 008: quote-to-payment schema (CLAUDE OGT 1)
--
-- Builds on migration 20260803120000_stripe_order_tracking.sql, which already
-- provides the shared Stripe infrastructure this system reuses:
--   * public.stripe_events  — durable webhook ledger (unique event id)
--   * public.orders         — direct-checkout orders (one per session)
--   * public.order_items    — server-priced direct-checkout lines
--
-- This migration adds the QUOTE side of payments:
-- quote_requests, quote_request_items, payments, quote_status_history,
-- quote_request_notes. A paid quote is tracked on the quote_request row
-- itself (status + timestamps + Stripe ids); direct-checkout orders remain in
-- public.orders untouched.
--
-- Design rules:
--   * No supplier data is referenced or exposed anywhere in this schema.
--   * Anonymous users have NO direct table access. Customer quote submission
--     happens only through the server-side Netlify function using the service
--     role. Admin reads happen through RLS policies gated on public.is_admin().
--   * All admin mutations flow through server functions (service role) so
--     status transitions and totals are validated server-side; browser clients
--     get SELECT only.
--   * Status transitions are enforced by trigger on quote_requests.
--   * This migration does NOT touch public.products, public.orders,
--     public.stripe_events, or any other pre-existing table.
-- ============================================================================

begin;

-- --------------------------------------------------------------------------
-- 1. Quote requests (customer-submitted, admin-priced)
-- --------------------------------------------------------------------------

create table if not exists public.quote_requests (
  id uuid primary key default gen_random_uuid(),
  reference_code text not null,
  status text not null default 'new'
    check (status in ('new', 'reviewing', 'quoted', 'payment_sent', 'paid',
                      'canceled', 'refunded', 'fulfilled')),
  customer_name text not null check (btrim(customer_name) <> ''),
  customer_email text not null
    check (customer_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  customer_phone text not null check (btrim(customer_phone) <> ''),
  customer_company text,
  shipping_address jsonb not null default '{}'::jsonb
    check (jsonb_typeof(shipping_address) = 'object'),
  project_notes text,
  product_subtotal numeric(12,2) check (product_subtotal is null or product_subtotal >= 0),
  shipping_amount numeric(12,2) check (shipping_amount is null or shipping_amount >= 0),
  tax_amount numeric(12,2) check (tax_amount is null or tax_amount >= 0),
  final_total numeric(12,2) check (final_total is null or final_total >= 0),
  currency_code text not null default 'USD' check (currency_code ~ '^[A-Z]{3}$'),
  stripe_customer_id text,
  stripe_invoice_id text,
  stripe_payment_link_id text,
  stripe_payment_link_url text,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  source text not null default 'storefront'
    check (source in ('storefront', 'admin', 'direct_checkout')),
  request_ip_hash text
    check (request_ip_hash is null or request_ip_hash ~ '^[0-9a-f]{64}$'),
  quoted_by uuid references auth.users(id) on delete set null,
  quoted_at timestamptz,
  payment_sent_at timestamptz,
  paid_at timestamptz,
  canceled_at timestamptz,
  refunded_at timestamptz,
  fulfilled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quote_requests_reference_code_format_check
    check (reference_code ~ '^QR-[0-9A-Z]{8}$'),
  -- Once a final total exists, it must equal the sum of its parts.
  constraint quote_requests_total_arithmetic_check
    check (
      final_total is null
      or (
        product_subtotal is not null
        and shipping_amount is not null
        and tax_amount is not null
        and final_total = product_subtotal + shipping_amount + tax_amount
      )
    )
);

create unique index if not exists quote_requests_reference_code_idx
  on public.quote_requests (reference_code);

create index if not exists quote_requests_status_created_idx
  on public.quote_requests (status, created_at desc);

create index if not exists quote_requests_email_created_idx
  on public.quote_requests (lower(customer_email), created_at desc);

create index if not exists quote_requests_ip_created_idx
  on public.quote_requests (request_ip_hash, created_at desc)
  where request_ip_hash is not null;

create index if not exists quote_requests_stripe_invoice_idx
  on public.quote_requests (stripe_invoice_id)
  where stripe_invoice_id is not null;

create index if not exists quote_requests_stripe_session_idx
  on public.quote_requests (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

create index if not exists quote_requests_stripe_link_idx
  on public.quote_requests (stripe_payment_link_id)
  where stripe_payment_link_id is not null;

create index if not exists quote_requests_stripe_intent_idx
  on public.quote_requests (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

drop trigger if exists set_quote_requests_updated_at on public.quote_requests;
create trigger set_quote_requests_updated_at
before update on public.quote_requests
for each row execute function public.set_updated_at();

comment on table public.quote_requests is
  'Customer quote/purchase requests. Customer-facing fields only; never add supplier identity or internal commercial-terms fields.';

-- --------------------------------------------------------------------------
-- 2. Quote request items
-- --------------------------------------------------------------------------
-- Product identity fields are snapshotted server-side from the curated public
-- catalog at submission time so later catalog edits do not rewrite history.

create table if not exists public.quote_request_items (
  id uuid primary key default gen_random_uuid(),
  quote_request_id uuid not null
    references public.quote_requests(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_title text not null check (btrim(product_title) <> ''),
  product_sku text,
  manufacturer_mpn text,
  gtin text check (gtin is null or gtin ~ '^([0-9]{8}|[0-9]{12}|[0-9]{13}|[0-9]{14})$'),
  product_url text,
  quantity integer not null check (quantity > 0 and quantity <= 10000),
  unit_amount numeric(12,2) check (unit_amount is null or unit_amount >= 0),
  line_total numeric(12,2) check (line_total is null or line_total >= 0),
  created_at timestamptz not null default now()
);

create index if not exists quote_request_items_request_idx
  on public.quote_request_items (quote_request_id);

create index if not exists quote_request_items_product_idx
  on public.quote_request_items (product_id)
  where product_id is not null;

-- --------------------------------------------------------------------------
-- 3. Payments (one row per Stripe payment vehicle issued for a quote)
-- --------------------------------------------------------------------------
-- Direct-checkout payment state lives on public.orders (migration 20260803);
-- these rows track the quote-side vehicles: invoices and payment links (and
-- checkout sessions if a quote is ever paid through one).

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  quote_request_id uuid not null
    references public.quote_requests(id) on delete restrict,
  stripe_object_type text not null
    check (stripe_object_type in ('invoice', 'payment_link', 'checkout_session', 'payment_intent')),
  stripe_object_id text not null check (btrim(stripe_object_id) <> ''),
  stripe_payment_intent_id text,
  stripe_charge_id text,
  amount numeric(12,2) not null check (amount >= 0),
  currency_code text not null default 'USD' check (currency_code ~ '^[A-Z]{3}$'),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'succeeded', 'failed',
                      'canceled', 'refunded', 'partially_refunded')),
  livemode boolean not null default false,
  -- Server-only diagnostics. Never surfaced to customers.
  failure_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (stripe_object_type, stripe_object_id)
);

create index if not exists payments_quote_request_idx
  on public.payments (quote_request_id, created_at desc);

create index if not exists payments_intent_idx
  on public.payments (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

drop trigger if exists set_payments_updated_at on public.payments;
create trigger set_payments_updated_at
before update on public.payments
for each row execute function public.set_updated_at();

-- --------------------------------------------------------------------------
-- 4. Status history + internal notes
-- --------------------------------------------------------------------------

create table if not exists public.quote_status_history (
  id uuid primary key default gen_random_uuid(),
  quote_request_id uuid not null
    references public.quote_requests(id) on delete cascade,
  from_status text,
  to_status text not null,
  -- Null actor means the transition came from the system (webhook processing).
  changed_by uuid references auth.users(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists quote_status_history_request_idx
  on public.quote_status_history (quote_request_id, created_at desc);

create table if not exists public.quote_request_notes (
  id uuid primary key default gen_random_uuid(),
  quote_request_id uuid not null
    references public.quote_requests(id) on delete cascade,
  author uuid references auth.users(id) on delete set null,
  body text not null check (btrim(body) <> ''),
  created_at timestamptz not null default now()
);

create index if not exists quote_request_notes_request_idx
  on public.quote_request_notes (quote_request_id, created_at desc);

comment on table public.quote_request_notes is
  'Internal admin notes. Never included in any customer-facing output.';

-- --------------------------------------------------------------------------
-- 5. Quote status transition guard
-- --------------------------------------------------------------------------

create or replace function public.enforce_quote_status_transition()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  allowed boolean;
begin
  if old.status = new.status then
    return new;
  end if;

  allowed := case old.status
    when 'new'          then new.status in ('reviewing', 'canceled')
    when 'reviewing'    then new.status in ('quoted', 'canceled')
    when 'quoted'       then new.status in ('payment_sent', 'reviewing', 'canceled')
    when 'payment_sent' then new.status in ('paid', 'quoted', 'canceled')
    when 'paid'         then new.status in ('fulfilled', 'refunded')
    when 'fulfilled'    then new.status in ('refunded')
    when 'canceled'     then new.status in ('reviewing')
    else false -- refunded is terminal
  end;

  if not allowed then
    raise exception 'invalid quote status transition: % -> %', old.status, new.status;
  end if;

  return new;
end;
$$;

-- Trigger functions are invoked only by their trigger; nothing may call this
-- through the PostgREST RPC surface (security advisor 0028/0029).
revoke all on function public.enforce_quote_status_transition() from public;
revoke all on function public.enforce_quote_status_transition() from anon;
revoke all on function public.enforce_quote_status_transition() from authenticated;

drop trigger if exists quote_requests_status_transition on public.quote_requests;
create trigger quote_requests_status_transition
before update of status on public.quote_requests
for each row execute function public.enforce_quote_status_transition();

-- --------------------------------------------------------------------------
-- 6. RLS: quote data is private; admins read, server functions write
-- --------------------------------------------------------------------------

alter table public.quote_requests enable row level security;
alter table public.quote_request_items enable row level security;
alter table public.payments enable row level security;
alter table public.quote_status_history enable row level security;
alter table public.quote_request_notes enable row level security;

-- Admin browser clients: read-only. All mutations flow through server
-- functions (service role) so validation and transition rules always apply.
drop policy if exists "Admins can read quote requests" on public.quote_requests;
create policy "Admins can read quote requests"
on public.quote_requests for select
to authenticated
using (public.is_admin());

drop policy if exists "Admins can read quote request items" on public.quote_request_items;
create policy "Admins can read quote request items"
on public.quote_request_items for select
to authenticated
using (public.is_admin());

drop policy if exists "Admins can read payments" on public.payments;
create policy "Admins can read payments"
on public.payments for select
to authenticated
using (public.is_admin());

drop policy if exists "Admins can read quote status history" on public.quote_status_history;
create policy "Admins can read quote status history"
on public.quote_status_history for select
to authenticated
using (public.is_admin());

drop policy if exists "Admins can read quote request notes" on public.quote_request_notes;
create policy "Admins can read quote request notes"
on public.quote_request_notes for select
to authenticated
using (public.is_admin());

-- No anon policies exist on any table above. Belt-and-braces: also revoke the
-- default table privileges from anon so even a future policy mistake cannot
-- open these tables to anonymous callers.
revoke all on table public.quote_requests from anon;
revoke all on table public.quote_request_items from anon;
revoke all on table public.payments from anon;
revoke all on table public.quote_status_history from anon;
revoke all on table public.quote_request_notes from anon;

-- Authenticated non-admins are blocked by RLS; also remove write privileges so
-- the only write path is the service role used by server functions.
revoke insert, update, delete, truncate, references, trigger
  on table public.quote_requests,
           public.quote_request_items,
           public.payments,
           public.quote_status_history,
           public.quote_request_notes
  from authenticated;

commit;

-- ============================================================================
-- ROLLBACK RECIPE (reviewed down migration; run only after the payment
-- functions and admin payment pages have been removed or disabled)
-- ============================================================================
--   drop trigger quote_requests_status_transition on public.quote_requests;
--   drop function public.enforce_quote_status_transition();
--   drop table public.quote_request_notes;
--   drop table public.quote_status_history;
--   drop table public.payments;
--   drop table public.quote_request_items;
--   drop table public.quote_requests;
-- public.stripe_events, public.orders, and public.order_items belong to
-- migration 20260803120000_stripe_order_tracking.sql and are NOT touched by
-- this migration or its rollback.
-- ============================================================================

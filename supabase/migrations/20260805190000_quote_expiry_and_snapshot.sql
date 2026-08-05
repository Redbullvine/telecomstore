-- ============================================================================
-- Migration 009: quote expiration + catalog snapshot fields (CLAUDE OGT 2)
--
-- Purely additive columns on the OGT 1 quote tables:
--   * quote_requests.quote_expires_at         — admin-entered quote validity
--   * quote_requests.catalog_version          — deployed catalog identifier
--                                               (Netlify COMMIT_REF) captured
--                                               at submission time
--   * quote_requests.stripe_checkout_session_url — hosted session URL so
--                                               resend never re-creates
--   * quote_request_items.price_mode          — 'fixed'/'request_quote'
--                                               snapshot from the public
--                                               pricing bundle
--   * quote_request_items.public_unit_price   — the public price shown to the
--                                               customer at submission, when
--                                               one existed (never supplier
--                                               cost)
--
-- No RLS or privilege changes: the tables keep admin-read/service-write.
-- ============================================================================

alter table public.quote_requests
  add column if not exists quote_expires_at timestamptz,
  add column if not exists catalog_version text,
  add column if not exists stripe_checkout_session_url text;

alter table public.quote_request_items
  add column if not exists price_mode text
    check (price_mode is null or price_mode in ('fixed', 'request_quote')),
  add column if not exists public_unit_price numeric(12,2)
    check (public_unit_price is null or public_unit_price >= 0);

comment on column public.quote_requests.quote_expires_at is
  'Admin-entered expiration for the confirmed quote. Payment vehicles must not be issued after this time; re-quote instead.';
comment on column public.quote_request_items.public_unit_price is
  'Public storefront price at submission time, when one existed. Never a supplier cost.';

-- ============================================================================
-- ROLLBACK RECIPE
--   alter table public.quote_requests
--     drop column quote_expires_at, drop column catalog_version,
--     drop column stripe_checkout_session_url;
--   alter table public.quote_request_items
--     drop column price_mode, drop column public_unit_price;
-- ============================================================================

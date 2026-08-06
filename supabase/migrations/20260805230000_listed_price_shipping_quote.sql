-- Additive support for a visible merchandise price that still requires an
-- admin-confirmed shipping/tax quote before payment.
alter table public.quote_request_items
  drop constraint if exists quote_request_items_price_mode_check;

alter table public.quote_request_items
  add constraint quote_request_items_price_mode_check
  check (price_mode is null or price_mode in ('fixed', 'request_quote', 'listed_price_shipping_quote'));

-- ROLLBACK RECIPE
-- alter table public.quote_request_items drop constraint if exists quote_request_items_price_mode_check;
-- alter table public.quote_request_items add constraint quote_request_items_price_mode_check
--   check (price_mode is null or price_mode in ('fixed', 'request_quote'));

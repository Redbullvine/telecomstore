-- ============================================================================
-- DRAFT / NOT APPLIED
-- Proposed migration 006: remove shopper access to the products base table
--
-- REVIEW ONLY. Apply only after migration 005 is live and the RPC-only
-- storefront has been deployed and verified.
-- ============================================================================

begin;

-- The old policy exposes every column on available product rows. Removing it
-- leaves approved inventory users covered by their existing SELECT policy.
-- Normal authenticated users have no matching products SELECT policy and
-- therefore receive no base-table rows under RLS.
drop policy if exists "Public can read available products" on public.products;

-- Anonymous callers should not hold a base-table SELECT grant at all. They use
-- only public.get_public_product_catalog().
revoke select on table public.products from anon;

-- Keep the default authenticated table grant because inventory/admin users
-- share the authenticated database role. RLS remains the per-user boundary:
-- approved inventory users can operate on products; normal users cannot.

commit;

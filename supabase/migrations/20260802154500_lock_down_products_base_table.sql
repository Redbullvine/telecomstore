-- ============================================================================
-- Migration 006: remove shopper access to the products base table
--
-- The RPC-only storefront has been deployed and verified. Migrations 004 and
-- 005 are live. This migration removes anonymous raw-table access; shoppers
-- must use public.get_public_product_catalog(). Authenticated inventory/admin
-- access requires direct products CRUD privileges and remains protected by RLS.
-- Unapproved authenticated users remain blocked by the existing products
-- policies.
--
-- service_role bypasses RLS, but reproducible fresh builds still require
-- explicit table and function privileges. No service_role RLS policy is needed
-- or permitted. These grants do not revoke or reduce any existing production
-- service_role privilege.
--
-- Migration 006 requires separate production authorization. Do not apply this
-- file until that authorization is given.
-- ============================================================================

begin;

-- Authenticated inventory/admin workflows read, create, edit, publish, archive,
-- and hard-delete products. Grant only those table-level CRUD privileges; RLS
-- remains the per-user authorization boundary for the shared authenticated
-- database role.
grant select, insert, update, delete
on table public.products
to authenticated;

-- Server-side integrations require the same products CRUD operations in fresh
-- builds. Grant only the required privileges; do not grant TRUNCATE,
-- REFERENCES, or TRIGGER.
grant select, insert, update, delete
on table public.products
to service_role;

-- Permit trusted server-side integrations to call the same approved storefront
-- projection. service_role bypasses RLS and does not need an RLS policy.
grant execute
on function public.get_public_product_catalog()
to service_role;

-- The old policy exposes every column on available product rows. Removing it
-- leaves approved inventory users covered by their existing SELECT policy.
-- Normal authenticated users have no matching products SELECT policy and
-- therefore receive no base-table rows under RLS.
drop policy if exists "Public can read available products" on public.products;

-- Anonymous callers should not hold a base-table SELECT grant at all. They use
-- only public.get_public_product_catalog().
revoke select on table public.products from anon;

-- Approved inventory users can operate on products through the existing RLS
-- policies; normal authenticated users still receive no product rows and
-- cannot write products because they do not satisfy those policy predicates.

commit;

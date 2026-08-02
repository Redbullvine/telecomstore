-- ============================================================================
-- Correct legacy anonymous products-table privileges
--
-- Migration 006 removed anonymous SELECT access and the public shopper RLS
-- policy. Production verification then found legacy non-SELECT privileges
-- still granted directly to anon. RLS blocked anonymous writes, but the table
-- ACL must also follow least privilege.
--
-- This migration removes every anon table privilege from public.products.
-- Anonymous shoppers retain access only through
-- public.get_public_product_catalog(). Authenticated and service_role
-- privileges are not changed. Products RLS and all inventory/admin policies
-- remain unchanged. No application data or schema structure is changed.
--
-- Separate production authorization is required before applying this file.
-- ============================================================================

begin;

revoke all privileges
on table public.products
from anon;

commit;

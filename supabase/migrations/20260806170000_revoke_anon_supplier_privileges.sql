begin;

-- Anonymous shoppers must reach marketplace data only through the sanitized
-- public RPC. These explicit revokes remove Supabase's default table grants
-- from both the foundational supplier layer and the newer review layer.
revoke all privileges on table
  public.suppliers,
  public.supplier_catalog_runs,
  public.supplier_products,
  public.supplier_product_snapshots,
  public.product_supplier_offers,
  public.inventory_levels,
  public.marketplace_departments,
  public.supplier_restrictions,
  public.supplier_product_quarantine,
  public.pricing_reviews,
  public.marketplace_publications
from anon, public;

-- The foundational tables previously inherited their table privileges through
-- PUBLIC. Preserve the same effective staff/importer privileges explicitly;
-- RLS continues to restrict authenticated users to the existing inventory and
-- admin policies, while service_role retains privileged operational access.
grant all privileges on table
  public.suppliers,
  public.supplier_catalog_runs,
  public.supplier_products,
  public.supplier_product_snapshots,
  public.product_supplier_offers,
  public.inventory_levels
to authenticated, service_role;

grant all privileges on table
  public.marketplace_departments,
  public.supplier_restrictions,
  public.supplier_product_quarantine,
  public.pricing_reviews,
  public.marketplace_publications
to service_role;

commit;

-- Forward-fix rollback guidance:
-- Do not restore broad anonymous table privileges. If the public contract must
-- change, grant only the minimum required RPC/function privilege explicitly.

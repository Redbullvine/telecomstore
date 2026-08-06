import { sanitizeMarketplaceProduct } from "./marketplace-catalog.mjs";
import { isSupabaseConfigured, supabase } from "./supabase.js";

export async function fetchMarketplaceCatalog(search = "") {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase.rpc("get_public_marketplace_catalog", { p_search: String(search || "").trim() || null });
  if (error) throw new Error("Marketplace catalog is not available yet.");
  return (data || []).map(sanitizeMarketplaceProduct).filter((product) => product.sku && product.slug && product.title);
}

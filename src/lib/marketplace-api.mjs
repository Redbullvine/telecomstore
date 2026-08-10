import { sanitizeMarketplaceProduct } from "./marketplace-catalog.mjs";
import { isSupabaseConfigured, supabase } from "./supabase.js";

// The General Merchandise Shop has two publication sources, in priority order:
//
//  1. `get_public_marketplace_catalog()` — the security-definer RPC. When
//     per-item publication approvals exist in the database, it is authoritative
//     and performs the search server-side, so an internal supplier-SKU match can
//     find an approved product without ever returning that SKU.
//
//  2. `/data/marketplace-catalog.json` — the published static catalog built by
//     `scripts/build-general-merchandise-catalog.mjs` from the supplier workbook
//     and committed for the Netlify deploy. It contains ONLY the public contract
//     (no supplier SKU, no dealer cost, no MAP/MSRP); the build fails closed if a
//     private field ever reaches it.
//
// Source 2 is a deliberate change from the original "RPC only, no static
// fallback" boundary. That rule existed because nothing had been rights-cleared
// or price-approved. Petra authorized the catalog content and imagery on
// 2026-08-10 and the pricing rule is fixed in the build, so the static catalog IS
// the approved publication. It also means the shop keeps working when Supabase is
// unreachable, which matters for Google crawling.
const STATIC_CATALOG_URL = "/data/marketplace-catalog.json";
const STATIC_DETAILS_URL = "/data/marketplace-details.json";

let staticCatalogPromise = null;
let staticDetailsPromise = null;

function searchText(product) {
  return [product.title, product.brand, product.manufacturer_mpn, product.gtin, product.sku, product.subcategory, product.product_type, ...product.search_keywords]
    .join(" ")
    .toLowerCase();
}

async function loadStaticCatalog() {
  if (!staticCatalogPromise) {
    staticCatalogPromise = fetch(STATIC_CATALOG_URL, { headers: { accept: "application/json" } })
      .then((response) => {
        if (!response.ok) throw new Error(`Static catalog request failed: ${response.status}`);
        return response.json();
      })
      .then((payload) => (payload?.products || [])
        .map(sanitizeMarketplaceProduct)
        .filter((product) => product.sku && product.slug && product.title))
      .catch((error) => {
        // Clear the cache so a transient failure can be retried by the caller.
        staticCatalogPromise = null;
        throw error;
      });
  }
  return staticCatalogPromise;
}

export async function fetchMarketplaceCatalog(search = "") {
  const term = String(search || "").trim();

  if (isSupabaseConfigured) {
    try {
      const { data, error } = await supabase.rpc("get_public_marketplace_catalog", { p_search: term || null });
      if (error) throw error;
      const approved = (data || [])
        .map(sanitizeMarketplaceProduct)
        .filter((product) => product.sku && product.slug && product.title);
      // An empty result is the expected state until publication approvals are
      // recorded, so it is not treated as authoritative — fall through to the
      // published static catalog rather than showing an empty shop.
      if (approved.length) return approved;
    } catch {
      // Fall through: a database outage must not empty the storefront.
    }
  }

  const catalog = await loadStaticCatalog();
  if (!term) return catalog;
  // The static source has no server-side search, so the same match runs here.
  const needle = term.toLowerCase();
  return catalog.filter((product) => searchText(product).includes(needle));
}

// Spec bullets are excluded from the list payload because the product grid never
// renders them; they are fetched once, on demand, for product detail pages.
export async function fetchMarketplaceProductDetails(slug) {
  const key = String(slug || "");
  if (!key) return "";
  if (!staticDetailsPromise) {
    staticDetailsPromise = fetch(STATIC_DETAILS_URL, { headers: { accept: "application/json" } })
      .then((response) => {
        if (!response.ok) throw new Error(`Static details request failed: ${response.status}`);
        return response.json();
      })
      .then((payload) => payload?.details || {})
      .catch(() => {
        staticDetailsPromise = null;
        return {};
      });
  }
  const details = await staticDetailsPromise;
  return String(details[key] || "");
}

import products from "../data/custom-workwear.json" with { type: "json" };

export const WORKWEAR_PRODUCTS = Object.freeze(products);

// A design whose artwork files are not in the repository yet is held back from
// every listing, route, and feed. Without this a card would render a broken image
// and the feed would carry an item with no image_link, which Merchant Center
// rejects. Clearing `assets_pending` (once the mockups land) publishes it.
export function hasPublishableAssets(product = {}) {
  return product.assets_pending !== true && Boolean(product.image_front || product.image);
}

export const PUBLISHED_WORKWEAR_PRODUCTS = Object.freeze(products.filter(hasPublishableAssets));

// Designs waiting on artwork, so the gap stays visible rather than silent.
export const PENDING_ASSET_PRODUCTS = Object.freeze(products.filter((product) => product.assets_pending === true));
export const WORKWEAR_SUBCATEGORIES = Object.freeze(["Construction Shirts", "Safety Vests", "Jackets", "Hard Hats", "Company Apparel"]);
export const LOGO_PLACEMENTS = Object.freeze(["Left Chest", "Full Front", "Back", "Front + Back"]);
export const CUSTOMIZATION_METHODS = Object.freeze(["Screen Print", "Embroidery", "Heat Transfer", "Review My Artwork"]);

export const WORKWEAR_PRICING_MODEL = Object.freeze({
  base_price: "approved",
  size_upcharge: null,
  color_style_upcharge: null,
  premium_product_upcharge: null,
  logo_placement_upcharge: null,
  second_location_upcharge: null,
  customization_method_upcharge: null,
  artwork_setup_fee: null,
  quantity_discount: null
});

export function isWorkwearPath(path = "") {
  return path === "/custom-workwear" || path.startsWith("/custom-workwear/");
}

export function workwearProductPath(product) {
  return `/custom-workwear/products/${product.slug}`;
}

export function resolveWorkwearRoute(path = "") {
  const clean = String(path).replace(/\/+$/, "") || "/custom-workwear";
  if (clean === "/custom-workwear") return { kind: "department" };
  const prefix = "/custom-workwear/products/";
  if (clean.startsWith(prefix)) {
    const slug = decodeURIComponent(clean.slice(prefix.length));
    // Only a product with artwork resolves; a design still awaiting mockups 404s
    // rather than rendering a page with a broken image.
    return { kind: "product", product: PUBLISHED_WORKWEAR_PRODUCTS.find((item) => item.slug === slug) || null };
  }
  return { kind: "not_found" };
}

export function searchWorkwearProducts(query = "", subcategory = "All") {
  const needle = String(query).trim().toLowerCase();
  return PUBLISHED_WORKWEAR_PRODUCTS.filter((product) => {
    if (subcategory !== "All" && product.subcategory !== subcategory) return false;
    if (!needle) return true;
    return [product.name, product.collection, product.subcategory, product.description, ...(product.search_keywords || []), ...product.colors, ...product.styles]
      .join(" ").toLowerCase().includes(needle);
  });
}

// --- Approved fixed-price variants (Apparel Phase 1) -------------------------
//
// Danny approved S–XL of the four finished TS-* novelty tees as fixed-price
// direct-purchase variants at $24.99 (2026-08-12). 2XL–5XL stay quote-only
// because their extended-size upcharge has never been approved, so they carry no
// price and are never advertised.
//
// A product only qualifies when it is a finished Telecom Store design
// (`customizable: false`, `owned_design: true`) AND declares `approved_sizes`
// with an `approved_price`. That keeps every CW-* customer-logo item on quote by
// construction rather than by a list that could drift.
export const APPROVED_TEE_SIZES = Object.freeze(["S", "M", "L", "XL"]);

export function isApprovedFixedPriceProduct(product = {}) {
  return product.customizable === false
    && product.owned_design === true
    && Array.isArray(product.approved_sizes)
    && product.approved_sizes.length > 0
    && Number(product.approved_price) > 0;
}

export function isApprovedVariant(product = {}, size = "") {
  if (!isApprovedFixedPriceProduct(product)) return false;
  return product.approved_sizes.includes(String(size));
}

// The exact selling price for an approved variant, or null when the size still
// needs a quote. Never falls back to base_price for an unapproved size.
export function variantPrice(product = {}, size = "") {
  return isApprovedVariant(product, size) ? Number(product.approved_price) : null;
}

export function workwearVariantId(product = {}, size = "") {
  return `${product.sku}-${String(size)}`;
}

export function workwearVariantPath(product = {}, size = "") {
  const base = workwearProductPath(product);
  return size ? `${base}?size=${encodeURIComponent(size)}` : base;
}

// Only a size the product actually offers is accepted; anything else falls back
// to the first size so a bad or stale link still renders a usable page.
export function resolveSizeParam(product = {}, search = "") {
  const sizes = Array.isArray(product.sizes) ? product.sizes : [];
  const requested = new URLSearchParams(String(search || "")).get("size");
  if (requested && sizes.includes(requested)) return requested;
  return sizes[0] || "";
}

// --- Packaged shipping weight ------------------------------------------------
//
// Garment-only weights come from the Bella + Canvas 3001 published spec. They are
// NOT shipping weights: the mailer has to be added. `package_weight_oz` is only
// ever set from a documented packaging specification for the mailer this shop
// actually uses, so while it is null this returns null and the variant is kept out
// of the Google feed rather than shipped with a guessed weight.
export function packagedWeightLb(product = {}, size = "") {
  // An explicit per-size shipping weight, supplied and signed off by Danny
  // (2026-08-13), takes precedence. These are the Bella + Canvas garment weights
  // converted to pounds; they do NOT include the mailer. That is acceptable here
  // because FedEx rates everything under 1 lb in a single band, so the mailer's
  // fraction of an ounce does not change the quoted cost. If packaging ever gets
  // heavier — a box, a multi-pack — this needs revisiting.
  const declared = Number(product.shipping_weight_lb?.[String(size)]);
  if (Number.isFinite(declared) && declared > 0) return Math.round(declared * 100) / 100;

  // Otherwise a weight only exists once a packaging specification is documented;
  // garment weight alone is never promoted to a shipping weight.
  const garmentOz = Number(product.garment_weight_oz?.[String(size)]);
  const packageOz = Number(product.package_weight_oz);
  if (!(garmentOz > 0)) return null;
  if (!Number.isFinite(packageOz) || packageOz <= 0) return null;
  return Math.round(((garmentOz + packageOz) / 16) * 100) / 100;
}

// Direct checkout requires more than an approved price: the server-side row must
// be shippable, which needs the packaged weight. Until that exists, a Buy button
// would create a Stripe session that fails the shipping check in
// netlify/functions/_shared/checkout-core.mjs, so the variant stays on quote and
// the cart path lights up automatically once the weight is supplied.
// Direct checkout needs a Stripe shipping rate as well as a price and a weight:
// netlify/functions/_shared/checkout-core.mjs rejects any line without
// stripe_shipping_rate_id with "not configured for shipping". No apparel rate
// exists yet, so this stays false and the storefront keeps the quote flow rather
// than showing a Buy button that would fail at the Stripe session. Flip it once
// the rate IDs are populated, and the cart path is already built behind it.
export const APPAREL_CHECKOUT_ENABLED = false;

export function apparelCheckoutReady(product = {}, size = "") {
  return APPAREL_CHECKOUT_ENABLED
    && isApprovedVariant(product, size)
    && packagedWeightLb(product, size) !== null;
}

// --- Collection grouping ------------------------------------------------------
//
// The four lineworker tees are variations on one theme, so listing them flat made
// the department read as "a bunch of the same shirt". Grouping by collection keeps
// them in a single section, and more designs can join it without crowding out the
// rest of the range.
export function groupWorkwearByCollection(products = []) {
  const groups = [];
  const index = new Map();
  for (const product of products) {
    const name = product.collection || "Custom Products";
    if (!index.has(name)) {
      index.set(name, { collection: name, ownedDesign: product.owned_design === true, products: [] });
      groups.push(index.get(name));
    }
    const group = index.get(name);
    group.products.push(product);
    // A collection is only treated as an own-design range if every item is one.
    if (product.owned_design !== true) group.ownedDesign = false;
  }
  return groups;
}

export function startingPriceLabel(product) {
  const price = Number(product.base_price);
  return price > 0 ? `Starting at $${price.toFixed(2)}` : "Request Quote";
}

// The label for a specific selected size: an exact price for an approved variant,
// otherwise the quote wording. Used so the landing page never shows "Starting at"
// against a size that has a real fixed price.
export function selectedPriceLabel(product = {}, size = "") {
  const price = variantPrice(product, size);
  return price === null ? "Request Quote" : `$${price.toFixed(2)}`;
}

// Everything still needs a quote EXCEPT an approved fixed-price variant.
export function configurationNeedsQuote(product = {}, configuration = {}) {
  return !isApprovedVariant(product, configuration?.size);
}

export function workwearQuoteItem(product, configuration) {
  const normalized = {
    color: configuration.color || null,
    size: configuration.size || null,
    style: configuration.style || null,
    logo_placement: configuration.logo_placement || null,
    customization_method: configuration.customization_method || null,
    company_name: String(configuration.company_name || "").trim() || null,
    artwork_reference: configuration.artwork_reference || null,
    artwork_filename: configuration.artwork_filename || null,
    customer_notes: String(configuration.customer_notes || "").trim() || null
  };
  const signature = Object.values(normalized).join("|");
  return {
    key: `workwear:${product.sku}:${signature}`,
    sku: product.sku,
    name: product.name,
    category: "Custom Workwear & Safety Gear",
    qty: Math.max(1, Math.trunc(Number(configuration.quantity) || 1)),
    public_price: null,
    base_price: product.base_price,
    price_mode: "request_quote",
    notes: normalized.customer_notes || "",
    configuration: normalized,
    artwork_reference: normalized.artwork_reference
  };
}

export function workwearMetadata(route) {
  const product = route.kind === "product" ? route.product : null;
  const title = product ? `${product.name} | Custom Workwear | Telecom Store` : "Custom Workwear & Safety Gear | Telecom Store";
  const description = product?.description || "Shop custom construction shirts, reflective shirts, safety vests, hard hats, work jackets, contractor workwear, and company uniforms with logo customization.";
  const path = product ? workwearProductPath(product) : "/custom-workwear";
  return {
    title,
    description,
    canonical: `https://telecomstore.net${path}`,
    schemas: [{
      "@context": "https://schema.org",
      "@type": product ? "Product" : "CollectionPage",
      name: product?.name || "Custom Workwear & Safety Gear",
      description,
      url: `https://telecomstore.net${path}`,
      ...(product ? {
        sku: product.sku,
        image: `https://telecomstore.net${product.image}`,
        ...(Number(product.base_price) > 0 ? { offers: { "@type": "AggregateOffer", lowPrice: product.base_price, priceCurrency: "USD" } } : {})
      } : {})
    }]
  };
}

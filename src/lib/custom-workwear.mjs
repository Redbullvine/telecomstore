import products from "../data/custom-workwear.json" with { type: "json" };

export const WORKWEAR_PRODUCTS = Object.freeze(products);
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
    return { kind: "product", product: WORKWEAR_PRODUCTS.find((item) => item.slug === slug) || null };
  }
  return { kind: "not_found" };
}

export function searchWorkwearProducts(query = "", subcategory = "All") {
  const needle = String(query).trim().toLowerCase();
  return WORKWEAR_PRODUCTS.filter((product) => {
    if (subcategory !== "All" && product.subcategory !== subcategory) return false;
    if (!needle) return true;
    return [product.name, product.collection, product.subcategory, product.description, ...product.colors, ...product.styles]
      .join(" ").toLowerCase().includes(needle);
  });
}

export function startingPriceLabel(product) {
  const price = Number(product.base_price);
  return price > 0 ? `Starting at $${price.toFixed(2)}` : "Request Quote";
}

export function configurationNeedsQuote() {
  return true;
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

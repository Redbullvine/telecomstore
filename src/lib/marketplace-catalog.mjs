import { MARKETPLACE_DEPARTMENTS, MARKETPLACE_SITE_URL, marketplaceDepartment } from "../config/marketplace.mjs";

const PRODUCT_PREFIX = "/shop/products/";

export function isMarketplacePath(path) {
  return String(path || "").replace(/\/+$/, "") === "/shop" || String(path || "").startsWith("/shop/");
}

export function marketplaceProductPath(product) {
  return `${PRODUCT_PREFIX}${product.slug}`;
}

export function marketplaceDepartmentPath(department) {
  return `/shop/${department.slug}`;
}

export function resolveMarketplaceRoute(path, products = []) {
  const clean = String(path || "/shop").replace(/\/+$/, "") || "/shop";
  if (clean === "/shop") return { kind: "marketplace_home" };
  if (clean.startsWith(PRODUCT_PREFIX)) {
    const slug = decodeURIComponent(clean.slice(PRODUCT_PREFIX.length));
    return { kind: "marketplace_product", product: products.find((item) => item.slug === slug) || null };
  }
  const department = marketplaceDepartment(decodeURIComponent(clean.slice("/shop/".length)));
  if (department) return { kind: "marketplace_department", department };
  return { kind: "marketplace_not_found" };
}

export function sanitizeMarketplaceProduct(row = {}) {
  const priceMode = row.price_mode === "fixed" ? "fixed" : "request_quote";
  const publicPrice = priceMode === "fixed" && Number(row.public_price) > 0 ? Number(row.public_price) : null;
  const slug = String(row.slug || "");
  return {
    id: row.id || "",
    sku: String(row.sku || ""),
    slug,
    canonical_path: slug ? `${PRODUCT_PREFIX}${slug}` : "",
    brand: String(row.brand || ""),
    title: String(row.title || ""),
    manufacturer_mpn: String(row.manufacturer_mpn || ""),
    gtin: String(row.gtin || ""),
    department_slug: String(row.department_slug || ""),
    department_name: String(row.department_name || ""),
    category: String(row.department_name || ""),
    subcategory: String(row.subcategory || ""),
    short_description: String(row.short_description || ""),
    long_description: String(row.long_description || ""),
    search_keywords: Array.isArray(row.search_keywords) ? row.search_keywords.map(String) : [],
    availability_text: String(row.availability || "Availability by quote"),
    clearance: row.clearance === true,
    price_mode: priceMode,
    public_price: publicPrice,
    pricing_approved: publicPrice !== null,
    currency_code: String(row.currency_code || "USD"),
    image_url: String(row.image_url || ""),
    image_alt: String(row.image_alt || ""),
    meta_title: String(row.meta_title || ""),
    meta_description: String(row.meta_description || ""),
    published_at: row.published_at || null,
    updated_at: row.updated_at || null,
  };
}

export function filterMarketplaceProducts(products, filters = {}) {
  const query = String(filters.query || "").trim().toLowerCase();
  const department = filters.department || "all";
  const subcategory = filters.subcategory || "all";
  const brand = filters.brand || "all";
  const availability = filters.availability || "all";
  const priceRange = filters.priceRange || "all";
  const deals = filters.deals === true;
  const matchesPrice = (price) => {
    if (priceRange === "under-25") return price !== null && price < 25;
    if (priceRange === "25-100") return price !== null && price >= 25 && price <= 100;
    if (priceRange === "100-500") return price !== null && price > 100 && price <= 500;
    if (priceRange === "over-500") return price !== null && price > 500;
    if (priceRange === "request-price") return price === null;
    return true;
  };
  const result = products.filter((product) => {
    const searchText = [product.title, product.brand, product.manufacturer_mpn, product.gtin, product.subcategory, ...product.search_keywords].join(" ").toLowerCase();
    return (!query || searchText.includes(query))
      && (department === "all" || product.department_slug === department)
      && (subcategory === "all" || product.subcategory === subcategory)
      && (brand === "all" || product.brand === brand)
      && (availability === "all" || (availability === "priced" ? product.public_price !== null : product.public_price === null))
      && (!deals || product.clearance)
      && matchesPrice(product.public_price);
  });
  return [...result].sort((a, b) => {
    if (filters.sort === "name") return a.title.localeCompare(b.title);
    if (filters.sort === "price-low") return (a.public_price ?? Number.POSITIVE_INFINITY) - (b.public_price ?? Number.POSITIVE_INFINITY) || a.title.localeCompare(b.title);
    if (filters.sort === "price-high") return (b.public_price ?? -1) - (a.public_price ?? -1) || a.title.localeCompare(b.title);
    if (filters.sort === "newest") return new Date(b.published_at || 0) - new Date(a.published_at || 0);
    return `${a.brand}${a.title}`.localeCompare(`${b.brand}${b.title}`);
  });
}

function breadcrumb(items) {
  return { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: items.map(([name, path], index) => ({ "@type": "ListItem", position: index + 1, name, item: `${MARKETPLACE_SITE_URL}${path}` })) };
}

export function marketplaceMetadata(route, productCount = 0) {
  const base = {
    title: "Telecom Store Marketplace | Shop the Whole Internet",
    description: "Browse approved Telecom Store Marketplace products by department, brand, product name, and exact manufacturer part number.",
    canonical: `${MARKETPLACE_SITE_URL}/shop`,
    noindex: productCount === 0,
    schemas: [{ "@context": "https://schema.org", "@type": "WebSite", name: "Telecom Store Marketplace", url: `${MARKETPLACE_SITE_URL}/shop` }],
  };
  if (route.kind === "marketplace_department" && route.department) {
    const path = marketplaceDepartmentPath(route.department);
    return { ...base, title: `${route.department.name} | Telecom Store Marketplace`, canonical: `${MARKETPLACE_SITE_URL}${path}`, schemas: [...base.schemas, breadcrumb([["Marketplace", "/shop"], [route.department.name, path]])] };
  }
  if (route.kind === "marketplace_product" && route.product) {
    const product = route.product;
    const path = marketplaceProductPath(product);
    const schema = { "@context": "https://schema.org", "@type": "Product", name: product.title, sku: product.sku, mpn: product.manufacturer_mpn, brand: { "@type": "Brand", name: product.brand }, category: product.department_name, description: product.long_description || product.short_description, url: `${MARKETPLACE_SITE_URL}${path}` };
    if (product.image_url) schema.image = [product.image_url];
    if (product.public_price !== null) schema.offers = { "@type": "Offer", priceCurrency: product.currency_code, price: product.public_price, availability: "https://schema.org/InStock", url: `${MARKETPLACE_SITE_URL}${path}` };
    if (/^\d{12}$/.test(product.gtin)) schema.gtin12 = product.gtin;
    if (/^\d{13}$/.test(product.gtin)) schema.gtin13 = product.gtin;
    if (/^\d{14}$/.test(product.gtin)) schema.gtin14 = product.gtin;
    return { ...base, noindex: false, title: product.meta_title || `${product.title} | Telecom Store Marketplace`, description: product.meta_description || product.short_description, canonical: `${MARKETPLACE_SITE_URL}${path}`, schemas: [...base.schemas, schema, breadcrumb([["Marketplace", "/shop"], [product.department_name, `/shop/${product.department_slug}`], [product.title, path]])] };
  }
  return base;
}

export { MARKETPLACE_DEPARTMENTS };

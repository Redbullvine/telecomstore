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
  const title = String(row.title || "");
  const shortDescription = String(row.short_description || "");
  const brand = String(row.brand || "");
  // The published list payload omits these three because each is the title or
  // short description plus a fixed suffix. Deriving them here keeps the record
  // shape identical for callers whether the source is the RPC or the static
  // catalog, and keeps ~0.7 MB of duplicated text off the wire.
  const metaTitle = String(row.meta_title || "") || (title ? `${title} | Telecom Store Marketplace` : "");
  const metaDescription = String(row.meta_description || "")
    || (shortDescription ? `${shortDescription} Buy ${brand || "this item"} at Telecom Store.`.slice(0, 320) : "");
  const imageAlt = String(row.image_alt || "") || (title ? `${title} product image` : "");
  return {
    id: row.id || "",
    sku: String(row.sku || ""),
    slug,
    canonical_path: slug ? `${PRODUCT_PREFIX}${slug}` : "",
    brand,
    title,
    manufacturer_mpn: String(row.manufacturer_mpn || ""),
    gtin: String(row.gtin || ""),
    // Google Shopping attributes: condition and category are required/strongly
    // recommended by Merchant Center, and product_type carries our taxonomy.
    condition: row.condition === "refurbished" ? "refurbished" : "new",
    google_product_category: String(row.google_product_category || ""),
    product_type: String(row.product_type || ""),
    department_slug: String(row.department_slug || ""),
    department_name: String(row.department_name || ""),
    category: String(row.department_name || ""),
    subcategory: String(row.subcategory || ""),
    short_description: shortDescription,
    long_description: String(row.long_description || ""),
    search_keywords: Array.isArray(row.search_keywords) ? row.search_keywords.map(String) : [],
    availability_text: String(row.availability || "Availability by quote"),
    // Derived availability, kept identical to what the Google feed submits so the
    // landing page and Merchant Center never disagree.
    availability_state: ["in_stock", "out_of_stock", "backorder", "preorder"].includes(row.availability_state) ? row.availability_state : "",
    availability_date: String(row.availability_date || ""),
    clearance: row.clearance === true,
    price_mode: priceMode,
    public_price: publicPrice,
    pricing_approved: publicPrice !== null,
    currency_code: String(row.currency_code || "USD"),
    image_url: String(row.image_url || ""),
    image_alt: imageAlt,
    meta_title: metaTitle,
    meta_description: metaDescription,
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
  // "deals" is a cross-cutting department: no product carries it as a
  // department_slug, so /shop/deals must select clearance stock instead of
  // matching the slug — otherwise the page can only ever render empty.
  const dealsDepartment = department === "deals";
  const result = products.filter((product) => {
    const searchText = [product.title, product.brand, product.manufacturer_mpn, product.gtin, product.subcategory, product.product_type, ...product.search_keywords].join(" ").toLowerCase();
    return (!query || searchText.includes(query))
      && (department === "all" || dealsDepartment || product.department_slug === department)
      && (!dealsDepartment || product.clearance)
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
    const schema = { "@context": "https://schema.org", "@type": "Product", name: product.title, sku: product.sku, mpn: product.manufacturer_mpn, brand: { "@type": "Brand", name: product.brand }, category: product.product_type || product.department_name, description: product.long_description || product.short_description, url: `${MARKETPLACE_SITE_URL}${path}` };
    // schema.org image must be absolute for Google to resolve it; the catalog
    // stores a first-party proxy path.
    if (product.image_url) {
      schema.image = [/^https?:\/\//i.test(product.image_url) ? product.image_url : `${MARKETPLACE_SITE_URL}${product.image_url}`];
    }
    // Google cross-checks the landing page against the Shopping feed, so stock
    // state and condition are derived rather than asserted as always-in-stock.
    schema.itemCondition = product.condition === "refurbished" ? "https://schema.org/RefurbishedCondition" : "https://schema.org/NewCondition";
    if (product.public_price !== null) {
      schema.offers = {
        "@type": "Offer",
        priceCurrency: product.currency_code,
        price: product.public_price,
        availability: {
          in_stock: "https://schema.org/InStock",
          backorder: "https://schema.org/BackOrder",
          preorder: "https://schema.org/PreOrder",
          out_of_stock: "https://schema.org/OutOfStock",
        }[product.availability_state] || (/^In stock/i.test(product.availability_text) ? "https://schema.org/InStock" : "https://schema.org/OutOfStock"),
        ...(product.availability_date ? { availabilityStarts: product.availability_date } : {}),
        itemCondition: schema.itemCondition,
        url: `${MARKETPLACE_SITE_URL}${path}`,
      };
    }
    if (/^\d{12}$/.test(product.gtin)) schema.gtin12 = product.gtin;
    if (/^\d{13}$/.test(product.gtin)) schema.gtin13 = product.gtin;
    if (/^\d{14}$/.test(product.gtin)) schema.gtin14 = product.gtin;
    return { ...base, noindex: false, title: product.meta_title || `${product.title} | Telecom Store Marketplace`, description: product.meta_description || product.short_description, canonical: `${MARKETPLACE_SITE_URL}${path}`, schemas: [...base.schemas, schema, breadcrumb([["Marketplace", "/shop"], [product.department_name, `/shop/${product.department_slug}`], [product.title, path]])] };
  }
  return base;
}

export { MARKETPLACE_DEPARTMENTS };

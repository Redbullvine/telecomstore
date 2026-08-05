import { CATALOG_CATEGORIES, CATALOG_MANUFACTURERS, CATALOG_SITE_URL } from "../config/catalog.mjs";

const PRODUCT_PREFIX = "/products/";
const CATEGORY_PREFIX = "/categories/";
const MANUFACTURER_PREFIX = "/manufacturers/";

export function productPath(product) {
  return `${PRODUCT_PREFIX}${product.slug}`;
}

export function categoryPath(category) {
  return `${CATEGORY_PREFIX}${category.slug}`;
}

export function manufacturerPath(manufacturer) {
  return `${MANUFACTURER_PREFIX}${manufacturer.slug}`;
}

export function resolveStorefrontRoute(path, products = []) {
  const cleanPath = String(path || "/").replace(/\/+$/, "") || "/";
  if (cleanPath === "/") return { kind: "home" };
  if (cleanPath.startsWith(PRODUCT_PREFIX)) {
    const slug = decodeURIComponent(cleanPath.slice(PRODUCT_PREFIX.length));
    return { kind: "product", product: products.find((item) => item.slug === slug) || null };
  }
  if (cleanPath.startsWith(CATEGORY_PREFIX)) {
    const slug = decodeURIComponent(cleanPath.slice(CATEGORY_PREFIX.length));
    return { kind: "category", category: CATALOG_CATEGORIES.find((item) => item.slug === slug) || null };
  }
  if (cleanPath.startsWith(MANUFACTURER_PREFIX)) {
    const slug = decodeURIComponent(cleanPath.slice(MANUFACTURER_PREFIX.length));
    return { kind: "manufacturer", manufacturer: CATALOG_MANUFACTURERS.find((item) => item.slug === slug) || null };
  }
  return { kind: "not_found" };
}

export function relatedProducts(product, products, limit = 4) {
  if (!product) return [];
  return products
    .filter((item) => item.sku !== product.sku)
    .map((item) => ({
      item,
      score: Number(item.category === product.category) * 3 + Number(item.brand === product.brand) * 2
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title))
    .slice(0, limit)
    .map(({ item }) => item);
}

export function storefrontMetadata(route) {
  const base = {
    title: "Telecom Store | Telecom Parts by MPN and GTIN",
    description: "Search 206 telecom products by manufacturer, category, MPN, or GTIN. Build a quote list and confirm current pricing, availability, and shipping.",
    canonical: `${CATALOG_SITE_URL}/`,
    schemas: [{
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "Telecom Store",
      url: `${CATALOG_SITE_URL}/`
    }]
  };

  if (route.kind === "product" && route.product) {
    const product = route.product;
    const canonical = `${CATALOG_SITE_URL}${productPath(product)}`;
    return {
      title: product.meta_title,
      description: product.meta_description,
      canonical,
      schemas: [...base.schemas, {
        "@context": "https://schema.org",
        "@type": "Product",
        name: product.title,
        sku: product.sku,
        mpn: product.manufacturer_mpn,
        gtin12: product.gtin,
        brand: { "@type": "Brand", name: product.brand },
        category: product.category,
        description: product.long_description,
        url: canonical
      }, breadcrumbSchema([
        ["Home", "/"],
        [product.category, categoryPath(CATALOG_CATEGORIES.find((item) => item.name === product.category))],
        [product.title, productPath(product)]
      ])]
    };
  }

  if (route.kind === "category" && route.category) {
    return landingMetadata(base, route.category.name, route.category.description, categoryPath(route.category));
  }
  if (route.kind === "manufacturer" && route.manufacturer) {
    const description = `Browse ${route.manufacturer.count} ${route.manufacturer.name} telecom products by exact manufacturer part number, then request a quote for the items you need.`;
    return landingMetadata(base, `${route.manufacturer.name} Products`, description, manufacturerPath(route.manufacturer));
  }
  return base;
}

function landingMetadata(base, heading, description, path) {
  return {
    title: `${heading} | Telecom Store`,
    description,
    canonical: `${CATALOG_SITE_URL}${path}`,
    schemas: [...base.schemas, breadcrumbSchema([["Home", "/"], [heading, path]])]
  };
}

function breadcrumbSchema(items) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map(([name, path], index) => ({
      "@type": "ListItem",
      position: index + 1,
      name,
      item: `${CATALOG_SITE_URL}${path}`
    }))
  };
}

export function applyStorefrontMetadata(metadata) {
  document.title = metadata.title;
  setMeta("name", "description", metadata.description);
  setMeta("property", "og:title", metadata.title);
  setMeta("property", "og:description", metadata.description);
  setMeta("property", "og:url", metadata.canonical);
  let canonical = document.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement("link");
    canonical.rel = "canonical";
    document.head.append(canonical);
  }
  canonical.href = metadata.canonical;
  document.querySelectorAll("script[data-storefront-schema]").forEach((node) => node.remove());
  metadata.schemas.forEach((schema) => {
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.dataset.storefrontSchema = "true";
    script.textContent = JSON.stringify(schema).replace(/</g, "\\u003c");
    document.head.append(script);
  });
}

function setMeta(attribute, key, content) {
  let element = document.querySelector(`meta[${attribute}="${key}"]`);
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, key);
    document.head.append(element);
  }
  element.content = content;
}

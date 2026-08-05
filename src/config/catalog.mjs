import taxonomy from "../data/catalog-taxonomy.json" with { type: "json" };

export const CATALOG_SITE_URL = "https://telecomstore.net";
export const CATALOG_CATEGORIES = taxonomy.categories;
export const CATALOG_MANUFACTURERS = taxonomy.manufacturers;
export const STORE_CAT_ORDER = CATALOG_CATEGORIES.map((category) => category.name);

export function slugifyCatalogValue(value = "") {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function categoryConfig(name) {
  return CATALOG_CATEGORIES.find((category) => category.name === name) || {
    name: name || "Telecom Products",
    slug: slugifyCatalogValue(name || "telecom-products"),
    color: "#4f6575",
    description: "Browse manufacturer-identified telecom products and request a quote for current availability."
  };
}

export function manufacturerConfig(name) {
  return CATALOG_MANUFACTURERS.find((manufacturer) => manufacturer.name === name) || {
    name: name || "Manufacturer",
    slug: slugifyCatalogValue(name || "manufacturer"),
    count: 0
  };
}

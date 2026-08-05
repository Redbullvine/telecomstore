import imageRestrictions from "../data/image-restrictions.json" with { type: "json" };

const AVAILABILITY_LABELS = {
  in_stock: "In Stock",
  out_of_stock: "Out of Stock",
  backorder: "Backorder",
  quote_only: "Availability by Quote"
};

export function supportedConditionLabel(product = {}) {
  return String(product.condition || "").trim();
}

export function storefrontBadgeLabel(product = {}) {
  const condition = supportedConditionLabel(product);
  if (condition) return condition;

  return AVAILABILITY_LABELS[product.public_availability] || "Availability by Quote";
}

export function storefrontImageSource(product = {}) {
  const blockedProduct = imageRestrictions.blocked_products.includes(product.sku);
  const blockedBrand = imageRestrictions.blocked_brands.some((brand) => brand.toLowerCase() === String(product.brand || "").toLowerCase());
  const isPetraImage = /^https:\/\/s3\.us-east-2\.amazonaws\.com\/petraimages\.com\//i.test(product.photo_main || "");
  const primary = isPetraImage && (blockedProduct || blockedBrand) ? "" : product.photo_main;
  return primary || product.photo_label || product.photo_extra_1 || product.photo_extra_2 || "";
}

export function storefrontImageAlt(product = {}) {
  const identity = [product.brand, product.title].filter(Boolean).join(" ").trim() || "Telecom product";
  const mpn = String(product.manufacturer_mpn || product.sku || "").trim();
  return `${identity}${mpn ? ` (${mpn})` : ""} product image`;
}

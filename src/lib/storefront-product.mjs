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
  return product.photo_main || product.photo_label || product.photo_extra_1 || product.photo_extra_2 || "";
}

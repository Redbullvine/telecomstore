// ============================================================================
// Apparel Phase 1: expand the approved finished tees into per-size variants.
//
// One module feeds both the Google feed builder and the server-side trusted
// checkout catalog, so an advertised price can never disagree with the price
// checkout charges.
//
// Only S–XL of the four finished TS-* designs are approved at a fixed $24.99
// (Danny, 2026-08-12). 2XL–5XL have no approved extended-size upcharge, so they
// carry no price, are never advertised, and stay quote-only.
//
// shipping_weight is emitted ONLY when a documented package weight exists.
// Bella + Canvas publishes shirt-only weights, which are not shipping weights —
// the mailer must be added from a real packaging specification. While
// `package_weight_oz` is null every variant is withheld from the feed rather than
// shipped with an invented weight.
// ============================================================================

import products from "../../src/data/custom-workwear.json" with { type: "json" };
import {
  APPROVED_TEE_SIZES,
  hasPublishableAssets,
  isApprovedFixedPriceProduct,
  isApprovedVariant,
  packagedWeightLb,
  variantPrice,
  workwearVariantId,
  workwearVariantPath,
} from "../../src/lib/custom-workwear.mjs";

export const APPAREL_SITE_URL = "https://telecomstore.net";
export const APPAREL_GOOGLE_CATEGORY = "Apparel & Accessories > Clothing > Shirts & Tops";

// A design must be both price-approved AND have its artwork present. Google
// rejects an item without a fetchable image_link, so a design still awaiting
// mockups is never advertised.
export function approvedApparelProducts(all = products) {
  return all.filter((product) => isApprovedFixedPriceProduct(product) && hasPublishableAssets(product));
}

// One record per approved design/size. `shipping_weight_lb` is null until a
// package weight is documented, and `feed_eligible` reflects that directly.
export function apparelVariants(all = products) {
  const variants = [];
  for (const product of approvedApparelProducts(all)) {
    // Colour comes from the product's own single colourway; nothing is inferred.
    const color = Array.isArray(product.colors) && product.colors.length === 1 ? product.colors[0] : "";
    for (const size of product.approved_sizes) {
      if (!isApprovedVariant(product, size)) continue;
      const weight = packagedWeightLb(product, size);
      variants.push({
        id: workwearVariantId(product, size),
        item_group_id: product.sku,
        sku: product.sku,
        title: `${product.name}, ${color}, ${size}`,
        description: product.description,
        link: `${APPAREL_SITE_URL}${workwearVariantPath(product, size)}`,
        image_link: `${APPAREL_SITE_URL}${product.image_front}`,
        additional_image_link: `${APPAREL_SITE_URL}${product.image_back}`,
        price: variantPrice(product, size),
        currency: "USD",
        availability: "in_stock",
        condition: product.condition || "new",
        brand: product.brand || "Telecom Store",
        // Telecom Store's own printed apparel has no manufacturer GTIN or MPN, so
        // Google's identifier_exists=no is the correct declaration.
        identifier_exists: false,
        color,
        size,
        gender: product.gender || "unisex",
        age_group: product.age_group || "adult",
        google_product_category: product.google_product_category || APPAREL_GOOGLE_CATEGORY,
        shipping_weight_lb: weight,
        feed_eligible: weight !== null,
      });
    }
  }
  return variants;
}

// Only variants with a documented packaged weight may be advertised.
export function feedEligibleApparelVariants(all = products) {
  return apparelVariants(all).filter((variant) => variant.feed_eligible);
}

// Sizes that exist on an approved product but are NOT approved for a fixed price.
// Reported so it stays visible that they are deliberately withheld.
export function quoteOnlyApparelSizes(all = products) {
  const rows = [];
  for (const product of approvedApparelProducts(all)) {
    for (const size of product.sizes || []) {
      if (!isApprovedVariant(product, size)) rows.push({ sku: product.sku, size });
    }
  }
  return rows;
}

const escapeXml = (input) => String(input ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

// Google item XML. `item_group_title` is deliberately NOT emitted — it is not a
// Merchant Center attribute and would be ignored.
export function apparelItemXml(variant) {
  return [
    "    <item>",
    `      <g:id>${escapeXml(variant.id)}</g:id>`,
    `      <g:item_group_id>${escapeXml(variant.item_group_id)}</g:item_group_id>`,
    `      <g:title>${escapeXml(variant.title.slice(0, 150))}</g:title>`,
    `      <g:description>${escapeXml(variant.description)}</g:description>`,
    `      <g:link>${escapeXml(variant.link)}</g:link>`,
    `      <g:image_link>${escapeXml(variant.image_link)}</g:image_link>`,
    `      <g:additional_image_link>${escapeXml(variant.additional_image_link)}</g:additional_image_link>`,
    `      <g:price>${Number(variant.price).toFixed(2)} ${escapeXml(variant.currency)}</g:price>`,
    `      <g:availability>${escapeXml(variant.availability)}</g:availability>`,
    `      <g:condition>${escapeXml(variant.condition)}</g:condition>`,
    `      <g:brand>${escapeXml(variant.brand)}</g:brand>`,
    "      <g:identifier_exists>no</g:identifier_exists>",
    `      <g:color>${escapeXml(variant.color)}</g:color>`,
    `      <g:size>${escapeXml(variant.size)}</g:size>`,
    `      <g:gender>${escapeXml(variant.gender)}</g:gender>`,
    `      <g:age_group>${escapeXml(variant.age_group)}</g:age_group>`,
    `      <g:google_product_category>${escapeXml(variant.google_product_category)}</g:google_product_category>`,
    `      <g:shipping_weight>${Number(variant.shipping_weight_lb).toFixed(2)} lb</g:shipping_weight>`,
    "    </item>",
  ].join("\n");
}

// Rows for the server-side trusted checkout catalog. The browser sends only
// {sku, quantity}; every commercial value is resolved from here.
export function apparelCommerceRows(all = products) {
  return apparelVariants(all).map((variant) => ({
    public_sku: variant.id,
    title: variant.title,
    public_price: variant.price,
    price_mode: "fixed",
    pricing_approved: true,
    // Checkout stays inactive until the variant is shippable: checkout-core also
    // requires a shipping class and a Stripe shipping rate, so activating it
    // earlier would create sessions that fail the shipping check.
    checkout_active: variant.feed_eligible,
    shipping_class: variant.feed_eligible ? "apparel_parcel" : "manual_quote",
    ship_weight_lb: variant.shipping_weight_lb,
    taxable: true,
    automatic_tax: false,
    stripe_price_id: null,
    stripe_shipping_rate_id: null,
    allowed_countries: variant.feed_eligible ? ["US"] : [],
    item_group_id: variant.item_group_id,
    size: variant.size,
    color: variant.color,
  }));
}

export { APPROVED_TEE_SIZES };

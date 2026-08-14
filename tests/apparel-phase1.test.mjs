import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import products from "../src/data/custom-workwear.json" with { type: "json" };
import {
  apparelCommerceRows,
  apparelItemXml,
  apparelVariants,
  feedEligibleApparelVariants,
  quoteOnlyApparelSizes,
} from "../scripts/lib/apparel-feed.mjs";
import {
  APPROVED_TEE_SIZES,
  apparelCheckoutReady,
  configurationNeedsQuote,
  groupWorkwearByCollection,
  isApprovedVariant,
  packagedWeightLb,
  resolveSizeParam,
  selectedPriceLabel,
  variantPrice,
  workwearVariantPath,
  PENDING_ASSET_PRODUCTS,
  PUBLISHED_WORKWEAR_PRODUCTS,
  hasPublishableAssets,
  resolveWorkwearRoute,
  searchWorkwearProducts,
} from "../src/lib/custom-workwear.mjs";

const TS_SKUS = products.filter((item) => item.approved_sizes && item.approved_price && item.assets_pending !== true).map((item) => item.sku);
const EXPECTED_VARIANTS = TS_SKUS.length * 4;
const EXTENDED = ["2XL", "3XL", "4XL", "5XL"];
const tee = (sku) => products.find((item) => item.sku === sku);

test("1. exactly 16 approved Google apparel variants, four designs by four sizes", () => {
  const variants = apparelVariants();
  assert.equal(variants.length, EXPECTED_VARIANTS);
  assert.deepEqual([...new Set(variants.map((v) => v.item_group_id))].sort(), [...TS_SKUS].sort());
  for (const sku of TS_SKUS) {
    const sizes = variants.filter((v) => v.item_group_id === sku).map((v) => v.size);
    assert.deepEqual(sizes, ["S", "M", "L", "XL"], `${sku} must expand to S-XL only`);
  }
  // Every id is unique, since Google keys on it.
  assert.equal(new Set(variants.map((v) => v.id)).size, EXPECTED_VARIANTS);
  assert.deepEqual(
    variants.filter((v) => v.item_group_id === "TS-PRO-POLE-DANCER").map((v) => v.id),
    ["TS-PRO-POLE-DANCER-S", "TS-PRO-POLE-DANCER-M", "TS-PRO-POLE-DANCER-L", "TS-PRO-POLE-DANCER-XL"],
  );
});

test("2. no 2XL-5XL variant is ever built or advertised", () => {
  const variants = apparelVariants();
  for (const size of EXTENDED) {
    assert.equal(variants.filter((v) => v.size === size).length, 0, `${size} must not be a feed variant`);
    for (const sku of TS_SKUS) {
      assert.equal(isApprovedVariant(tee(sku), size), false);
      assert.equal(variantPrice(tee(sku), size), null, `${size} must carry no price`);
    }
  }
  // The extended sizes still exist on the product, deliberately quote-only.
  assert.equal(quoteOnlyApparelSizes().length, TS_SKUS.length * 4);
});

test("3. item_group_id groups the four sizes of each design", () => {
  const groups = new Map();
  for (const variant of apparelVariants()) {
    groups.set(variant.item_group_id, (groups.get(variant.item_group_id) || 0) + 1);
  }
  assert.equal(groups.size, TS_SKUS.length);
  for (const [sku, count] of groups) assert.equal(count, 4, `${sku} should group 4 sizes`);
});

test("4. identifier_exists is no, and no GTIN or MPN is invented", () => {
  for (const variant of apparelVariants()) {
    assert.equal(variant.identifier_exists, false);
    assert.ok(!("gtin" in variant), "no GTIN may be fabricated");
    assert.ok(!("mpn" in variant), "no MPN may be fabricated");
  }
  // The emitted XML declares it explicitly for Google.
  const xml = apparelItemXml({ ...apparelVariants()[0], shipping_weight_lb: 0.5 });
  assert.match(xml, /<g:identifier_exists>no<\/g:identifier_exists>/);
  assert.doesNotMatch(xml, /<g:gtin>|<g:mpn>/);
});

test("5. size and colour match the product's real colourway", () => {
  const expected = Object.fromEntries(products.filter((item) => TS_SKUS.includes(item.sku)).map((item) => [item.sku, item.colors.length === 1 ? item.colors[0] : ""]));
  for (const variant of apparelVariants()) {
    assert.equal(variant.color, expected[variant.item_group_id]);
    assert.ok(APPROVED_TEE_SIZES.includes(variant.size));
    assert.equal(variant.gender, "unisex");
    assert.equal(variant.age_group, "adult");
    assert.equal(variant.condition, "new");
    assert.equal(variant.brand, "Telecom Store");
    assert.equal(variant.google_product_category, "Apparel & Accessories > Clothing > Shirts & Tops");
  }
});

test("6. every S-XL variant is exactly $24.99", () => {
  for (const variant of apparelVariants()) assert.equal(variant.price, 24.99);
  for (const sku of TS_SKUS) {
    for (const size of APPROVED_TEE_SIZES) {
      assert.equal(variantPrice(tee(sku), size), 24.99);
      assert.equal(selectedPriceLabel(tee(sku), size), "$24.99");
    }
    // An unapproved size shows quote wording, never the fixed price.
    assert.equal(selectedPriceLabel(tee(sku), "3XL"), "Request Quote");
  }
});

test("7. variant URLs deep-link a size and validate the parameter", () => {
  const product = tee("TS-PRO-POLE-DANCER");
  assert.equal(workwearVariantPath(product, "L"), "/custom-workwear/products/professional-pole-dancer-utility-division-t-shirt?size=L");
  // A valid size is honoured.
  assert.equal(resolveSizeParam(product, "?size=XL"), "XL");
  // Anything the product does not offer falls back to the first size, so a stale
  // feed link still renders a usable page instead of an empty selection.
  assert.equal(resolveSizeParam(product, "?size=99XL"), "S");
  assert.equal(resolveSizeParam(product, "?size="), "S");
  assert.equal(resolveSizeParam(product, ""), "S");
  // The feed link always carries the size it advertises.
  for (const variant of apparelVariants()) {
    assert.match(variant.link, new RegExp(`\\?size=${variant.size}$`));
  }
});

test("8. approved sizes are the only ones eligible for direct checkout", () => {
  for (const sku of TS_SKUS) {
    for (const size of APPROVED_TEE_SIZES) {
      assert.equal(configurationNeedsQuote(tee(sku), { size }), false, `${sku} ${size} should be purchasable`);
    }
  }
  const rows = apparelCommerceRows();
  assert.equal(rows.length, EXPECTED_VARIANTS);
  for (const row of rows) {
    assert.equal(row.public_price, 24.99);
    assert.equal(row.price_mode, "fixed");
    assert.equal(row.pricing_approved, true);
  }
});

test("9. 2XL-5XL remain quote-only", () => {
  for (const sku of TS_SKUS) {
    for (const size of EXTENDED) {
      assert.equal(configurationNeedsQuote(tee(sku), { size }), true, `${sku} ${size} must need a quote`);
      assert.equal(apparelCheckoutReady(tee(sku), size), false);
    }
  }
  // No extended size reaches the trusted checkout catalog at all.
  assert.equal(apparelCommerceRows().filter((row) => EXTENDED.includes(row.size)).length, 0);
});

test("10. the nine CW-* customer-logo products remain untouched", () => {
  const cw = products.filter((item) => item.sku.startsWith("CW-"));
  assert.equal(cw.length, 9);
  for (const item of cw) {
    // No fixed-price approval, so they can never be purchased directly or fed.
    assert.equal(item.approved_sizes, undefined);
    assert.equal(item.approved_price, undefined);
    assert.equal(configurationNeedsQuote(item, { size: item.sizes?.[0] || "" }), true);
    assert.equal(apparelCheckoutReady(item, item.sizes?.[0] || ""), false);
  }
  const fedSkus = new Set(apparelVariants().map((v) => v.item_group_id));
  for (const item of cw) assert.equal(fedSkus.has(item.sku), false, `${item.sku} must not be advertised`);
});

test("11. image_link uses the front crop", () => {
  for (const variant of apparelVariants()) {
    assert.match(variant.image_link, /-front\.png$/);
    assert.match(variant.image_link, /^https:\/\/telecomstore\.net\/images\/custom-workwear\//);
    const local = variant.image_link.replace("https://telecomstore.net", "public");
    assert.ok(fs.existsSync(local), `${local} must exist`);
  }
});

test("12. additional_image_link uses the back crop, and originals still exist", () => {
  for (const variant of apparelVariants()) {
    assert.match(variant.additional_image_link, /-back\.png$/);
    const local = variant.additional_image_link.replace("https://telecomstore.net", "public");
    assert.ok(fs.existsSync(local), `${local} must exist`);
  }
  // The original composites are preserved, not replaced by the crops.
  for (const sku of TS_SKUS) {
    const original = `public${tee(sku).image}`;
    assert.ok(fs.existsSync(original), `${original} must be preserved`);
  }
});

test("13. shipping_weight comes from a declared figure, never a guess", () => {
  // Per-size shipping weights supplied and signed off by Danny 2026-08-13.
  const DECLARED = { S: 0.24, M: 0.28, L: 0.3, XL: 0.33 };
  for (const sku of TS_SKUS) {
    const product = tee(sku);
    assert.deepEqual(product.shipping_weight_lb, DECLARED, `${sku} must carry the declared weights`);
    assert.deepEqual(product.garment_weight_oz, { S: 3.9, M: 4.4, L: 4.8, XL: 5.3 });
    for (const size of APPROVED_TEE_SIZES) {
      assert.equal(packagedWeightLb(product, size), DECLARED[size]);
    }
  }
  // Every advertised variant carries a real weight, and the feed reflects it.
  assert.equal(feedEligibleApparelVariants().length, apparelVariants().length);
  for (const variant of apparelVariants()) assert.ok(variant.shipping_weight_lb > 0);
  const xml = fs.readFileSync("public/feeds/google-shopping.xml", "utf8");
  assert.match(xml, /<g:shipping_weight>0\.24 lb<\/g:shipping_weight>/);

  // The core protection still holds: with no declared weight and no documented
  // packaging spec, garment weight alone must NOT become a shipping weight.
  const noDeclared = { ...tee(TS_SKUS[0]), shipping_weight_lb: undefined, package_weight_oz: null };
  assert.equal(packagedWeightLb(noDeclared, "S"), null, "garment weight alone must never be promoted");
  // And a documented mailer allowance is added to the garment weight.
  assert.equal(packagedWeightLb({ ...noDeclared, package_weight_oz: 0.5 }, "S"), 0.28); // (3.9 + 0.5) / 16
});

test("apparel checkout stays gated until a Stripe shipping rate exists", () => {
  // A price and a weight are not sufficient: checkout-core also demands
  // stripe_shipping_rate_id, so a Buy button would 409 without it.
  for (const sku of TS_SKUS) {
    for (const size of APPROVED_TEE_SIZES) {
      assert.equal(apparelCheckoutReady(tee(sku), size), false, `${sku} ${size} must not offer direct checkout yet`);
    }
  }
  for (const row of apparelCommerceRows()) {
    assert.equal(row.checkout_active, false, "no apparel row may be checkout-active without a shipping rate");
    assert.equal(row.stripe_shipping_rate_id, null);
  }
});

test("the lineworker tees group into a single collection section", () => {
  const groups = groupWorkwearByCollection(products);
  const lineworker = groups.find((group) => group.collection === "Telecom Store Lineworker Collection");
  assert.ok(lineworker, "the tees must share one collection");
  assert.equal(lineworker.products.length, 4);
  assert.equal(lineworker.ownedDesign, true);
  // The customer-logo range is a separate section and is not an own-design range.
  const neutral = groups.find((group) => group.collection === "Neutral Collection");
  assert.ok(neutral && neutral.products.length > 0);
  assert.equal(neutral.ownedDesign, false);
});

test("new designs awaiting artwork are staged, never published or advertised", () => {
  // The 12 designs from Danny's design sheets are recorded but held back: without
  // mockup files a card renders a broken image and Google rejects the item.
  assert.ok(PENDING_ASSET_PRODUCTS.length > 0);
  for (const product of PENDING_ASSET_PRODUCTS) {
    assert.equal(hasPublishableAssets(product), false);
    assert.equal(product.image_front, null);
    assert.equal(product.image_back, null);
    // Not in the live catalog, not routable, not searchable, not advertised.
    assert.ok(!PUBLISHED_WORKWEAR_PRODUCTS.some((item) => item.sku === product.sku), `${product.sku} must not be published`);
    assert.equal(resolveWorkwearRoute(`/custom-workwear/products/${product.slug}`).product, null);
    assert.equal(searchWorkwearProducts(product.name).length, 0);
    assert.ok(!apparelVariants().some((v) => v.item_group_id === product.sku), `${product.sku} must not be a feed variant`);
  }
  // The live catalog is unchanged at 13, and the feed still has only the four
  // designs whose artwork exists.
  assert.equal(PUBLISHED_WORKWEAR_PRODUCTS.length, 13 + TS_SKUS.length - 4);
  assert.equal(apparelVariants().length, EXPECTED_VARIANTS);
});

test("staged designs carry full Google attributes ready for launch", () => {
  for (const product of PENDING_ASSET_PRODUCTS) {
    assert.equal(product.brand, "Telecom Store");
    assert.equal(product.gender, "unisex");
    assert.equal(product.age_group, "adult");
    assert.equal(product.condition, "new");
    assert.equal(product.identifier_exists, false);
    assert.equal(product.google_product_category, "Apparel & Accessories > Clothing > Shirts & Tops");
    assert.equal(product.approved_price, 24.99);
    assert.deepEqual(product.approved_sizes, ["S", "M", "L", "XL"]);
    assert.equal(product.package_weight_oz, null, "no packaging weight may be invented");
    assert.equal(product.garment.model, "3001");
    assert.ok(product.colors.length > 0, "every design records its real colourway");
    assert.ok(product.print_saying, "the printed saying is recorded");
  }
  // Adding artwork paths is the only step needed to publish one.
  assert.ok(PENDING_ASSET_PRODUCTS.every((p) => p.collection === "Telecom Funny Tees"));
});

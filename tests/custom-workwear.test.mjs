import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import products from "../src/data/custom-workwear.json" with { type: "json" };
import { validateArtworkBytes } from "../netlify/lib/workwear-artwork.mjs";
import { cleanWorkwearConfiguration, validateWorkwearSelection } from "../netlify/lib/workwear.mjs";
import { buildQuoteItemSnapshot } from "../netlify/functions/submit-quote-request.mjs";
import {
  WORKWEAR_PRICING_MODEL,
  PUBLISHED_WORKWEAR_PRODUCTS,
  configurationNeedsQuote,
  resolveWorkwearRoute,
  searchWorkwearProducts,
  startingPriceLabel,
  workwearProductPath
} from "../src/lib/custom-workwear.mjs";

test("custom workwear catalog contains thirteen public product concepts and truthful pricing states", () => {
  assert.equal(PUBLISHED_WORKWEAR_PRODUCTS.length, 13 + products.filter((item) => item.collection === "Telecom Funny Tees" && item.assets_pending !== true).length);
  // The original thirteen concepts must still be present at their approved
  // prices. This is a subset check rather than an exact list, because the
  // catalog now grows as new finished designs get their artwork.
  const priceBySku = new Map(PUBLISHED_WORKWEAR_PRODUCTS.map((item) => [item.name, item.base_price]));
  for (const [name, price] of [
    ["Custom Logo T-Shirt", 19.99], ["Custom Company Ball Cap", 19.99],
    ["Professional Pole Dancer — Utility Division T-Shirt", 24.99],
    ["Certified Pole Dancer — Utility Division T-Shirt", 24.99],
    ["Pole Dancing Pays the Bills — Utility Division T-Shirt", 24.99],
    ["I Pole Dance for a Living — Utility Division T-Shirt", 24.99],
    ["Custom Hard Hat", 29.99], ["Custom Work Jacket", 64.99], ["Custom Work Vest", 34.99],
    ["Custom Hi-Vis Reflective Construction Shirt", 34.99], ["Custom Hi-Vis Hard Hat", 29.99], ["Custom Hi-Vis Work Jacket", 79.99], ["Custom Hi-Vis Safety Vest", 24.99]
  ]) {
    assert.equal(priceBySku.get(name), price, `${name} must keep its approved price`);
  }
  for (const product of PUBLISHED_WORKWEAR_PRODUCTS.filter((item) => item.base_price)) assert.match(startingPriceLabel(product), /^Starting at \$\d+\.\d{2}$/);
  for (const product of PUBLISHED_WORKWEAR_PRODUCTS.filter((item) => !item.base_price)) assert.equal(startingPriceLabel(product), "Request Quote");
  const cap = PUBLISHED_WORKWEAR_PRODUCTS.find((item) => item.sku === "CW-COMPANY-CAP");
  assert.equal(startingPriceLabel(cap), "Starting at $19.99");
  assert.equal(cap.starting_configuration, "Basic adjustable ball cap with one standard customer logo in the front-center placement.");
  for (const sku of ["TS-PRO-POLE-DANCER", "TS-CERT-POLE-DANCER", "TS-POLE-PAYS-BILLS", "TS-POLE-DANCE-LIVING"]) {
    const shirt = PUBLISHED_WORKWEAR_PRODUCTS.find((item) => item.sku === sku);
    assert.equal(startingPriceLabel(shirt), "Starting at $24.99");
    assert.match(shirt.starting_configuration, /Least-expensive approved/);
  }
});

test("every workwear product has a generated local image and dedicated route", () => {
  for (const product of PUBLISHED_WORKWEAR_PRODUCTS) {
    assert.equal(fs.existsSync(`public${product.image}`), true, product.image);
    assert.equal(resolveWorkwearRoute(workwearProductPath(product)).product?.sku, product.sku);
  }
});

test("search finds workwear by product, department, color, and style", () => {
  assert.equal(searchWorkwearProducts("hard hat").length, 2);
  assert.equal(searchWorkwearProducts("safety orange").length, 3);
  assert.equal(searchWorkwearProducts("long sleeve").length, 1);
  assert.equal(searchWorkwearProducts("jacket", "Jackets").length, 2);
  for (const phrase of ["ball cap", "cap", "custom cap", "company cap", "logo cap", "embroidered cap"]) {
    assert.deepEqual(searchWorkwearProducts(phrase).map((item) => item.sku), ["CW-COMPANY-CAP"], phrase);
  }
  assert.deepEqual(searchWorkwearProducts("professional pole dancer").map((item) => item.sku), ["TS-PRO-POLE-DANCER"]);
  assert.equal(searchWorkwearProducts("utility division").filter((item) => item.owned_design).length, 4);
});

test("unverified pole-dancer artwork stays private and under a rights hold", () => {
  const publicCatalog = fs.readFileSync("src/data/custom-workwear.json", "utf8");
  const serverCatalog = fs.readFileSync("netlify/functions/_shared/workwear-catalog.json", "utf8");
  const sitemap = fs.readFileSync("public/sitemap.xml", "utf8");
  const review = JSON.parse(fs.readFileSync("operations/workwear-artwork-rights-review.json", "utf8"));
  for (const publicSurface of [publicCatalog, serverCatalog, sitemap]) {
    assert.doesNotMatch(publicSurface, /support-your-local-pole-dancer/i);
    assert.doesNotMatch(publicSurface, /TS-POLE-DANCER-TEE/);
  }
  assert.equal(fs.existsSync("public/images/custom-workwear/support-your-local-pole-dancer-t-shirt.png"), false);
  assert.equal(review.status, "ARTWORK RIGHTS REVIEW REQUIRED");
  assert.equal(review.public_catalog_eligible, false);
  assert.equal(review.public_image_eligible, false);
});

test("unapproved configuration fees force quote review instead of a guessed checkout price", () => {
  assert.equal(configurationNeedsQuote(), true);
  for (const [key, value] of Object.entries(WORKWEAR_PRICING_MODEL)) {
    if (key !== "base_price") assert.equal(value, null, key);
  }
});

test("workwear selection is allowlisted server-side", () => {
  const row = { department: "custom_workwear", colors: ["Black"], sizes: ["S", "M"], styles: ["Crew Neck T-Shirt"] };
  const valid = cleanWorkwearConfiguration({ color: "Black", size: "M", style: "Crew Neck T-Shirt", logo_placement: "Left Chest", customization_method: "Screen Print", company_name: "Example Crew" });
  assert.equal(validateWorkwearSelection(row, valid), true);
  assert.equal(validateWorkwearSelection(row, { ...valid, color: "<script>" }), false);
  assert.equal(validateWorkwearSelection(row, { ...valid, logo_placement: "Free second location" }), false);
  const standardDesign = { department: "custom_workwear", customizable: false, colors: ["Black"], sizes: ["S"], styles: ["Crew Neck T-Shirt"] };
  const designConfig = cleanWorkwearConfiguration({ color: "Black", size: "S", style: "Crew Neck T-Shirt", logo_placement: "Front Design", customization_method: "Printed Design" });
  assert.equal(validateWorkwearSelection(standardDesign, designConfig), true);
  assert.equal(validateWorkwearSelection(standardDesign, { ...designConfig, logo_placement: "Left Chest" }), false);
  const cap = { department: "custom_workwear", colors: ["Black"], sizes: [], styles: ["Adjustable Ball Cap"], logo_placements: ["Front Center"], customization_methods: ["Embroidery"] };
  const capConfig = cleanWorkwearConfiguration({ color: "Black", size: null, style: "Adjustable Ball Cap", logo_placement: "Front Center", customization_method: "Embroidery" });
  assert.equal(validateWorkwearSelection(cap, capConfig), true);
  assert.equal(validateWorkwearSelection(cap, { ...capConfig, logo_placement: "Left Chest" }), false);
});

test("quote snapshot keeps approved starting price separate from unapproved configured price", () => {
  const row = { public_sku: "CW-LOGO-TEE", title: "Custom Logo T-Shirt", department: "custom_workwear", base_price: 19.99, price_mode: "request_quote" };
  const configuration = { color: "Black", size: "L", style: "Crew Neck T-Shirt", logo_placement: "Left Chest", customization_method: "Screen Print" };
  const snapshot = buildQuoteItemSnapshot(row, 12, { configuration, artwork_reference: null });
  assert.equal(snapshot.base_unit_price, "19.99");
  assert.equal(snapshot.public_unit_price, null);
  assert.equal(snapshot.price_mode, "request_quote");
  assert.deepEqual(snapshot.configuration, configuration);
});

test("artwork validation checks bytes, not just filename or declared MIME", () => {
  assert.equal(validateArtworkBytes(Uint8Array.from([137,80,78,71,13,10,26,10,0]), "image/png").ok, true);
  assert.equal(validateArtworkBytes(Uint8Array.from([255,216,255,0]), "image/jpeg").ok, true);
  assert.equal(validateArtworkBytes(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>'), "image/svg+xml").ok, true);
  assert.equal(validateArtworkBytes(new TextEncoder().encode('<svg><script>alert(1)</script></svg>'), "image/svg+xml").ok, false);
  assert.equal(validateArtworkBytes(new TextEncoder().encode("MZ executable"), "image/png").ok, false);
});

test("routing and storage stay narrow and private", () => {
  const netlify = fs.readFileSync("netlify.toml", "utf8");
  const migration = fs.readFileSync("supabase/migrations/20260807120000_custom_workwear_quote_configuration.sql", "utf8");
  assert.match(netlify, /from = "\/custom-workwear\/\*"[\s\S]*?to = "\/index\.html"/);
  assert.match(migration, /'workwear-artwork'[\s\S]*?false/);
  assert.doesNotMatch(migration, /create policy[\s\S]*(anon|authenticated)/i);
  const upload = fs.readFileSync("netlify/functions/upload-workwear-artwork.mjs", "utf8");
  assert.match(upload, /rateLimit:[\s\S]*windowLimit: 5[\s\S]*aggregateBy: \["ip", "domain"\]/);
});

test("customer-facing implementation keeps required upload and price phrases", () => {
  const component = fs.readFileSync("src/components/workwear/CustomWorkwearStorefront.jsx", "utf8");
  const catalog = fs.readFileSync("src/lib/custom-workwear.mjs", "utf8");
  assert.match(component, /Upload your company logo and we&apos;ll customize this item for your crew\./);
  assert.match(component, /Artwork subject to review before production\./);
  assert.match(component, /WorkwearHomepageShelf/);
  assert.match(catalog, /Starting at \$/);
});

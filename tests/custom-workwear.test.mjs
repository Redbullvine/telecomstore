import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { validateArtworkBytes } from "../netlify/lib/workwear-artwork.mjs";
import { cleanWorkwearConfiguration, validateWorkwearSelection } from "../netlify/lib/workwear.mjs";
import { buildQuoteItemSnapshot } from "../netlify/functions/submit-quote-request.mjs";
import {
  WORKWEAR_PRICING_MODEL,
  WORKWEAR_PRODUCTS,
  configurationNeedsQuote,
  resolveWorkwearRoute,
  searchWorkwearProducts,
  startingPriceLabel,
  workwearProductPath
} from "../src/lib/custom-workwear.mjs";

test("custom workwear catalog contains ten approved product concepts and truthful pricing states", () => {
  assert.equal(WORKWEAR_PRODUCTS.length, 10);
  assert.deepEqual(WORKWEAR_PRODUCTS.map((item) => [item.name, item.base_price]), [
    ["Custom Logo T-Shirt", 19.99], ["Support Your Local Pole Dancer T-Shirt", 24.99], ["Custom Company Ball Cap", null],
    ["Custom Hard Hat", 29.99], ["Custom Work Jacket", 64.99], ["Custom Work Vest", 34.99],
    ["Custom Hi-Vis Reflective Construction Shirt", 34.99], ["Custom Hi-Vis Hard Hat", 29.99], ["Custom Hi-Vis Work Jacket", 79.99], ["Custom Hi-Vis Safety Vest", 24.99]
  ]);
  for (const product of WORKWEAR_PRODUCTS.filter((item) => item.base_price)) assert.match(startingPriceLabel(product), /^Starting at \$\d+\.\d{2}$/);
  assert.equal(startingPriceLabel(WORKWEAR_PRODUCTS.find((item) => item.sku === "CW-COMPANY-CAP")), "Request Quote");
});

test("every workwear product has a generated local image and dedicated route", () => {
  for (const product of WORKWEAR_PRODUCTS) {
    assert.equal(fs.existsSync(`public${product.image}`), true, product.image);
    assert.equal(resolveWorkwearRoute(workwearProductPath(product)).product?.sku, product.sku);
  }
});

test("search finds workwear by product, department, color, and style", () => {
  assert.equal(searchWorkwearProducts("hard hat").length, 2);
  assert.equal(searchWorkwearProducts("safety orange").length, 3);
  assert.equal(searchWorkwearProducts("long sleeve").length, 1);
  assert.equal(searchWorkwearProducts("jacket", "Jackets").length, 2);
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

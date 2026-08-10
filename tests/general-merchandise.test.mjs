import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  ALLOWED_PUBLIC_KEYS,
  assertPublicRecordClean,
  availabilityText,
  buildCatalog,
  buildPublicRecord,
  GOOGLE_CATEGORY_BY_DEPARTMENT,
  parseSpecBullets,
  normalizeImageUrl,
  productType,
  recoverGtin,
  resolveDepartment,
  supplierSkuInCopy,
} from "../scripts/lib/general-merchandise.mjs";
import { filterMarketplaceProducts, sanitizeMarketplaceProduct } from "../src/lib/marketplace-catalog.mjs";

// A representative workbook row: Petra's real column names and shapes.
const row = (patch = {}) => ({
  "VENDOR SKU": "K02-U22GE-02",
  "PETRA SKU": "1KSK02U22GE02",
  DESCRIPTION: "EPI236 AIR PURIFIER BLK",
  AVAILABLE: 12,
  PRICE: 91.99,
  "BRAND NAME": "ELECHOMES",
  "PRODUCT CLASS": "Tools & Home Improvement",
  UPC: 6970684277620,
  "LONG DESC": "Elechomes K02-U22GE-02 Smart Sensor HEPA Air Purifier (Black)",
  KEYWORDS: "Smart Sensor HEPA Air Purifier (Black)",
  SPECS: "&bull; 50 watt power draw;&bull; Covers 280 sq. ft.;",
  SUBCATEGORY: "Heating & Cooling",
  SUBCATEGORY2: "Air Quality",
  NOTES1: "",
  REFURB: "N",
  MAP: 0,
  MSRP: 109.99,
  "IMAGE URL": "http://petraimages.com.s3.amazonaws.com/600x600/1KSK02U22GE02.jpg",
  ...patch,
});

test("the published price is the dealer cost doubled, with MAP as a floor", () => {
  assert.equal(buildPublicRecord(row()).record.public_price, 183.98);
  // MAP above the doubled cost wins; MAP below it does not.
  assert.equal(buildPublicRecord(row({ PRICE: 10, MAP: 25 })).record.public_price, 25);
  assert.equal(buildPublicRecord(row({ PRICE: 10, MAP: 15 })).record.public_price, 20);
  // Cents are rounded, never truncated.
  assert.equal(buildPublicRecord(row({ PRICE: 1.117, MAP: 0 })).record.public_price, 2.23);
});

test("a row with no usable cost is published as request-a-quote, not guessed", () => {
  const built = buildPublicRecord(row({ PRICE: 0 }));
  assert.equal(built.record.public_price, null);
  assert.equal(built.record.price_mode, "request_quote");
});

test("the MSRP cap is opt-in and never prices below the MAP floor", () => {
  // Default: doubling stands even when it exceeds MSRP.
  assert.equal(buildPublicRecord(row()).record.public_price, 183.98);
  // Opt in: capped at MSRP.
  assert.equal(buildPublicRecord(row(), 0, { capAtMsrp: true }).record.public_price, 109.99);
  // Doubling already under MSRP is left alone.
  assert.equal(buildPublicRecord(row({ PRICE: 20, MSRP: 100 }), 0, { capAtMsrp: true }).record.public_price, 40);
  // MAP outranks the cap, so the price stays at MAP rather than dropping under it.
  assert.equal(buildPublicRecord(row({ PRICE: 10, MAP: 90, MSRP: 50 }), 0, { capAtMsrp: true }).record.public_price, 90);
});

test("the MSRP cap never prices below the dealer cost", () => {
  // 25 workbook rows have a dealer cost above MSRP; capping them at MSRP would
  // sell at a loss, so the cap is skipped and the row is flagged.
  const belowCost = row({ PRICE: 54.99, MSRP: 31, MAP: 0 });
  const built = buildPublicRecord(belowCost, 0, { capAtMsrp: true });
  assert.equal(built.record.public_price, 109.98, "must keep the doubled price, not drop to MSRP");
  assert.ok(built.record.public_price > 54.99, "published price must clear the dealer cost");
  assert.ok(built.flags.includes("msrp_below_cost_cap_skipped"));
  // A near-miss (MSRP a few cents under cost) is treated the same way.
  assert.equal(buildPublicRecord(row({ PRICE: 21.99, MSRP: 21.95 }), 0, { capAtMsrp: true }).record.public_price, 43.98);
});

test("no supplier-private field ever reaches a published record", () => {
  const { record } = buildPublicRecord(row());
  for (const key of Object.keys(record)) assert.ok(ALLOWED_PUBLIC_KEYS.includes(key), `unexpected key ${key}`);
  const serialized = JSON.stringify({ ...record, image_url: "", image_alt: "" });
  assert.doesNotMatch(serialized, /1KSK02U22GE02/, "supplier SKU must not appear");
  assert.doesNotMatch(serialized, /91\.99/, "dealer cost must not appear");
  assert.doesNotMatch(serialized, /109\.99/, "MSRP must not appear");
  assert.equal(assertPublicRecordClean(record, row()), true);
});

test("the boundary check rejects a supplier key or a cost published as the price", () => {
  const { record } = buildPublicRecord(row());
  assert.throws(() => assertPublicRecordClean({ ...record, supplier_cost: 91.99 }, row()), /unexpected keys/i);
  assert.throws(() => assertPublicRecordClean({ ...record, public_price: 91.99 }, row()), /dealer cost/i);
  // The public SKU must be the manufacturer part number, never the Petra SKU.
  assert.throws(() => assertPublicRecordClean({ ...record, sku: "1KSK02U22GE02" }, row()), /supplier SKU/i);
});

test("a Petra SKU equal to the manufacturer part number is not treated as a leak", () => {
  // Axis-style row: vendor and Petra SKU are the same manufacturer number, and
  // the manufacturer prints it in its own title.
  const axis = row({
    "VENDOR SKU": "41361",
    "PETRA SKU": "41361",
    "LONG DESC": "Axis 41361 6-Foot Y-Adapter Cable",
    KEYWORDS: "6-Foot Y-Adapter Cable",
    SPECS: "",
    UPC: "",
  });
  const { record, flags } = buildPublicRecord(axis);
  assert.equal(record.sku, "41361");
  assert.ok(flags.includes("supplier_sku_matches_mpn"));
  assert.equal(assertPublicRecordClean(record, axis), true);
});

test("a supplier cross-reference number in supplier copy is flagged, not fatal", () => {
  const erp = row({
    "VENDOR SKU": "2183141",
    "PETRA SKU": "ER2183141",
    "BRAND NAME": "ERP(R)",
    "LONG DESC": "ERP 2183141 Replacement Handle End Cap",
    KEYWORDS: "Replacement Handle End Cap",
    SPECS: "&bull; Cross reference numbers include ER2183141;",
    UPC: "",
  });
  const { record } = buildPublicRecord(erp);
  assert.equal(assertPublicRecordClean(record, erp), true);
  assert.equal(supplierSkuInCopy(record, erp), true);
});

test("GTIN recovery restores Excel's dropped leading zero and rejects the unverifiable", () => {
  // An 11-digit value is a UPC-12 that lost its leading zero in the spreadsheet.
  assert.deepEqual(recoverGtin("86844413619"), { gtin: "086844413619", valid: true, basis: "leading_zero_restored" });
  // A value that already validates is passed through untouched.
  assert.equal(recoverGtin(6970684277620).basis, "as_supplied");
  // Padding that still fails the check digit is refused rather than published.
  assert.deepEqual(recoverGtin("12345"), { gtin: "", valid: false, basis: "unrecoverable" });
  assert.equal(recoverGtin("").valid, false);
  // Only a checksum-valid GTIN is ever published.
  assert.equal(buildPublicRecord(row({ UPC: "12345" })).record.gtin, "");
});

test("Petra product classes map onto the public departments", () => {
  assert.equal(resolveDepartment(row({ "PRODUCT CLASS": "Kitchen" })).slug, "home-kitchen");
  assert.equal(resolveDepartment(row({ "PRODUCT CLASS": "TVs & Projectors" })).slug, "electronics");
  assert.equal(resolveDepartment(row({ "PRODUCT CLASS": "Appliance Parts & RTO" })).slug, "appliance-parts");
  // An unrecognised class falls back to subcategory text rather than dropping.
  const unknown = resolveDepartment(row({ "PRODUCT CLASS": "Brand New Category", SUBCATEGORY: "Automotive Electronics" }));
  assert.equal(unknown.slug, "automotive-marine");
  assert.equal(unknown.basis, "subcategory");
  // Every department has a Google category.
  for (const slug of Object.values({ ...GOOGLE_CATEGORY_BY_DEPARTMENT })) assert.ok(slug.length > 0);
});

test("supplier images become first-party proxy paths, never a raw http URL", () => {
  // The Petra bucket is http-only (a dotted bucket name cannot present a valid
  // certificate), so an https page must proxy it rather than link it.
  assert.equal(normalizeImageUrl("http://petraimages.com.s3.amazonaws.com/600x600/a.jpg"), "/shop-images/a.jpg");
  assert.equal(normalizeImageUrl("https://petraimages.com.s3.amazonaws.com/600x600/B-1_2.PNG"), "/shop-images/B-1_2.PNG");
  // The proxy must not be usable for an arbitrary host or a traversal attempt.
  assert.equal(normalizeImageUrl("https://evil.test/a.jpg"), "");
  assert.equal(normalizeImageUrl("http://petraimages.com.s3.amazonaws.com/600x600/../../etc/passwd"), "");
  assert.equal(normalizeImageUrl("http://petraimages.com.s3.amazonaws.com/600x600/script.js"), "");
  assert.equal(normalizeImageUrl(""), "");
  const { record } = buildPublicRecord(row());
  assert.equal(record.image_url, "/shop-images/1KSK02U22GE02.jpg");
  assert.doesNotMatch(record.image_url, /^http:/);
});

test("spec bullets become discrete lines and product_type carries the taxonomy", () => {
  assert.deepEqual(parseSpecBullets("&bull; One thing;&bull; Two things;"), ["One thing", "Two things"]);
  assert.deepEqual(parseSpecBullets(""), []);
  assert.equal(productType(row(), "Tools & Home Improvement"), "Tools & Home Improvement > Heating & Cooling > Air Quality");
});

test("availability copy reflects real stock and clearance marks discontinued stock", () => {
  assert.equal(availabilityText(row({ AVAILABLE: 40 })), "In stock");
  assert.equal(availabilityText(row({ AVAILABLE: 3 })), "In stock — only 3 left");
  assert.equal(availabilityText(row({ AVAILABLE: 0 })), "Available to order");
  assert.equal(buildPublicRecord(row({ AVAILABLE: 4, NOTES1: "Product is Discontinued; " })).record.clearance, true);
  // Discontinued with no stock left is not a deal, it is gone.
  assert.equal(buildPublicRecord(row({ AVAILABLE: 0, NOTES1: "Product is Discontinued; " })).record.clearance, false);
});

test("the catalog builder keeps one record per brand+MPN and prefers stocked rows", () => {
  const { built, skipped } = buildCatalog([
    row({ AVAILABLE: 0 }),
    row({ AVAILABLE: 9 }),
    row({ "VENDOR SKU": "OTHER-1", "PETRA SKU": "1KSOTHER1", UPC: "" }),
  ]);
  assert.equal(built.length, 2);
  assert.equal(skipped.filter((item) => item.reason === "duplicate_slug").length, 1);
  const duplicated = built.find((item) => item.record.sku === "K02-U22GE-02");
  assert.match(duplicated.record.availability, /^In stock/, "the stocked duplicate should win");
});

test("the /shop deals department selects clearance stock instead of a slug that no product has", () => {
  const products = [
    sanitizeMarketplaceProduct({ sku: "A", slug: "a", title: "A", department_slug: "electronics", clearance: true, price_mode: "fixed", public_price: 10 }),
    sanitizeMarketplaceProduct({ sku: "B", slug: "b", title: "B", department_slug: "electronics", clearance: false, price_mode: "fixed", public_price: 10 }),
  ];
  assert.deepEqual(filterMarketplaceProducts(products, { department: "deals" }).map((item) => item.sku), ["A"]);
  assert.equal(filterMarketplaceProducts(products, { department: "electronics" }).length, 2);
});

test("the sanitizer derives the meta fields the list payload omits", () => {
  const product = sanitizeMarketplaceProduct({ sku: "A", slug: "a", title: "Widget", brand: "Acme", short_description: "A widget." });
  assert.equal(product.meta_title, "Widget | Telecom Store Marketplace");
  assert.match(product.meta_description, /^A widget\. Buy Acme at Telecom Store\.$/);
  assert.equal(product.image_alt, "Widget product image");
  assert.equal(product.condition, "new");
});

test("the published catalog artifact carries no supplier-private field", () => {
  const artifact = "public/data/marketplace-catalog.json";
  if (!fs.existsSync(artifact)) return; // built by npm run build:shop
  const payload = JSON.parse(fs.readFileSync(artifact, "utf8"));
  assert.ok(payload.products.length > 0);
  for (const key of Object.keys(payload.products[0])) {
    assert.ok(ALLOWED_PUBLIC_KEYS.includes(key), `published catalog exposes ${key}`);
  }
  // Spot-check the whole file for private column names.
  const raw = fs.readFileSync(artifact, "utf8");
  assert.doesNotMatch(raw, /supplier_sku|supplier_cost|dealer_cost|"msrp"|map_price/i);
});

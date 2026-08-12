import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  ALLOWED_PUBLIC_KEYS,
  assertPublicRecordClean,
  availabilityText,
  availabilityState,
  excelSerialToISO,
  packagedShipWeightLb,
  shipDimensionsIn,
  buildCatalog,
  buildPublicRecord,
  GOOGLE_CATEGORY_BY_DEPARTMENT,
  parseSpecBullets,
  normalizeImageUrl,
  productType,
  recoverGtin,
  resolveDepartment,
  supplierSkuInCopy,
  telecomStorePrice,
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
  "WEIGHT-UNPACKED": 16.4435,
  "ESTIMATED SHIP WEIGHT": 16.4435,
  LENGTH: 11.3,
  WIDTH: 11.3,
  HEIGHT: 17.9,
  "PO ETA DATE": "",
  "IMAGE URL": "http://petraimages.com.s3.amazonaws.com/600x600/1KSK02U22GE02.jpg",
  ...patch,
});

test("the price sits 60% of the way from dealer cost to MSRP", () => {
  // Danny's worked example, 2026-08-12: cost 50, MSRP 100 -> 80.
  assert.equal(telecomStorePrice({ cost: 50, msrp: 100 }).publicPrice, 80);
  // 10 + (100 - 10) * 0.60 = 64.00
  assert.equal(telecomStorePrice({ cost: 10, msrp: 100 }).publicPrice, 64);
  // The workbook row's formula price is 91.99 + (109.99 - 91.99) * 0.60 = 102.79,
  // but Petra's headroom is thin there so the 15% floor lifts it to 108.22, which
  // still sits under the 109.99 MSRP.
  assert.equal(buildPublicRecord(row()).record.public_price, 108.22);
  // Cents are rounded, never truncated: 100.01 + 100.01 * 0.60 = 160.016 -> 160.02.
  // (Ample headroom here, so neither floor interferes with the arithmetic.)
  assert.equal(telecomStorePrice({ cost: 100.01, msrp: 200.02 }).publicPrice, 160.02);
  // On a cheap item the $1.00 floor is what decides the price, not the formula.
  assert.equal(telecomStorePrice({ cost: 1.11, msrp: 2.22 }).publicPrice, 2.11);
  // The result always clears cost and never passes MSRP. It can land exactly on
  // MSRP when the $1.00 floor consumes all the headroom, as on a $1 item.
  for (const [cost, msrp] of [[1, 2], [0.09, 0.99], [54.99, 300], [7.99, 19.99]]) {
    const price = telecomStorePrice({ cost, msrp }).publicPrice;
    assert.ok(price > cost, `${price} must clear cost ${cost}`);
    assert.ok(price <= msrp + 0.005, `${price} must not pass MSRP ${msrp}`);
  }
});

test("the margin floor lifts thin items but never above MSRP", () => {
  // Plenty of headroom: the floor does not bind at all.
  assert.equal(telecomStorePrice({ cost: 50, msrp: 100 }).basis, "cost_plus_60_percent_of_spread");
  // Formula 8.79 already clears the 8.22 floor, so the floor stays out of it.
  assert.equal(telecomStorePrice({ cost: 6.99, msrp: 9.99 }).publicPrice, 8.79);
  // Thin headroom: formula is 115.00, below the 117.65 floor, and the floor fits
  // under the 125.00 MSRP — so it binds.
  const lifted = telecomStorePrice({ cost: 100, msrp: 125 });
  assert.equal(lifted.publicPrice, 117.65);
  assert.equal(lifted.basis, "min_margin_percent");
  // No headroom: the floor would exceed MSRP, so the formula price stands and the
  // item is flagged rather than listed above MSRP.
  const thin = telecomStorePrice({ cost: 949.99, msrp: 1099.99 });
  assert.equal(thin.publicPrice, 1039.99);
  assert.equal(thin.basis, "formula_floor_would_exceed_msrp");
  assert.ok(thin.publicPrice < 1099.99, "must stay under MSRP");
  assert.ok(buildPublicRecord(row({ PRICE: 949.99, MSRP: 1099.99 })).flags.includes("thin_margin_review"));
});

test("no published price exceeds MSRP unless MAP contractually requires it", () => {
  for (const cost of [0.09, 0.99, 6.99, 21.99, 54.99, 636.99, 949.99]) {
    for (const msrp of [0.89, 1, 9.99, 31, 100, 699.99, 1099.99]) {
      const result = telecomStorePrice({ cost, msrp });
      if (result.status !== "priced") continue;
      assert.ok(result.publicPrice <= msrp + 0.005, `price ${result.publicPrice} exceeds MSRP ${msrp}`);
    }
  }
  // MAP is the one legitimate exception, and it is recorded as such.
  const mapped = telecomStorePrice({ cost: 5.49, msrp: 20, map: 44.99 });
  assert.equal(mapped.publicPrice, 44.99);
  assert.equal(mapped.basis, "map_floor");
});

test("rule 3: MAP raises a price below it, and never lowers one above it", () => {
  // Calculated 64.00, MAP 80 -> MAP wins.
  const raised = telecomStorePrice({ cost: 10, msrp: 100, map: 80 });
  assert.equal(raised.publicPrice, 80);
  assert.equal(raised.basis, "map_floor");
  // Calculated 64.00, MAP 20 -> calculation stands; MAP is a floor, not a cap.
  assert.equal(telecomStorePrice({ cost: 10, msrp: 100, map: 20 }).publicPrice, 64);
  // A zero or blank MAP is "no floor", not a floor of zero.
  assert.equal(telecomStorePrice({ cost: 10, msrp: 100, map: 0 }).publicPrice, 64);
  assert.equal(telecomStorePrice({ cost: 10, msrp: 100, map: "" }).publicPrice, 64);
  assert.ok(buildPublicRecord(row({ PRICE: 10, MSRP: 100, MAP: 80 })).flags.includes("price_raised_to_map"));
});

test("rules 1 and 4: an unpriceable row is flagged for review, never guessed", () => {
  const cases = [
    [{ cost: 10, msrp: 0 }, "invalid_msrp"],
    [{ cost: 10, msrp: "" }, "missing_msrp"],
    [{ cost: 10, msrp: "n/a" }, "missing_msrp"],
    [{ cost: 10, msrp: 10 }, "msrp_not_above_cost"],
    [{ cost: 54.99, msrp: 31 }, "msrp_not_above_cost"],
    [{ cost: "", msrp: 100 }, "missing_cost"],
    [{ cost: 0, msrp: 100 }, "invalid_cost"],
    [{ cost: -5, msrp: 100 }, "invalid_cost"],
  ];
  for (const [input, reason] of cases) {
    const result = telecomStorePrice(input);
    assert.equal(result.status, "review", `${JSON.stringify(input)} must not be priced`);
    assert.equal(result.publicPrice, null);
    assert.equal(result.reason, reason);
  }
  // Such a product still publishes, as request-a-quote, and carries the flag.
  const built = buildPublicRecord(row({ PRICE: 54.99, MSRP: 31 }));
  assert.equal(built.record.public_price, null);
  assert.equal(built.record.price_mode, "request_quote");
  assert.ok(built.flags.includes("price_review_msrp_not_above_cost"));
});

test("rule 2: no published price is ever below the dealer cost", () => {
  // Exhaustive over the real workbook shapes, including the 25 rows where the
  // dealer cost exceeds MSRP — those must come back unpriced, not underwater.
  for (const cost of [0.09, 0.99, 1.99, 10, 21.99, 54.99, 300]) {
    for (const msrp of [0, 0.89, 1, 10, 21.95, 31, 100, 500]) {
      for (const map of [0, 1, 25, 90]) {
        const result = telecomStorePrice({ cost, msrp, map });
        if (result.status !== "priced") continue;
        assert.ok(result.publicPrice >= cost, `price ${result.publicPrice} is below cost ${cost}`);
      }
    }
  }
});

test("rule 5: the pricing rule reads Petra's figures and writes none of them", () => {
  const source = row();
  const before = JSON.stringify(source);
  const built = buildPublicRecord(source);
  assert.equal(JSON.stringify(source), before, "the workbook row must not be mutated");
  // Cost, MSRP, and MAP appear nowhere in the published record.
  const serialized = JSON.stringify({ ...built.record, image_url: "", image_alt: "" });
  assert.doesNotMatch(serialized, /91\.99|109\.99/);
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

test("Google Shopping: packaged weight comes from ESTIMATED SHIP WEIGHT, never the unpacked figure", () => {
  // The two differ on 1,457 rows; the packaged figure is the carrier's number.
  assert.equal(packagedShipWeightLb({ "ESTIMATED SHIP WEIGHT": 0.72, "WEIGHT-UNPACKED": 0.3082 }), 0.72);
  // No packaged weight means no weight at all — the unpacked value is not a
  // substitute, because it would under-quote carrier-calculated shipping.
  assert.equal(packagedShipWeightLb({ "ESTIMATED SHIP WEIGHT": "", "WEIGHT-UNPACKED": 5 }), null);
  assert.equal(packagedShipWeightLb({ "ESTIMATED SHIP WEIGHT": 0 }), null);
  assert.equal(packagedShipWeightLb({ "ESTIMATED SHIP WEIGHT": 9999 }), null, "implausible weight is refused");
  assert.equal(buildPublicRecord(row()).record.shipping_weight_lb, 16.44);
});

test("Google Shopping: dimensions are all-or-nothing and never manufactured", () => {
  assert.deepEqual(shipDimensionsIn({ LENGTH: 11.3, WIDTH: 11.3, HEIGHT: 17.9 }), { length: 11.3, width: 11.3, height: 17.9 });
  assert.equal(shipDimensionsIn({ LENGTH: 11.3, WIDTH: 11.3, HEIGHT: 0 }), null);
  assert.equal(shipDimensionsIn({ LENGTH: 11.3 }), null);
});

test("Google Shopping: PO ETA DATE is an Excel serial and only a future date is a backorder", () => {
  assert.equal(excelSerialToISO(46251), "2026-08-17");
  assert.equal(excelSerialToISO(""), null);
  // A quantity or price must never be misread as a date.
  assert.equal(excelSerialToISO(12), null);
  assert.equal(excelSerialToISO(109.99), null);

  const today = "2026-08-12";
  // In stock wins regardless of any incoming PO.
  assert.deepEqual(availabilityState(row({ AVAILABLE: 5, "PO ETA DATE": 46251 }), { today }), { state: "in_stock", date: null });
  // Out of stock with a genuine future ETA is a dated backorder.
  assert.deepEqual(availabilityState(row({ AVAILABLE: 0, "PO ETA DATE": 46251 }), { today }), { state: "backorder", date: "2026-08-17" });
  // A lapsed ETA is not a promise we can advertise.
  assert.deepEqual(availabilityState(row({ AVAILABLE: 0, "PO ETA DATE": 46240 }), { today }), { state: "out_of_stock", date: null });
  // No ETA at all is out of stock, never an undated backorder.
  assert.deepEqual(availabilityState(row({ AVAILABLE: 0, "PO ETA DATE": "" }), { today }), { state: "out_of_stock", date: null });
});

test("the landing page states the expected date whenever the feed claims a backorder", () => {
  const today = "2026-08-12";
  const backordered = buildPublicRecord(row({ AVAILABLE: 0, "PO ETA DATE": 46251 }), 0, { today });
  assert.equal(backordered.record.availability_state, "backorder");
  assert.equal(backordered.record.availability_date, "2026-08-17");
  // Merchant Center cross-checks the landing page, so the date must be visible.
  assert.match(backordered.record.availability, /expected August 17, 2026/);
  // Out of stock must not imply an arrival that does not exist.
  const gone = buildPublicRecord(row({ AVAILABLE: 0, "PO ETA DATE": "" }), 0, { today });
  assert.equal(gone.record.availability_state, "out_of_stock");
  assert.doesNotMatch(gone.record.availability, /expected/);
});

test("availability copy reflects real stock and clearance marks discontinued stock", () => {
  assert.equal(availabilityText(row({ AVAILABLE: 40 })), "In stock");
  assert.equal(availabilityText(row({ AVAILABLE: 3 })), "In stock — only 3 left");
  assert.equal(availabilityText(row({ AVAILABLE: 0, "PO ETA DATE": "" })), "Out of stock");
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

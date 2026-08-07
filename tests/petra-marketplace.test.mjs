import assert from "node:assert/strict";
import test from "node:test";
import { calculatePricingReview, findIdentityConflicts, mapDepartment, restrictionStatus, summarizeMarketplace, transformMarketplaceRows } from "../scripts/lib/petra-marketplace.mjs";

const row = (patch = {}) => ({
  "PETRA SKU": "SUP-1", "VENDOR SKU": "MPN-1", DESCRIPTION: "PRODUCT", AVAILABLE: 5, PRICE: 50,
  "BRAND NAME": "ACME", "PRODUCT CLASS": "Home & Office", UPC: "012345678905", "LONG DESC": "Long",
  KEYWORDS: "keyword", SPECS: "spec", SUBCATEGORY: "Office", NOTES1: "", REFURB: "N", LENGTH: 1,
  WIDTH: 2, HEIGHT: 3, MAP: 60, RETURNABLE: "Y", "ESTIMATED SHIP WEIGHT": 4, NOTES2: "",
  SUBCATEGORY2: "Desk", SUBCATEGORY3: "Accessory", MSRP: 100, WARRANTY: "1 YEAR",
  "IMAGE URL": "https://example.com/image.jpg", "ORIGIN COUNTRY": "USA", ...patch,
});

test("maps every requested Petra product class to a marketplace department", () => {
  assert.equal(mapDepartment("Home Theater, Audio & Music"), "electronics");
  assert.equal(mapDepartment('"Computers, Tablets & Gaming"'), "electronics");
  assert.equal(mapDepartment("Kitchen"), "home-kitchen");
  assert.equal(mapDepartment("Tools & Home Improvement"), "tools");
  assert.equal(mapDepartment("Automotive & Marine"), "automotive-marine");
  assert.equal(mapDepartment("Outdoor & Fitness"), "outdoor-fitness");
  assert.equal(mapDepartment("Health & Beauty"), "health-beauty");
  assert.equal(mapDepartment("Appliance Parts & RTO"), "appliance-parts");
  assert.equal(mapDepartment("unknown"), null);
});

test("discontinued positive inventory is isolated to deals", () => {
  const [record] = transformMarketplaceRows([row({ NOTES1: "Product is Discontinued;" })]);
  assert.equal(record.department, "deals");
  assert.equal(record.pricing_status, "discontinued_clearance");
  assert.equal(record.public_availability, "Limited quantity—no restock expected");
});

test("zero stock and internet or territory restrictions block public browsing", () => {
  const [zero, restricted] = transformMarketplaceRows([row({ AVAILABLE: 0 }), row({ "PETRA SKU": "SUP-2", "VENDOR SKU": "MPN-2", UPC: "036000291452", NOTES1: "May not be sold online" })]);
  assert.equal(zero.public_eligible, false);
  assert.equal(zero.pricing_status, "quote_only");
  assert.equal(restricted.public_eligible, false);
  assert.equal(restricted.restricted, true);
  assert.equal(restrictionStatus(restricted.raw_payload).restricted, true);
});

test("pricing gates enforce MAP, 30 percent margin, eight-dollar profit, and unprofitable blocking", () => {
  assert.equal(calculatePricingReview({ cost: 50, map: 60, msrp: 100, inStock: true }).status, "price_ready");
  assert.equal(calculatePricingReview({ cost: 95, map: 0, msrp: 100, inStock: true }).status, "unprofitable");
  assert.equal(calculatePricingReview({ cost: 75, map: 0, msrp: 100, inStock: true }).status, "market_review_required");
  assert.equal(calculatePricingReview({ cost: 50, map: 110, msrp: 100, inStock: true }).status, "map_review");
});

test("contradictory duplicate MPNs and UPCs are ambiguous while exact duplicates can share a canonical product", () => {
  const conflictRows = [row(), row({ "PETRA SKU": "SUP-2", UPC: "036000291452" })];
  assert.equal(findIdentityConflicts(conflictRows).conflictRows.size, 2);
  const exactRows = [row(), row({ "PETRA SKU": "SUP-2" })];
  assert.equal(findIdentityConflicts(exactRows).conflictRows.size, 0);
  const conflictingTitles = [row({ UPC: "invalid" }), row({ "PETRA SKU": "SUP-2", UPC: "also-invalid", DESCRIPTION: "DIFFERENT PRODUCT" })];
  assert.equal(findIdentityConflicts(conflictingTitles).conflictRows.size, 2);
});

test("private transform preserves supplier fields while aggregate summary exposes totals only", () => {
  const records = transformMarketplaceRows([row()]);
  assert.equal(records[0].supplier_sku, "SUP-1");
  assert.equal(records[0].supplier_cost, 50);
  const summary = summarizeMarketplace(records, { filename: "private.xlsx" });
  assert.equal(summary.total_imported, 1);
  assert.equal(JSON.stringify(summary).includes("supplier_cost"), false);
  assert.equal(summary.database_writes, 0);
  assert.equal(summary.public_products_written, 0);
});

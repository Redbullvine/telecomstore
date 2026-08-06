import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Papa = require("papaparse");
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const csv = (p) => Papa.parse(read(p), { header: true, skipEmptyLines: true }).data;

const privateResearchFiles = [
  "operations/opening-pricing-evidence.json",
  "operations/opening-pricing-researched.csv",
  "operations/opening-pricing-review.csv"
];
const privateResearchAvailable = privateResearchFiles.every((file) => fs.existsSync(path.join(root, file)));
const researched = privateResearchAvailable ? csv("operations/opening-pricing-researched.csv") : [];
const shippingRows = csv("operations/opening-shipping-classes.csv");
const template = csv("operations/opening-pricing-template.csv");
const publicPricing = JSON.parse(read("src/data/opening-pricing.json"));
const serverPricing = JSON.parse(read("netlify/functions/_shared/opening-pricing.json"));
const evidence = privateResearchAvailable ? JSON.parse(read("operations/opening-pricing-evidence.json")) : {};
const approvals = JSON.parse(read("operations/opening-approved-prices.json")).prices;
const approvedEntries = new Map(Object.entries(approvals));

test("private evidence archive covers every exact-MPN catalog product", { skip: !privateResearchAvailable }, () => {
  assert.equal(Object.keys(evidence).length, 206);
  for (const row of researched) {
    assert.equal(evidence[row.public_sku].manufacturer_mpn, row.manufacturer_mpn);
  }
});

test("every catalog product was researched with a valid status", { skip: !privateResearchAvailable }, () => {
  assert.equal(researched.length, 206);
  const valid = new Set(["approved_candidate", "keep_request_quote", "manual_review"]);
  for (const r of researched) assert.ok(valid.has(r.pricing_status), `bad status for ${r.public_sku}`);
});

test("approved candidates carry a positive price, evidence, and confidence", { skip: !privateResearchAvailable }, () => {
  const approved = researched.filter((r) => r.pricing_status === "approved_candidate");
  assert.ok(approved.length > 0);
  for (const r of approved) {
    assert.ok(Number(r.proposed_retail_price) > 0, `no price for ${r.public_sku}`);
    assert.ok(r.pricing_evidence_urls.includes("http"), `no evidence for ${r.public_sku}`);
    assert.ok(["high", "medium"].includes(r.confidence), `low-confidence approval for ${r.public_sku}`);
    if (r.highest_reasonable_price) {
      assert.ok(Number(r.proposed_retail_price) <= Number(r.highest_reasonable_price) + 0.005, `priced above list for ${r.public_sku}`);
    }
  }
});

test("non-approved products carry no proposed price in private research outputs", { skip: !privateResearchAvailable }, () => {
  for (const r of researched.filter((x) => x.pricing_status !== "approved_candidate")) {
    assert.equal(r.proposed_retail_price, "", `unexpected price on ${r.public_sku} (${r.pricing_status})`);
  }
});

test("template publishes only evidence-supported merchandise prices and checkout stays disabled", () => {
  assert.equal(approvedEntries.size, 8);
  assert.equal(template.length, 206);
  assert.equal(template.filter((row) => row.pricing_approved === "true").length, 17);
  assert.equal(template.filter((row) => row.pricing_approved === "false").length, 189);
  for (const row of template) {
    assert.equal(row.checkout_active, "false", `checkout enabled for ${row.public_sku}`);
    if (row.pricing_approved === "true") {
      assert.ok(Number(row.public_price) > 0, `missing merchandise price for ${row.public_sku}`);
      assert.equal(row.price_mode, "listed_price_shipping_quote");
    } else {
      assert.equal(row.public_price, "");
      assert.equal(row.price_mode, "request_quote");
    }
  }
});

test("public pricing JSON mirrors listed and quote-only decisions while all checkout stays off", () => {
  assert.equal(publicPricing.length, 206);
  assert.equal(publicPricing.filter((row) => row.pricing_approved).length, 17);
  assert.equal(publicPricing.filter((row) => !row.pricing_approved).length, 189);
  for (const r of publicPricing) {
    assert.equal(r.checkout_active, false);
    if (r.pricing_approved) {
      assert.ok(r.public_price > 0);
      assert.equal(r.price_mode, "listed_price_shipping_quote");
    } else {
      assert.equal(r.public_price, null);
      assert.equal(r.price_mode, "request_quote");
    }
  }
});

test("pricing CSV and public/server JSON stay consistent", () => {
  const templateBySku = new Map(template.map((row) => [row.public_sku, row]));
  const serverBySku = new Map(serverPricing.map((row) => [row.public_sku, row]));
  for (const row of publicPricing) {
    const csvRow = templateBySku.get(row.public_sku);
    const serverRow = serverBySku.get(row.public_sku);
    assert.equal(row.public_price, csvRow.public_price === "" ? null : Number(csvRow.public_price));
    assert.equal(row.price_mode, csvRow.price_mode);
    assert.equal(row.pricing_approved, csvRow.pricing_approved === "true");
    for (const field of ["public_price", "price_mode", "pricing_approved", "checkout_active"]) assert.equal(serverRow[field], row[field]);
  }
});

test("private research and review records preserve evidence and mirror approval decisions", { skip: !privateResearchAvailable }, () => {
  const review = csv("operations/opening-pricing-review.csv");
  for (const rows of [researched, review]) {
    assert.equal(rows.filter((row) => row.pricing_approved === "true").length, 8);
    for (const row of rows) {
      if (approvedEntries.has(row.public_sku)) assert.equal(Number(row.approved_public_price), approvedEntries.get(row.public_sku));
      else assert.equal(row.approved_public_price, "");
    }
  }
});

test("every product has a shipping class and missing data is flagged, not invented", () => {
  assert.equal(shippingRows.length, 206);
  const valid = new Set(["small", "medium", "large", "oversize", "freight", "manual_quote"]);
  for (const s of shippingRows) {
    assert.ok(valid.has(s.shipping_class), `bad class for ${s.public_sku}`);
    if (s.shipping_class === "manual_quote") assert.match(s.packaging_assumption, /MISSING/);
    else assert.ok(Number(s.billed_weight_lb) > 0, `no billed weight for ${s.public_sku}`);
    assert.equal(s.suggested_ups_ground_flat, "", `invented flat rate for ${s.public_sku}`);
    assert.match(s.suggested_rate_range, /origin ZIP.*destination zone.*account rate/i);
  }
});

test("no supplier cost or margin columns exist in committed pricing files", () => {
  for (const file of ["operations/opening-shipping-classes.csv", "operations/opening-pricing-template.csv"]) {
    const header = read(file).split("\n")[0].toLowerCase();
    assert.doesNotMatch(header, /cost|wholesale|margin|msrp|\bmap\b/, `private column in ${file}`);
  }
});

test("the private margins file is git-ignored and untracked", () => {
  const tracked = execFileSync("git", ["-C", root, "ls-files", "tmp/"], { encoding: "utf8" }).trim();
  assert.equal(tracked, "", "tmp/ contents must never be tracked");
  const ignored = execFileSync("git", ["-C", root, "check-ignore", "tmp/pricing-private/opening-margins-private.csv"], { encoding: "utf8" }).trim();
  assert.ok(ignored.length > 0);
});

test("supplier research and fulfillment evidence stay git-ignored and untracked", () => {
  const tracked = new Set(execFileSync("git", ["-C", root, "ls-files"], { encoding: "utf8" }).split(/\r?\n/));
  for (const file of [
    ...privateResearchFiles,
    "docs/petra-blind-shipping-policy-audit.md",
    "operations/petra-fulfillment-rules.csv",
    "operations/petra-support-questions.md"
  ]) {
    assert.equal(tracked.has(file), false, `${file} must not be tracked`);
    const ignored = execFileSync("git", ["-C", root, "check-ignore", file], { encoding: "utf8" }).trim();
    assert.ok(ignored.length > 0, `${file} must be ignored`);
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  normalizeMpn,
  normalizeManufacturer,
  normalizeGtin,
  gtinCheckDigitValid,
  parsePrice,
  validateImageUrl,
  pricingDecision,
  transformRow,
  detectDuplicates,
  isSelectable,
  selectOpeningCatalog,
} from "../scripts/lib/petra-transform.mjs";

const require = createRequire(import.meta.url);
const Papa = require("papaparse");
const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(here, "fixtures", "petra-sample.csv");
const scriptPath = path.join(here, "..", "scripts", "prepare-petra-catalog.mjs");

function loadFixtureRecords() {
  const raw = fs.readFileSync(fixturePath, "utf8");
  const lines = raw.split(/\r?\n/);
  const body = lines.slice(2).join("\n"); // skip the two preamble lines
  const parsed = Papa.parse(body, { header: true, skipEmptyLines: "greedy" });
  const rows = parsed.data.filter((r) => (r["PETRA SKU"] || "").trim());
  const records = rows.map((r, i) => transformRow(r, i));
  detectDuplicates(records);
  return records;
}

const bySku = (records, sku) => records.find((r) => r.supplier.supplier_sku === sku);

// --------------------------------------------------------------------------
test("supplier SKU stays separate from proposed public SKU", () => {
  const records = loadFixtureRecords();
  const tool = bySku(records, "FKTFT100TOOL");
  assert.equal(tool.supplier.supplier_sku, "FKTFT100TOOL");
  assert.equal(tool.curated.proposed_public_sku, "FT-100TOOL");
  assert.notEqual(tool.curated.proposed_public_sku, tool.supplier.supplier_sku);

  // Any record whose vendor and Petra SKU collide must be flagged, never
  // silently published with an ambiguous SKU.
  const collide = bySku(records, "41361");
  assert.ok(collide.flags.includes("public_sku_review"));
});

test("manufacturer MPN normalization trims, collapses, and upper-cases", () => {
  assert.equal(normalizeMpn("  c4-cjm  "), "C4-CJM");
  assert.equal(normalizeMpn("n201  bl"), "N201 BL");
  assert.equal(normalizeMpn("   "), null);
  const records = loadFixtureRecords();
  assert.equal(bySku(records, "TRPN201BL").curated.manufacturer_mpn, "N201-BL");
});

test("manufacturer name normalization strips trademark noise", () => {
  assert.equal(normalizeManufacturer("TRIPP LITE(R) BY EATON(R)"), "Tripp Lite by Eaton");
  assert.equal(normalizeManufacturer("IDEAL(R)"), "Ideal");
  assert.equal(normalizeManufacturer("RCA"), "RCA"); // short acronym preserved
});

test("GTIN validation enforces length and GS1 check digit", () => {
  assert.equal(gtinCheckDigitValid("000012345014"), true);
  assert.equal(normalizeGtin("000012345014").valid, true);
  assert.equal(normalizeGtin("000012345011").reason, "bad_check_digit");
  assert.equal(normalizeGtin("12345").reason, "bad_length_5");
  assert.equal(normalizeGtin("call-us").reason, "non_numeric");
  assert.equal(normalizeGtin("").reason, "missing");
  // Never invents a value.
  assert.equal(normalizeGtin("000012345011").gtin, null);
});

test("malformed pricing is rejected, never guessed", () => {
  assert.equal(parsePrice("call").malformed, true);
  assert.equal(parsePrice("$1,299.99").value, 1299.99);
  assert.equal(parsePrice("").value, 0);
  const records = loadFixtureRecords();
  const bad = bySku(records, "BADP1");
  assert.ok(bad.flags.includes("malformed_msrp"));
  assert.equal(bad.curated.price, null);
  assert.equal(isSelectable(bad), false);
});

test("pricing rule: MSRP -> retail, otherwise request_quote", () => {
  assert.deepEqual(pricingDecision({ MSRP: "29.99", MAP: "19.99" }), {
    mode: "retail",
    price: 29.99,
    reason: "msrp",
  });
  assert.equal(pricingDecision({ MSRP: "0.00", MAP: "0.00" }).mode, "request_quote");
});

test("request-quote fallback yields null price and quote status", () => {
  const records = loadFixtureRecords();
  const closure = bySku(records, "GENCLOSURE24");
  assert.equal(closure.curated.pricing_mode, "request_quote");
  assert.equal(closure.curated.price, null);
  assert.equal(closure.curated.status, "quote");
  assert.equal(isSelectable(closure), true); // quote items still open the store
});

test("duplicate supplier SKUs and GTINs are detected", () => {
  const records = loadFixtureRecords();
  const dupes = detectDuplicates(records.map((r) => ({ ...r, flags: [...r.flags] })));
  const skuDupe = dupes.find((d) => d.type === "supplier_sku" && d.key === "TRPN201BL");
  const gtinDupe = dupes.find((d) => d.type === "gtin" && d.key === "000012345014");
  assert.ok(skuDupe, "expected duplicate supplier SKU TRPN201BL");
  assert.ok(gtinDupe, "expected duplicate GTIN 000012345014");
  // The later occurrence is the one flagged/rejected.
  assert.equal(isSelectable(bySku(records, "OTHERTOOL6")), false);
});

test("missing image forces review and blocks selection", () => {
  const records = loadFixtureRecords();
  const noimg = bySku(records, "NOIMG1");
  assert.ok(noimg.flags.includes("missing_image"));
  assert.equal(isSelectable(noimg), false);
  assert.equal(validateImageUrl("").valid, false);
});

test("supplier images are never auto-published (rights review required)", () => {
  const records = loadFixtureRecords();
  const withImg = records.filter((r) => r.curated.image_ref);
  for (const r of withImg) {
    assert.equal(r.curated.image_rights, "rights_review_required");
    assert.ok(r.flags.includes("image_rights_review"));
  }
});

test("non-telecom items are excluded from the opening catalog", () => {
  const records = loadFixtureRecords();
  const car = bySku(records, "CARSPKR8");
  assert.equal(car.classification.excluded, true);
  assert.equal(car.curated.category, null);
  assert.equal(isSelectable(car), false);
});

// --------------------------------------------------------------------------
// CLI-level guarantees: no DB, deterministic, no secrets/cost leakage.
// --------------------------------------------------------------------------

function runCli(outDir) {
  execFileSync(process.execPath, [scriptPath, fixturePath, "--out", outDir], {
    stdio: "pipe",
    // Deliberately no DB/network env; the script must not need any.
    env: { ...process.env, SUPABASE_URL: "", SUPABASE_ANON_KEY: "", DATABASE_URL: "" },
  });
  return outDir;
}

test("dry run performs no database/network access (source audit)", () => {
  const srcScript = fs.readFileSync(scriptPath, "utf8");
  const srcLib = fs.readFileSync(path.join(here, "..", "scripts", "lib", "petra-transform.mjs"), "utf8");
  for (const s of [srcScript, srcLib]) {
    assert.doesNotMatch(s, /@supabase|createClient|node:http|node:https|node:net|fetch\s*\(/);
  }
});

test("dry run is deterministic", () => {
  const a = runCli(fs.mkdtempSync(path.join(os.tmpdir(), "prep-a-")));
  const b = runCli(fs.mkdtempSync(path.join(os.tmpdir(), "prep-b-")));
  for (const f of ["opening-catalog.json", "opening-catalog.csv", "import-summary.json"]) {
    assert.equal(fs.readFileSync(path.join(a, f), "utf8"), fs.readFileSync(path.join(b, f), "utf8"), `${f} must be deterministic`);
  }
});

test("no secrets and no supplier cost appear in any output artifact", () => {
  const out = runCli(fs.mkdtempSync(path.join(os.tmpdir(), "prep-s-")));
  const files = fs.readdirSync(out);
  const blob = files.map((f) => fs.readFileSync(path.join(out, f), "utf8")).join("\n");
  // Sentinel secret planted in the fixture NOTES2 column.
  assert.doesNotMatch(blob, /SENTINEL_SUPPLIER_SECRET_DO_NOT_EMIT/);
  // Fake supplier wholesale costs (PRICE column) must never surface.
  for (const cost of ["9.51", "2.13", "45.07", "1.07", "6.20", "5.10", "11.40", "3.90"]) {
    assert.ok(!blob.includes(cost), `supplier cost ${cost} leaked into output`);
  }
  // The public opening catalog must not carry a cost-bearing key.
  const cat = JSON.parse(fs.readFileSync(path.join(out, "opening-catalog.json"), "utf8"));
  for (const p of cat) {
    for (const k of Object.keys(p)) {
      assert.doesNotMatch(k, /cost|wholesale|msrp|map|price_secret/i);
    }
  }
});

test("selection stays within the requested opening-catalog bounds", () => {
  const records = loadFixtureRecords();
  const selected = selectOpeningCatalog(records, { min: 25, max: 50 });
  // Fixture only has a handful of clean telecom items; must not exceed max and
  // must only contain selectable records.
  assert.ok(selected.length <= 50);
  for (const r of selected) assert.equal(isSelectable(r), true);
});

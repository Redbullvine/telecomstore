import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import test from "node:test";

import Papa from "papaparse";

const csv = (file) => Papa.parse(fs.readFileSync(file, "utf8"), { header: true, skipEmptyLines: true }).data;
const audit = csv("operations/opening-image-audit.csv");
const review = csv("operations/opening-image-manual-review.csv");
const manifest = JSON.parse(fs.readFileSync("operations/opening-image-approval-manifest.json", "utf8"));
const publicText = [
  "operations/opening-image-audit.csv",
  "operations/opening-image-manual-review.csv",
  "operations/opening-image-approval-manifest.json",
  "src/data/opening-catalog.json"
].map((file) => fs.readFileSync(file, "utf8")).join("\n");

test("every opening product has one Petra-authorized image and an audit row", () => {
  assert.equal(audit.length, 206);
  assert.equal(review.length, 206);
  assert.equal(new Set(audit.map((row) => row.public_sku)).size, 206);
  assert.ok(audit.every((row) => row.response_status === "working" && row.http_status === "200"));
  assert.ok(audit.every((row) => row.rights_status === "approved"));
  assert.ok(audit.every((row) => row.approved_public_image_count === "1" && row.storefront_image_status === "petra_csv_image"));
});

test("approval manifest publishes all authorized images and preserves the 206-product boundary", () => {
  assert.deepEqual(manifest.counts, {
    products: 206,
    candidate_images: 206,
    approved_public_images: 206,
    placeholders_required: 0
  });
  assert.equal(Object.keys(manifest.products).length, 206);
  assert.ok(Object.values(manifest.products).every((row) => row.approved_public_images.length === 1 && row.publish_supplier_image));
});

test("tracked image deliverables contain no private supplier fields", () => {
  assert.doesNotMatch(publicText, /"supplier_sku"\s*:|"petra_sku"\s*:|supplier[_ ]cost|wholesale|"map_price"\s*:/i);
});

test("the only duplicate image content is flagged for separate exact-product review", () => {
  const duplicated = audit.filter((row) => row.duplicate_content_group);
  assert.deepEqual(duplicated.map((row) => row.public_sku).sort(), ["MHX-LHDME2", "MHX-LHDME4"]);
});

test("private candidate URLs, downloads, and preview stay ignored", () => {
  const output = execFileSync("git", ["check-ignore", "-v", "tmp/opening-image-staging/private-image-audit.json", "tmp/opening-image-staging/review.html"], { encoding: "utf8" });
  assert.match(output, /\/tmp\//);
});

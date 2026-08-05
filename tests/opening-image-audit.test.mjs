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
  "docs/opening-image-audit-report.md",
  "src/data/opening-catalog.json"
].map((file) => fs.readFileSync(file, "utf8")).join("\n");

test("every opening product has one private-rights image candidate and a manual-review row", () => {
  assert.equal(audit.length, 206);
  assert.equal(review.length, 206);
  assert.equal(new Set(audit.map((row) => row.public_sku)).size, 206);
  assert.ok(audit.every((row) => row.response_status === "working" && row.http_status === "200"));
  assert.ok(audit.every((row) => row.rights_status === "pending_petra_confirmation"));
  assert.ok(audit.every((row) => row.approved_public_image_count === "0" && row.storefront_image_status === "category_placeholder"));
});

test("approval manifest publishes no supplier image and preserves the 206-product boundary", () => {
  assert.deepEqual(manifest.counts, {
    products: 206,
    candidate_images: 206,
    approved_public_images: 0,
    pending_petra_confirmation: 206,
    placeholders_required: 206
  });
  assert.equal(Object.keys(manifest.products).length, 206);
  assert.ok(Object.values(manifest.products).every((row) => row.approved_public_images.length === 0));
});

test("tracked image deliverables contain no raw supplier URL or private supplier fields", () => {
  assert.doesNotMatch(publicText, /https?:\/\//i);
  assert.doesNotMatch(publicText, /supplier[_ ]sku|petra[_ ]sku|supplier[_ ]cost|wholesale|\bmap\b/i);
});

test("the only duplicate image content is flagged for separate exact-product review", () => {
  const duplicated = audit.filter((row) => row.duplicate_content_group);
  assert.deepEqual(duplicated.map((row) => row.public_sku).sort(), ["MHX-LHDME2", "MHX-LHDME4"]);
});

test("private candidate URLs, downloads, and preview stay ignored", () => {
  const output = execFileSync("git", ["check-ignore", "-v", "tmp/opening-image-staging/private-image-audit.json", "tmp/opening-image-staging/review.html"], { encoding: "utf8" });
  assert.match(output, /\/tmp\//);
});

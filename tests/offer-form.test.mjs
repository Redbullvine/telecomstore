import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("product offers post to Netlify's submission endpoint, not the form definition file", async () => {
  const source = await fs.readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
  assert.match(source, /const NETLIFY_FORM_ENDPOINT = "\/"/);
  assert.doesNotMatch(source, /const NETLIFY_FORM_ENDPOINT = "\/__forms\.html"/);
  assert.match(source, /Make an Offer/);
  assert.match(source, /offer_amount/);
});

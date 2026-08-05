import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import catalog from "../src/data/opening-catalog.json" with { type: "json" };
import restrictions from "../src/data/image-restrictions.json" with { type: "json" };
import images from "../src/data/petra-product-images.json" with { type: "json" };
import { storefrontImageSource } from "../src/lib/storefront-product.mjs";
import { findDuplicateImageUrls, normalizePetraImageUrl } from "../scripts/lib/petra-image-utils.mjs";

const migration = fs.readFileSync("supabase/migrations/20260805213000_publish_petra_product_images.sql", "utf8");
const component = fs.readFileSync("src/components/storefront/ProductPlaceholder.jsx", "utf8");

test("all 206 exact catalog identities receive an approved secure Petra image", () => {
  assert.equal(images.length, 206);
  assert.equal(new Set(images.map((row) => row.public_sku)).size, 206);
  assert.equal(new Set(catalog.map((row) => row.sku)).size, 206);
  for (const product of catalog) {
    const image = images.find((row) => row.public_sku === product.sku);
    assert.ok(image);
    assert.equal(image.manufacturer_mpn, product.manufacturer_mpn);
    assert.equal(image.gtin, product.gtin);
    assert.equal(image.image_rights_status, "approved");
    assert.equal(image.publish_supplier_image, true);
    assert.match(image.photo_main, /^https:\/\/s3\.us-east-2\.amazonaws\.com\/petraimages\.com\//);
  }
});

test("image URLs are nonempty, unique, and valid HTTPS URLs", () => {
  assert.equal(new Set(images.map((row) => row.photo_main)).size, 206);
  for (const image of images) assert.equal(new URL(image.photo_main).protocol, "https:");
});

test("invalid image URLs are rejected and duplicate URLs are reported without title matching", () => {
  assert.equal(normalizePetraImageUrl(""), "");
  assert.equal(normalizePetraImageUrl("not a URL"), "");
  assert.equal(normalizePetraImageUrl("ftp://example.com/photo.jpg"), "");
  assert.equal(normalizePetraImageUrl("http://example.com/photo.jpg"), "");
  assert.equal(
    normalizePetraImageUrl("http://petraimages.com.s3.amazonaws.com/600x600/TEST.jpg"),
    "https://s3.us-east-2.amazonaws.com/petraimages.com/600x600/TEST.jpg"
  );
  assert.deepEqual(findDuplicateImageUrls([
    { public_sku: "ONE", photo_main: "https://example.com/one.jpg" },
    { public_sku: "TWO", photo_main: "https://example.com/one.jpg" },
    { public_sku: "THREE", photo_main: "https://example.com/three.jpg" }
  ]), [{ url: "https://example.com/one.jpg", skus: ["ONE", "TWO"] }]);
});

test("fallback behavior prevents broken image icons", () => {
  assert.match(component, /if \(src && !failed\)/);
  assert.match(component, /onError=\{\(\) => setFailed\(true\)\}/);
  assert.match(component, /object-fit:contain|ts-product-placeholder/);
});

test("local restrictions default open and support products, brands, and private supplier SKUs", () => {
  assert.deepEqual(restrictions.blocked_products, []);
  assert.deepEqual(restrictions.blocked_brands, []);
  assert.deepEqual(restrictions.blocked_supplier_skus, []);
  assert.equal(storefrontImageSource(catalog[0]), catalog[0].photo_main);
});

test("protected database restrictions cover product, brand, and supplier SKU without anon access", () => {
  assert.match(migration, /product_image_restrictions/);
  assert.match(migration, /num_nonnulls\(product_id, brand, supplier_sku\) = 1/);
  assert.match(migration, /revoke all on table public\.product_image_restrictions from public, anon/);
  assert.doesNotMatch(migration, /grant .*product_image_restrictions to anon/i);
  assert.match(migration, /r\.product_id = p\.id/);
  assert.match(migration, /lower\(r\.brand\) = lower\(p\.brand\)/);
  assert.match(migration, /lower\(sp\.supplier_sku\) = lower\(r\.supplier_sku\)/);
});

test("public RPC returns only an approved unrestricted URL and no private supplier columns", () => {
  assert.match(migration, /pi\.publishable is true/);
  assert.match(migration, /pi\.rights_status = 'approved'/);
  const returnSignature = migration.slice(migration.indexOf("returns table"), migration.indexOf("language sql"));
  assert.doesNotMatch(returnSignature, /supplier_sku|supplier_cost|map_price|msrp/i);
});

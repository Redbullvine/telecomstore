import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const inventoryPath = new URL("../src/lib/inventory.js", import.meta.url);

test("a Gaylord lot is explicitly publishable without an individual SKU", async () => {
  const source = await fs.readFile(inventoryPath, "utf8");
  assert.match(source, /product\.is_gaylord_lot/);
  assert.match(source, /gaylord-lot-\$\{identifier\}/);
  assert.match(source, /product\.sku \|\| product\.is_gaylord_lot/);
});

test("Gaylord lots retain title, category, and main-photo publication checks", async () => {
  const source = await fs.readFile(inventoryPath, "utf8");
  assert.match(source, /product\.title && product\.category && product\.photo_main/);
});

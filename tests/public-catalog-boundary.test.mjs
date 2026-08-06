import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const inventorySource = await readFile(new URL("../src/lib/inventory.js", import.meta.url), "utf8");

function functionBody(name, nextName) {
  const start = inventorySource.indexOf(`export async function ${name}`);
  const end = inventorySource.indexOf(`export async function ${nextName}`, start);

  assert.notEqual(start, -1, `${name} must exist`);
  assert.notEqual(end, -1, `${nextName} must follow ${name}`);
  return inventorySource.slice(start, end);
}

test("the public storefront uses only the public catalog RPC", () => {
  const source = functionBody("fetchPublicProducts", "fetchAdminProducts");

  assert.match(source, /supabase\.rpc\("get_public_product_catalog"\)/);
  assert.doesNotMatch(source, /\.from\("products"\)/);
  assert.match(source, /return fallbackInventory\(\)/);
  assert.match(source, /prices\.get\(product\.sku\)/, "RPC rows must receive the same public-only pricing overlay as fallback rows");
});

test("admin inventory keeps its authorized products table query", () => {
  const source = functionBody("fetchAdminProducts", "fetchProductById");

  assert.match(source, /\.from\("products"\)/);
  assert.match(source, /\.select\("\*"\)/);
});

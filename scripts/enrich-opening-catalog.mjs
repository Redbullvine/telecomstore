import fs from "node:fs/promises";
import process from "node:process";

import Papa from "papaparse";

const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const source = arg("--source");
const catalogPath = arg("--catalog") || "src/data/opening-catalog.json";
if (!source) throw new Error("--source must point to the private Petra CSV");

const lines = (await fs.readFile(source, "utf8")).replace(/^\uFEFF/, "").split(/\r?\n/);
const parsed = Papa.parse(lines.slice(2).join("\n"), { header: true, skipEmptyLines: true });
if (parsed.errors.length) throw new Error(parsed.errors.map((error) => error.message).join("; "));
const supplierByMpn = new Map(parsed.data.map((row) => [String(row["VENDOR SKU"] || "").trim(), row]));
const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"));
if (catalog.length !== 206) throw new Error(`Expected 206 opening products; found ${catalog.length}`);

function validGtin(value) {
  if (!/^\d{8}$|^\d{12,14}$/.test(value)) return false;
  const digits = [...value].map(Number);
  const check = digits.pop();
  const sum = digits.reverse().reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

const enriched = catalog.map((product) => {
  const supplier = supplierByMpn.get(String(product.manufacturer_mpn || "").trim());
  if (!supplier) throw new Error(`No source row for manufacturer MPN ${product.manufacturer_mpn}`);
  const gtin = String(supplier.UPC || "").trim();
  if (!validGtin(gtin)) throw new Error(`Invalid GTIN for ${product.sku}`);
  const searchKeywords = [...new Set([
    product.brand,
    product.category,
    product.manufacturer_mpn,
    product.sku,
    gtin,
    ...String(product.title || "").split(/[^a-z0-9]+/i).filter((token) => token.length >= 2)
  ].filter(Boolean))];
  return { ...product, gtin, search_keywords: searchKeywords };
});

await fs.writeFile(catalogPath, JSON.stringify(enriched, null, 2) + "\n");
console.log(`Enriched ${enriched.length} opening products with validated GTINs and public-safe search keywords.`);

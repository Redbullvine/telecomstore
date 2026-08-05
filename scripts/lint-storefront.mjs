import fs from "node:fs";

const files = [
  "src/main.jsx",
  "src/styles.css",
  "src/config/catalog.mjs",
  "src/lib/storefront-catalog.mjs",
  "src/lib/lead-validation.mjs",
  "src/components/storefront/CatalogFilters.jsx",
  "src/components/storefront/ProductCard.jsx",
  "src/components/storefront/ProductDetailPage.jsx",
  "src/components/storefront/ProductPlaceholder.jsx"
];
const errors = [];
for (const file of files) {
  const content = fs.readFileSync(file, "utf8");
  content.split(/\r?\n/).forEach((line, index) => {
    if (/[ \t]+$/.test(line)) errors.push(`${file}:${index + 1} has trailing whitespace.`);
  });
  if (content.includes("Warehouse-stock") || content.includes("warehouse-stock")) errors.push(`${file} contains an unsupported warehouse-stock claim.`);
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`Storefront lint passed for ${files.length} implementation files.`);

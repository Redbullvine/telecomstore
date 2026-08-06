import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const filterSource = await readFile(new URL("../src/components/storefront/CatalogFilters.jsx", import.meta.url), "utf8");
const cardSource = await readFile(new URL("../src/components/storefront/ProductCard.jsx", import.meta.url), "utf8");
const visualSource = await readFile(new URL("../src/components/storefront/ProductPlaceholder.jsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

test("homepage places compact controls and products before support content", () => {
  const storefront = mainSource.slice(mainSource.indexOf("function PublicStorefront"), mainSource.indexOf("function StorefrontHeader"));
  assert.equal(storefront.includes("<StorefrontHero"), false);
  assert.equal(storefront.includes("<CatalogDiscovery"), false);
  assert.ok(storefront.indexOf("<CatalogFilters") < storefront.indexOf('Browse Products'));
  assert.ok(storefront.indexOf('Browse Products') < storefront.indexOf('className="ts-grid"'));
  assert.ok(storefront.indexOf('className="ts-grid"') < storefront.indexOf('className="ts-search-lead"'));
});

test("header search supports live input, submit analytics, and clear", () => {
  assert.match(mainSource, /placeholder="Search MPN, GTIN, brand, product, or keyword"/);
  assert.match(mainSource, /onChange=\{\(event\) => setQuery\(event\.target\.value\)\}/);
  assert.match(mainSource, /<form className="ts-search" role="search" onSubmit=\{onSubmit\}>/);
  assert.match(mainSource, /trackEvent\("site_search"/);
  assert.match(mainSource, /aria-label="Clear search and filters"/);
});

test("category and filter controls stay synchronized and keyboard accessible", () => {
  assert.match(mainSource, /aria-current=\{category === item\.name \? "page" : undefined\}/);
  assert.match(mainSource, /onCategory=\{\(value\) => value === "All" \? resetFilters\(\) : navigateCategory\(value\)\}/);
  assert.match(filterSource, /<select value=\{category\}/);
  assert.match(filterSource, /<select value=\{manufacturer\}/);
  assert.match(filterSource, /<select value=\{availability\}/);
  assert.match(filterSource, /<select value=\{sort\}/);
  assert.match(filterSource, /tabIndex="0"/);
});

test("mobile category and filter rows scroll without page overflow", () => {
  assert.match(styles, /\.storefront \.ts-catnav \.ts-wrap[^}]*overflow-x: auto/s);
  assert.match(styles, /\.storefront \.ts-filter-fields[^}]*overflow-x: auto/s);
  assert.match(styles, /\.storefront \.ts-filter-fields::\-webkit-scrollbar \{ display: none; \}/);
  assert.match(styles, /@media \(max-width: 520px\)[\s\S]*\.storefront \.ts-grid \{ grid-template-columns: 1fr; \}/);
});

test("product cards retain identity, images, price, routes, and quote actions", () => {
  for (const required of ["ProductPlaceholder", "product.manufacturer_mpn", "product.gtin", "product.public_price", "onNavigate", "onAdd", "onAsk"]) {
    assert.ok(cardSource.includes(required), `missing preserved product behavior: ${required}`);
  }
  assert.ok(visualSource.includes("storefrontImageSource"));
  assert.match(visualSource, /loading=\{large \? "eager" : "lazy"\}/);
});

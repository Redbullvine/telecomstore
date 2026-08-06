import fs from "node:fs";
import process from "node:process";
import Papa from "papaparse";

export const LISTED_PRICE_MODE = "listed_price_shipping_quote";

const value = (input) => String(input ?? "").trim();
const key = (input) => value(input).toUpperCase();
const money = (input) => {
  const normalized = value(input).replace(/[$,]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

export function calculatePublicPrice({ cost, map, restricted = false }) {
  if (restricted) return { status: "restricted", publicPrice: null, basis: null };
  const dealerCost = money(cost);
  if (!(dealerCost > 0)) {
    return { status: dealerCost === null ? "missing_cost" : "invalid_cost", publicPrice: null, basis: null };
  }
  const doubled = Math.round((dealerCost * 2 + Number.EPSILON) * 100) / 100;
  const mapPrice = money(map);
  if (mapPrice > doubled) return { status: "priced", publicPrice: Math.round(mapPrice * 100) / 100, basis: "map_floor" };
  return { status: "priced", publicPrice: doubled, basis: "cost_times_two" };
}

export function matchCatalogProduct(product, identity, supplierRows) {
  const bySupplier = supplierRows.filter((row) => key(row["PETRA SKU"]) === key(identity?.supplier_sku));
  if (identity?.supplier_sku && bySupplier.length === 1) return { status: "matched", method: "supplier_sku", row: bySupplier[0] };
  if (identity?.supplier_sku && bySupplier.length > 1) return { status: "ambiguous", method: "supplier_sku" };

  const byMpn = supplierRows.filter((row) => key(row["VENDOR SKU"]) === key(product.manufacturer_mpn));
  if (byMpn.length === 1) return { status: "matched", method: "manufacturer_mpn", row: byMpn[0] };
  if (byMpn.length > 1) return { status: "ambiguous", method: "manufacturer_mpn" };

  const byGtin = supplierRows.filter((row) => value(row.UPC).replace(/\D/g, "") === value(product.gtin).replace(/\D/g, ""));
  if (byGtin.length === 1) return { status: "matched", method: "gtin", row: byGtin[0] };
  if (byGtin.length > 1) return { status: "ambiguous", method: "gtin" };
  return { status: "unmatched", method: null };
}

function parseCsv(path, { skipLines = 0 } = {}) {
  const source = fs.readFileSync(path, "utf8").split(/\r?\n/).slice(skipLines).join("\n");
  const parsed = Papa.parse(source, { header: true, skipEmptyLines: true });
  if (parsed.errors.length) throw new Error(parsed.errors.map((error) => error.message).join("; "));
  return parsed.data;
}

function csvCell(input) {
  const text = value(input);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function writeCsv(path, rows, columns) {
  const lines = [columns.join(","), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))];
  fs.writeFileSync(path, `${lines.join("\n")}\n`);
}

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replaceAll("\\", "/")}`).href) {
  const sourcePath = arg("--source");
  const identityPath = arg("--identity-map");
  if (!sourcePath || !identityPath) throw new Error("--source and --identity-map are required");

  const catalog = JSON.parse(fs.readFileSync(arg("--catalog") || "src/data/opening-catalog.json", "utf8"));
  const supplierRows = parseCsv(sourcePath, { skipLines: 2 });
  const identities = parseCsv(identityPath);
  const identityBySku = new Map(identities.map((row) => [value(row.proposed_public_sku), row]));
  const pricingRows = [];
  const auditRows = [];
  const totals = {
    approved_catalog_products: catalog.length, matched_products: 0, public_prices: 0, quote_only: 0,
    exact_cost_times_two: 0, raised_to_map: 0, missing_cost: 0, invalid_cost: 0,
    pricing_restrictions: 0, ambiguous_matches: 0, unmatched_products: 0,
    matched_by_supplier_sku: 0, matched_by_manufacturer_mpn: 0, matched_by_gtin: 0,
    positive_map_reported: 0, no_positive_map_reported: 0
  };

  for (const product of catalog) {
    const match = matchCatalogProduct(product, identityBySku.get(product.sku), supplierRows);
    let result = { status: match.status, publicPrice: null, basis: null };
    let mapStatus = "not_evaluated";
    if (match.status === "matched") {
      totals.matched_products += 1;
      totals[`matched_by_${match.method}`] += 1;
      const positiveMap = money(match.row.MAP) > 0;
      mapStatus = positiveMap ? "positive_map_reported" : "no_positive_map_reported";
      totals[mapStatus] += 1;
      result = calculatePublicPrice({ cost: match.row.PRICE, map: match.row.MAP });
    } else if (match.status === "ambiguous") totals.ambiguous_matches += 1;
    else totals.unmatched_products += 1;

    if (result.status === "missing_cost") totals.missing_cost += 1;
    if (result.status === "invalid_cost") totals.invalid_cost += 1;
    if (result.status === "restricted") totals.pricing_restrictions += 1;
    if (result.status === "priced") {
      totals.public_prices += 1;
      totals[result.basis === "map_floor" ? "raised_to_map" : "exact_cost_times_two"] += 1;
    } else totals.quote_only += 1;

    const priced = result.status === "priced";
    pricingRows.push({
      public_sku: product.sku, approved_title: product.title,
      public_price: priced ? result.publicPrice.toFixed(2) : "",
      price_mode: priced ? LISTED_PRICE_MODE : "request_quote",
      pricing_approved: priced ? "true" : "false", checkout_active: "false",
      shipping_class: "manual_quote", taxable: "true", stripe_price_id: "",
      allowed_countries: "", stripe_shipping_rate_id: "", automatic_tax: "false",
      notes: priced ? "public merchandise price; shipping and tax confirmed after review" : result.status
    });
    auditRows.push({
      public_sku: product.sku, manufacturer: product.brand, manufacturer_mpn: product.manufacturer_mpn,
      gtin: product.gtin, public_price: priced ? result.publicPrice.toFixed(2) : "",
      pricing_status: priced ? "published_candidate" : "request_quote",
      pricing_basis: result.basis || result.status, map_status: mapStatus,
      public_pricing_restriction: result.status === "restricted" ? "restricted" : "none_recorded",
      match_method: match.method || match.status
    });
  }

  const published = auditRows.map((row) => Number(row.public_price)).filter((price) => price > 0).sort((a, b) => a - b);
  totals.lowest_published_price = published[0]?.toFixed(2) || null;
  totals.highest_published_price = published.at(-1)?.toFixed(2) || null;
  totals.median_published_price = published.length % 2
    ? published[(published.length - 1) / 2].toFixed(2)
    : ((published[published.length / 2 - 1] + published[published.length / 2]) / 2).toFixed(2);
  totals.source_catalog_generated_at = "2026-07-29T16:25:02-05:00";
  totals.authoritative_cost_column = "PRICE";

  writeCsv("operations/opening-pricing-template.csv", pricingRows, Object.keys(pricingRows[0]));
  writeCsv("operations/petra-public-pricing-audit.csv", auditRows, Object.keys(auditRows[0]));
  fs.writeFileSync("operations/petra-public-pricing-summary.json", `${JSON.stringify(totals, null, 2)}\n`);
  console.log(JSON.stringify(totals, null, 2));
}

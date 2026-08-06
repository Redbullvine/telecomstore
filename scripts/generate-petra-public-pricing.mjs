import fs from "node:fs";
import process from "node:process";
import { createRequire } from "node:module";
import Papa from "papaparse";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

export const LISTED_PRICE_MODE = "listed_price_shipping_quote";

const value = (input) => String(input ?? "").trim();
const key = (input) => value(input).toUpperCase();
const digits = (input) => value(input).replace(/\D/g, "");
const money = (input) => {
  const normalized = value(input).replace(/[$,]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};
const roundMoney = (input) => Math.round((input + Number.EPSILON) * 100) / 100;
const RESTRICTION_PATTERN = /internet|online sale|online resale|resale restriction|authorized dealer|dealer agreement|cannot be sold|may not be sold|territor|ship only in us/i;

export function calculatePublicPrice({ cost, map, restricted = false }) {
  if (restricted) return { status: "restricted", publicPrice: null, basis: null };
  const dealerCost = money(cost);
  if (!(dealerCost > 0)) {
    return { status: dealerCost === null ? "missing_cost" : "invalid_cost", publicPrice: null, basis: null };
  }
  const doubled = roundMoney(dealerCost * 2);
  const mapPrice = money(map);
  if (mapPrice > doubled) return { status: "priced", publicPrice: roundMoney(mapPrice), basis: "map_floor" };
  return { status: "priced", publicPrice: doubled, basis: "cost_times_two" };
}

export function matchCatalogProduct(product, identity, supplierRows) {
  const bySupplier = supplierRows.filter((row) => key(row["PETRA SKU"]) === key(identity?.supplier_sku));
  if (identity?.supplier_sku && bySupplier.length === 1) return { status: "matched", method: "supplier_sku", row: bySupplier[0] };
  if (identity?.supplier_sku && bySupplier.length > 1) return { status: "ambiguous", method: "supplier_sku" };

  const byMpn = supplierRows.filter((row) => key(row["VENDOR SKU"]) === key(product.manufacturer_mpn));
  if (byMpn.length === 1) return { status: "matched", method: "manufacturer_mpn", row: byMpn[0] };
  if (byMpn.length > 1) return { status: "ambiguous", method: "manufacturer_mpn" };

  const gtin = digits(product.gtin);
  const byGtin = gtin ? supplierRows.filter((row) => digits(row.UPC) === gtin) : [];
  if (byGtin.length === 1) return { status: "matched", method: "gtin", row: byGtin[0] };
  if (byGtin.length > 1) return { status: "ambiguous", method: "gtin" };
  return { status: "unmatched", method: null };
}

export function supplierEligibility(row) {
  if (!(money(row?.AVAILABLE) > 0)) return { eligible: false, reason: "out_of_stock" };
  if (/discontinued/i.test(value(row?.NOTES1))) return { eligible: false, reason: "discontinued" };
  if (RESTRICTION_PATTERN.test(`${value(row?.NOTES1)} ${value(row?.NOTES2)}`)) {
    return { eligible: false, reason: "sale_or_territory_restricted" };
  }
  return { eligible: true, reason: null };
}

export function selectPublicPrice({ row, product, research }) {
  const eligibility = supplierEligibility(row);
  if (!eligibility.eligible) return { status: eligibility.reason, publicPrice: null, basis: null };
  if (money(row.MAP) === null) return { status: "map_unconfirmed", publicPrice: null, basis: null };

  const candidate = calculatePublicPrice({ cost: row.PRICE, map: row.MAP });
  if (candidate.status !== "priced") return candidate;

  if (!research || key(research.manufacturer_mpn) !== key(product.manufacturer_mpn)) {
    return { status: "market_identity_unconfirmed", publicPrice: null, basis: null };
  }
  const lowest = money(research.lowest_reliable_price);
  const typical = money(research.typical_public_price);
  const highest = money(research.highest_reasonable_price);
  if (!(lowest > 0) || !(typical > 0) || !(highest > 0) || !/https?:\/\//i.test(value(research.pricing_evidence_urls))) {
    return { status: "market_evidence_insufficient", publicPrice: null, basis: null };
  }

  const msrp = money(row.MSRP);
  if (!(msrp > 0)) return { status: "msrp_unconfirmed", publicPrice: null, basis: null };
  if (candidate.publicPrice > msrp) return { status: "above_msrp_manual_review", publicPrice: null, basis: null };
  if (candidate.publicPrice > highest) return { status: "above_market_manual_review", publicPrice: null, basis: null };
  return candidate;
}

function parseCsv(sourcePath, { skipLines = 0 } = {}) {
  const source = fs.readFileSync(sourcePath, "utf8").split(/\r?\n/).slice(skipLines).join("\n");
  const parsed = Papa.parse(source, { header: true, skipEmptyLines: true });
  if (parsed.errors.length) throw new Error(parsed.errors.map((error) => error.message).join("; "));
  return parsed.data;
}

function loadSupplierCatalog(sourcePath) {
  if (/\.xlsx$/i.test(sourcePath)) {
    const workbook = XLSX.readFile(sourcePath, { raw: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { range: 2, defval: null, raw: true });
  }
  return parseCsv(sourcePath, { skipLines: 2 });
}

function sourceGeneratedAt(sourcePath) {
  if (/\.xlsx$/i.test(sourcePath)) {
    const workbook = XLSX.readFile(sourcePath, { raw: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, range: "A1:D2", raw: true });
    const serial = Number(rows?.[1]?.[1]);
    const date = Number.isFinite(serial) ? new Date((serial - 25569) * 86400000).toISOString().slice(0, 10) : null;
    const time = value(rows?.[1]?.[3]).toLowerCase();
    const match = time.match(/^(\d{1,2}):(\d{2}):(\d{2})(am|pm)$/);
    if (!date || !match) return null;
    let hour = Number(match[1]) % 12;
    if (match[4] === "pm") hour += 12;
    return `${date}T${String(hour).padStart(2, "0")}:${match[2]}:${match[3]}-05:00`;
  }
  const metadata = fs.readFileSync(sourcePath, "utf8").split(/\r?\n/)[1] || "";
  const match = metadata.match(/^Generated,([^,]+),at,([^,]+)/i);
  return match ? `${match[1]} ${match[2]}` : null;
}

function catalogDelta(priorRows, currentRows) {
  const prior = new Map(priorRows.map((row) => [key(row["PETRA SKU"]), row]));
  const current = new Map(currentRows.map((row) => [key(row["PETRA SKU"]), row]));
  const common = [...current.keys()].filter((sku) => prior.has(sku));
  return {
    additions: [...current.keys()].filter((sku) => !prior.has(sku)).length,
    removals: [...prior.keys()].filter((sku) => !current.has(sku)).length,
    price_changes: common.filter((sku) => money(prior.get(sku).PRICE) !== money(current.get(sku).PRICE)).length,
    newly_in_stock: common.filter((sku) => !(money(prior.get(sku).AVAILABLE) > 0) && money(current.get(sku).AVAILABLE) > 0).length,
    newly_out_of_stock: common.filter((sku) => money(prior.get(sku).AVAILABLE) > 0 && !(money(current.get(sku).AVAILABLE) > 0)).length,
  };
}

function csvCell(input) {
  const text = value(input);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function writeCsv(outputPath, rows, columns) {
  const lines = [columns.join(","), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))];
  fs.writeFileSync(outputPath, `${lines.join("\n")}\n`);
}

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replaceAll("\\", "/")}`).href) {
  const sourcePath = arg("--source");
  const priorSourcePath = arg("--prior-source");
  const identityPath = arg("--identity-map");
  const researchPath = arg("--market-research");
  if (!sourcePath || !priorSourcePath || !identityPath || !researchPath) {
    throw new Error("--source, --prior-source, --identity-map, and --market-research are required");
  }

  const catalog = JSON.parse(fs.readFileSync(arg("--catalog") || "src/data/opening-catalog.json", "utf8"));
  const supplierRows = loadSupplierCatalog(sourcePath);
  const priorRows = loadSupplierCatalog(priorSourcePath);
  const identities = parseCsv(identityPath);
  const researchRows = parseCsv(researchPath);
  const supplierSkus = supplierRows.map((row) => key(row["PETRA SKU"]));
  if (supplierSkus.some((sku) => !sku) || new Set(supplierSkus).size !== supplierRows.length) {
    throw new Error("The current supplier catalog must contain one nonempty, unique PETRA SKU per row");
  }
  const identityBySku = new Map(identities.map((row) => [value(row.proposed_public_sku), row]));
  const researchBySku = new Map(researchRows.map((row) => [value(row.public_sku), row]));
  const pricingRows = [];
  const auditRows = [];
  const delta = catalogDelta(priorRows, supplierRows);
  const totals = {
    source_catalog_rows: supplierRows.length,
    source_unique_petra_skus: new Set(supplierRows.map((row) => key(row["PETRA SKU"]))).size,
    source_zero_stock: supplierRows.filter((row) => !(money(row.AVAILABLE) > 0)).length,
    source_discontinued: supplierRows.filter((row) => /discontinued/i.test(value(row.NOTES1))).length,
    source_sale_or_territory_restricted: supplierRows.filter((row) => RESTRICTION_PATTERN.test(`${value(row.NOTES1)} ${value(row.NOTES2)}`)).length,
    ...delta,
    approved_catalog_products: catalog.length,
    matched_products: 0,
    public_prices: 0,
    quote_only: 0,
    exact_cost_times_two: 0,
    raised_to_map: 0,
    ambiguous_matches: 0,
    unmatched_products: 0,
    matched_by_supplier_sku: 0,
    matched_by_manufacturer_mpn: 0,
    matched_by_gtin: 0,
    opening_out_of_stock: 0,
    opening_discontinued: 0,
    opening_sale_or_territory_restricted: 0,
    opening_cost_changes: 0,
    opening_newly_in_stock: 0,
    opening_newly_out_of_stock: 0,
    quote_only_by_reason: {},
  };
  const priorBySupplierSku = new Map(priorRows.map((row) => [key(row["PETRA SKU"]), row]));

  for (const product of catalog) {
    const match = matchCatalogProduct(product, identityBySku.get(product.sku), supplierRows);
    let result = { status: match.status, publicPrice: null, basis: null };
    if (match.status === "matched") {
      totals.matched_products += 1;
      totals[`matched_by_${match.method}`] += 1;
      const row = match.row;
      const prior = priorBySupplierSku.get(key(row["PETRA SKU"]));
      if (!(money(row.AVAILABLE) > 0)) totals.opening_out_of_stock += 1;
      if (/discontinued/i.test(value(row.NOTES1))) totals.opening_discontinued += 1;
      if (RESTRICTION_PATTERN.test(`${value(row.NOTES1)} ${value(row.NOTES2)}`)) totals.opening_sale_or_territory_restricted += 1;
      if (prior && money(prior.PRICE) !== money(row.PRICE)) totals.opening_cost_changes += 1;
      if (prior && !(money(prior.AVAILABLE) > 0) && money(row.AVAILABLE) > 0) totals.opening_newly_in_stock += 1;
      if (prior && money(prior.AVAILABLE) > 0 && !(money(row.AVAILABLE) > 0)) totals.opening_newly_out_of_stock += 1;
      result = selectPublicPrice({ row, product, research: researchBySku.get(product.sku) });
    } else if (match.status === "ambiguous") totals.ambiguous_matches += 1;
    else totals.unmatched_products += 1;

    const priced = result.status === "priced";
    if (priced) {
      totals.public_prices += 1;
      totals[result.basis === "map_floor" ? "raised_to_map" : "exact_cost_times_two"] += 1;
    } else {
      totals.quote_only += 1;
      totals.quote_only_by_reason[result.status] = (totals.quote_only_by_reason[result.status] || 0) + 1;
    }

    pricingRows.push({
      public_sku: product.sku,
      approved_title: product.title,
      public_price: priced ? result.publicPrice.toFixed(2) : "",
      price_mode: priced ? LISTED_PRICE_MODE : "request_quote",
      pricing_approved: priced ? "true" : "false",
      checkout_active: "false",
      shipping_class: "manual_quote",
      taxable: "true",
      stripe_price_id: "",
      allowed_countries: "",
      stripe_shipping_rate_id: "",
      automatic_tax: "false",
      notes: priced ? "public merchandise price; shipping and tax confirmed after review" : result.status,
    });
    auditRows.push({
      public_sku: product.sku,
      manufacturer: product.brand,
      manufacturer_mpn: product.manufacturer_mpn,
      gtin: product.gtin,
      public_price: priced ? result.publicPrice.toFixed(2) : "",
      pricing_status: priced ? "published_candidate" : "request_quote",
      pricing_basis: result.basis || result.status,
      match_method: match.method || match.status,
    });
  }

  const published = auditRows.map((row) => Number(row.public_price)).filter((price) => price > 0).sort((a, b) => a - b);
  totals.lowest_published_price = published[0]?.toFixed(2) || null;
  totals.highest_published_price = published.at(-1)?.toFixed(2) || null;
  totals.median_published_price = published.length % 2
    ? published[(published.length - 1) / 2]?.toFixed(2) || null
    : published.length ? roundMoney((published[published.length / 2 - 1] + published[published.length / 2]) / 2).toFixed(2) : null;
  totals.source_catalog_generated_at = sourceGeneratedAt(sourcePath);
  totals.prior_catalog_generated_at = sourceGeneratedAt(priorSourcePath);
  totals.match_order = ["PETRA SKU", "VENDOR SKU", "UPC"];
  totals.new_products_auto_published = 0;

  writeCsv("operations/opening-pricing-template.csv", pricingRows, Object.keys(pricingRows[0]));
  writeCsv("operations/petra-public-pricing-audit.csv", auditRows, Object.keys(auditRows[0]));
  fs.writeFileSync("operations/petra-public-pricing-summary.json", `${JSON.stringify(totals, null, 2)}\n`);
  console.log(JSON.stringify(totals, null, 2));
}

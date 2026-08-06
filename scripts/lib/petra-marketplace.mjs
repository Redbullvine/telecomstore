import crypto from "node:crypto";
import { normalizeGtin, normalizeManufacturer, normalizeMpn, normalizeWhitespace, validateImageUrl } from "./petra-transform.mjs";

export const DEPARTMENTS = Object.freeze({
  "Home Theater, Audio & Music": "electronics",
  "Computers, Tablets & Gaming": "electronics",
  "TVs & Projectors": "electronics",
  "Cell Phones & Accessories": "electronics",
  "Home & Office": "home-kitchen",
  Kitchen: "home-kitchen",
  "Tools & Home Improvement": "tools",
  "Automotive & Marine": "automotive-marine",
  "Outdoor & Fitness": "outdoor-fitness",
  "Health & Beauty": "health-beauty",
  "Appliance Parts & RTO": "appliance-parts",
  "Appliance Accessories, Tools & RTO": "appliance-parts",
});

const RESTRICTION_PATTERN = /internet|online sale|online resale|resale restriction|authorized dealer|dealer agreement|cannot be sold|may not be sold|territor|ship only in us/i;

const number = (input) => {
  if (input === null || input === undefined || input === "") return null;
  const parsed = Number(String(input).replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const roundMoney = (input) => Math.round((input + Number.EPSILON) * 100) / 100;
const identityKey = (input) => normalizeWhitespace(input).toUpperCase().replace(/[^A-Z0-9]/g, "");
const bool = (input) => /^[yt1]|true$/i.test(normalizeWhitespace(input));

export function mapDepartment(productClass) {
  const normalized = normalizeWhitespace(productClass).replace(/^"(.*)"$/, "$1");
  return DEPARTMENTS[normalized] || null;
}

export function isDiscontinued(row) {
  return /discontinued/i.test(normalizeWhitespace(row.NOTES1));
}

export function restrictionStatus(row) {
  const evidence = `${normalizeWhitespace(row.NOTES1)} ${normalizeWhitespace(row.NOTES2)}`.trim();
  return { restricted: RESTRICTION_PATTERN.test(evidence), evidence };
}

export function calculatePricingReview({ cost, map, msrp, discontinued = false, inStock = false, restricted = false, identityConflict = false }) {
  const supplierCost = number(cost);
  const mapPrice = number(map) || 0;
  const msrpPrice = number(msrp) || 0;
  const floor30 = supplierCost > 0 ? roundMoney(supplierCost / 0.7) : null;
  const floor20 = supplierCost > 0 ? roundMoney(supplierCost / 0.8) : null;
  const candidate = msrpPrice > 0 ? roundMoney(msrpPrice) : null;
  const grossProfit = candidate !== null && supplierCost !== null ? roundMoney(candidate - supplierCost) : null;
  const grossMargin = candidate > 0 && grossProfit !== null ? grossProfit / candidate : null;

  let status = "market_review_required";
  let reason = "competitive_market_review_required";
  if (identityConflict || restricted || !inStock) {
    status = "quote_only";
    reason = identityConflict ? "identity_conflict" : restricted ? "sale_or_territory_restriction" : "zero_stock";
  } else if (discontinued) {
    status = "discontinued_clearance";
    reason = "positive_inventory_discontinued_manual_clearance_approval";
  } else if (!(supplierCost > 0)) {
    status = "quote_only";
    reason = "missing_or_invalid_supplier_cost";
  } else if (mapPrice > 0 && msrpPrice > 0 && mapPrice > msrpPrice) {
    status = "map_review";
    reason = "map_above_msrp";
  } else if (!(candidate > 0)) {
    status = "market_review_required";
    reason = "missing_msrp_and_competitive_evidence";
  } else if (candidate < mapPrice) {
    status = "map_review";
    reason = "candidate_below_map";
  } else if (grossProfit < 8 || grossMargin < 0.2) {
    status = "unprofitable";
    reason = grossProfit < 8 ? "gross_profit_below_8" : "gross_margin_below_20_percent";
  } else if (grossMargin < 0.3) {
    status = "market_review_required";
    reason = "gross_margin_below_30_percent";
  } else {
    status = "price_ready";
    reason = "msrp_meets_map_margin_and_profit_gates";
  }

  return { status, reason, supplierCost, mapPrice, msrpPrice, floor30, floor20, candidate, grossProfit, grossMargin };
}

function normalizedGtin(raw) {
  if (typeof raw === "number" && Number.isFinite(raw)) raw = Math.trunc(raw).toString();
  return normalizeGtin(raw);
}

export function findIdentityConflicts(rows) {
  const byMpn = new Map();
  const byGtin = new Map();
  const noStableIdentity = new Set();
  rows.forEach((row, index) => {
    const brand = identityKey(row["BRAND NAME"]);
    const mpn = identityKey(row["VENDOR SKU"]);
    const gtin = normalizedGtin(row.UPC).gtin;
    if (!mpn && !gtin) noStableIdentity.add(index);
    if (brand && mpn) {
      const key = `${brand}|${mpn}`;
      if (!byMpn.has(key)) byMpn.set(key, []);
      byMpn.get(key).push({
        index,
        gtin,
        title: identityKey(row.DESCRIPTION),
        productClass: identityKey(row["PRODUCT CLASS"]),
      });
    }
    if (gtin) {
      if (!byGtin.has(gtin)) byGtin.set(gtin, []);
      byGtin.get(gtin).push({ index, brand, mpn });
    }
  });

  const conflicts = new Set(noStableIdentity);
  const mpnGroups = [];
  const gtinGroups = [];
  for (const [key, items] of byMpn) {
    const gtins = new Set(items.map((item) => item.gtin).filter(Boolean));
    const titles = new Set(items.map((item) => item.title).filter(Boolean));
    const productClasses = new Set(items.map((item) => item.productClass).filter(Boolean));
    if (items.length > 1 && (gtins.size > 1 || titles.size > 1 || productClasses.size > 1)) {
      items.forEach((item) => conflicts.add(item.index));
      mpnGroups.push({ key, rowCount: items.length });
    }
  }
  for (const [key, items] of byGtin) {
    const identities = new Set(items.map((item) => `${item.brand}|${item.mpn}`));
    if (items.length > 1 && identities.size > 1) {
      items.forEach((item) => conflicts.add(item.index));
      gtinGroups.push({ key, rowCount: items.length });
    }
  }
  return { conflictRows: conflicts, mpnGroups, gtinGroups, noStableIdentity: noStableIdentity.size };
}

export function transformMarketplaceRows(rows) {
  const identity = findIdentityConflicts(rows);
  return rows.map((row, index) => {
    const supplierSku = normalizeWhitespace(row["PETRA SKU"]);
    const manufacturerMpn = normalizeMpn(row["VENDOR SKU"]);
    const gtinResult = normalizedGtin(row.UPC);
    const brand = normalizeManufacturer(row["BRAND NAME"]);
    const quantity = Math.max(0, number(row.AVAILABLE) || 0);
    const discontinued = isDiscontinued(row);
    const restriction = restrictionStatus(row);
    const identityConflict = identity.conflictRows.has(index);
    const department = discontinued && quantity > 0 ? "deals" : mapDepartment(row["PRODUCT CLASS"]);
    const image = validateImageUrl(row["IMAGE URL"]);
    const pricing = calculatePricingReview({
      cost: row.PRICE,
      map: row.MAP,
      msrp: row.MSRP,
      discontinued,
      inStock: quantity > 0,
      restricted: restriction.restricted,
      identityConflict,
    });
    const publicEligible = quantity > 0 && !identityConflict && !restriction.restricted && Boolean(department) && (!discontinued || department === "deals");
    const sourceHash = crypto.createHash("sha256").update(JSON.stringify(row)).digest("hex");
    return {
      supplier_sku: supplierSku,
      manufacturer_mpn: manufacturerMpn,
      gtin: gtinResult.gtin,
      gtin_status: gtinResult.reason,
      brand,
      supplier_title: normalizeWhitespace(row.DESCRIPTION),
      supplier_description: normalizeWhitespace(row["LONG DESC"]),
      supplier_keywords: normalizeWhitespace(row.KEYWORDS),
      supplier_specs: normalizeWhitespace(row.SPECS),
      product_class: normalizeWhitespace(row["PRODUCT CLASS"]),
      subcategory: normalizeWhitespace(row.SUBCATEGORY),
      subcategory_2: normalizeWhitespace(row.SUBCATEGORY2),
      subcategory_3: normalizeWhitespace(row.SUBCATEGORY3),
      quantity,
      in_stock: quantity > 0,
      discontinued,
      refurbished: bool(row.REFURB),
      department,
      public_eligible: publicEligible,
      public_availability: discontinued && quantity > 0 ? "Limited quantity—no restock expected" : quantity > 0 ? "In stock with supplier" : "Out of stock",
      identity_conflict: identityConflict,
      restricted: restriction.restricted,
      restriction_evidence: restriction.evidence,
      supplier_cost: pricing.supplierCost,
      map_price: pricing.mapPrice,
      msrp: pricing.msrpPrice,
      margin_floor_30: pricing.floor30,
      margin_floor_20: pricing.floor20,
      price_candidate: pricing.candidate,
      gross_profit: pricing.grossProfit,
      gross_margin: pricing.grossMargin,
      pricing_status: pricing.status,
      pricing_reason: pricing.reason,
      unpacked_weight: number(row["WEIGHT-UNPACKED"]),
      estimated_ship_weight: number(row["ESTIMATED SHIP WEIGHT"]),
      length: number(row.LENGTH),
      width: number(row.WIDTH),
      height: number(row.HEIGHT),
      returnable: normalizeWhitespace(row.RETURNABLE) ? bool(row.RETURNABLE) : null,
      warranty: normalizeWhitespace(row.WARRANTY),
      notes_1: normalizeWhitespace(row.NOTES1),
      notes_2: normalizeWhitespace(row.NOTES2),
      image_url: image.valid ? image.url : null,
      image_status: image.reason,
      country_of_origin: normalizeWhitespace(row["ORIGIN COUNTRY"]),
      po_eta_date: normalizeWhitespace(row["PO ETA DATE"]),
      source_hash: sourceHash,
      raw_payload: row,
    };
  });
}

export function summarizeMarketplace(records, source) {
  const countBy = (field) => Object.fromEntries([...new Set(records.map((row) => row[field] || "unmapped"))].sort().map((value) => [value, records.filter((row) => (row[field] || "unmapped") === value).length]));
  return {
    source,
    total_imported: records.length,
    unique_supplier_skus: new Set(records.map((row) => identityKey(row.supplier_sku))).size,
    department_totals: countBy("department"),
    in_stock_total: records.filter((row) => row.in_stock).length,
    zero_stock_total: records.filter((row) => !row.in_stock).length,
    discontinued_total: records.filter((row) => row.discontinued).length,
    discontinued_in_stock_total: records.filter((row) => row.discontinued && row.in_stock).length,
    restricted_total: records.filter((row) => row.restricted).length,
    identity_conflict_total: records.filter((row) => row.identity_conflict).length,
    unmapped_department_total: records.filter((row) => !row.department).length,
    public_browse_candidate_total: records.filter((row) => row.public_eligible).length,
    hidden_zero_stock_total: records.filter((row) => !row.in_stock).length,
    image_total: records.filter((row) => row.image_url).length,
    invalid_or_missing_image_total: records.filter((row) => !row.image_url).length,
    valid_gtin_total: records.filter((row) => row.gtin).length,
    invalid_or_missing_gtin_total: records.filter((row) => !row.gtin).length,
    public_candidates_with_valid_gtin_total: records.filter((row) => row.public_eligible && row.gtin).length,
    gtin_status_totals: countBy("gtin_status"),
    pricing_status_totals: countBy("pricing_status"),
    pricing_reason_totals: countBy("pricing_reason"),
    public_prices_written: 0,
    public_products_written: 0,
    database_writes: 0,
  };
}

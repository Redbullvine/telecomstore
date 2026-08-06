export const EXPECTED_MARKETPLACE_ROWS = 2587;

export function restrictionType(evidence = "") {
  const value = String(evidence).toLowerCase();
  if (/territor|united states|\bu\.s\b/.test(value)) return "territory";
  if (/authorized dealer|dealer agreement/.test(value)) return "dealer_authorization";
  if (/internet|online sale|online resale|cannot be sold|may not be sold/.test(value)) return "internet_sale";
  return "other";
}

export function validateMarketplaceImport(records, summary) {
  const errors = [];
  if (!Array.isArray(records)) errors.push("private import plan must be an array");
  if (!summary || typeof summary !== "object") errors.push("summary is required");
  if (errors.length) return { ok: false, errors };

  if (records.length !== EXPECTED_MARKETPLACE_ROWS) errors.push(`expected ${EXPECTED_MARKETPLACE_ROWS} rows`);
  if (summary.total_imported !== records.length) errors.push("summary row count mismatch");
  if (summary.unique_supplier_skus !== records.length) errors.push("supplier SKUs are not unique");
  if (summary.gtin_fallback_matching_enabled !== false) errors.push("GTIN fallback must be disabled");
  if (summary.database_writes !== 0 || summary.public_products_written !== 0 || summary.public_prices_written !== 0) {
    errors.push("dry-run summary contains unexpected writes");
  }

  const supplierSkus = new Set();
  for (const record of records) {
    const supplierSku = String(record.supplier_sku || "").trim().toUpperCase();
    if (!supplierSku) errors.push("supplier SKU is missing");
    if (supplierSkus.has(supplierSku)) errors.push("duplicate supplier SKU");
    supplierSkus.add(supplierSku);
    if (!record.department) errors.push("marketplace department is missing");
    if (!record.source_hash || !/^[a-f0-9]{64}$/i.test(record.source_hash)) errors.push("source hash is invalid");
    if (record.gtin && record.gtin_matching_allowed !== false) errors.push("GTIN fallback is not explicitly disabled");
  }

  const counts = {
    rows: records.length,
    restrictions: records.filter((row) => row.restricted).length,
    quarantine: records.filter((row) => row.identity_conflict).length,
    pricing_reviews: records.length,
    in_stock: records.filter((row) => row.in_stock).length,
    zero_stock: records.filter((row) => !row.in_stock).length,
    discontinued: records.filter((row) => row.discontinued).length,
  };
  if (counts.restrictions !== summary.restricted_total) errors.push("restriction count mismatch");
  if (counts.quarantine !== summary.identity_conflict_total) errors.push("quarantine count mismatch");
  if (counts.in_stock !== summary.in_stock_total || counts.zero_stock !== summary.zero_stock_total) errors.push("stock count mismatch");

  return { ok: errors.length === 0, errors: [...new Set(errors)], counts };
}

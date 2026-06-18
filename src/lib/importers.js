import Papa from "papaparse";
import { IMPORT_COLUMNS } from "./inventory";

export async function parseInventoryFile(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (extension === "csv") {
    return parseCsv(file);
  }

  if (["xlsx", "xls"].includes(extension)) {
    return parseWorkbook(file);
  }

  throw new Error("Upload a CSV, XLSX, or XLS file.");
}

export function autoMapColumns(headers) {
  const normalizedHeaders = new Map(headers.map((header) => [normalizeHeader(header), header]));
  const mapping = {};

  IMPORT_COLUMNS.forEach((field) => {
    mapping[field] = normalizedHeaders.get(normalizeHeader(field)) || "";
  });

  return mapping;
}

export function applyColumnMapping(rows, mapping) {
  return rows.map((row) => {
    const mapped = {};

    IMPORT_COLUMNS.forEach((field) => {
      const source = mapping[field];
      mapped[field] = source ? cleanCell(row[source]) : "";
    });

    mapped.status = mapped.status || "draft";
    return mapped;
  });
}

export function findDuplicateRows(rows, currentProducts) {
  const existing = new Map();

  currentProducts.forEach((product) => {
    if (product.sku) existing.set(`sku:${product.sku.toLowerCase()}`, product);
    if (product.barcode) existing.set(`barcode:${product.barcode.toLowerCase()}`, product);
  });

  return rows.map((row, index) => {
    const duplicate =
      (row.sku && existing.get(`sku:${row.sku.toLowerCase()}`)) ||
      (row.barcode && existing.get(`barcode:${row.barcode.toLowerCase()}`));

    const errors = [];
    if (!row.title) errors.push("Missing title");
    if (!row.sku && !row.barcode) errors.push("Missing SKU or barcode");

    return { index, duplicate, errors };
  });
}

function parseCsv(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        if (result.errors?.length) {
          reject(new Error(result.errors[0].message));
          return;
        }

        const rows = result.data.map(cleanRow);
        resolve({ headers: Object.keys(rows[0] || {}), rows });
      },
      error: reject
    });
  });
}

async function parseWorkbook(file) {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    throw new Error("The spreadsheet does not contain a worksheet.");
  }

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" }).map(cleanRow);
  return { headers: Object.keys(rows[0] || {}), rows };
}

function cleanRow(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [cleanCell(key), cleanCell(value)]));
}

function cleanCell(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function normalizeHeader(value) {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

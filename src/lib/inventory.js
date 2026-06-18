import fallbackProducts from "../data/products.json";
import { isSupabaseConfigured, supabase } from "./supabase";

export const PRODUCT_STATUSES = ["draft", "available", "hold", "sold", "archived"];

export const PRODUCT_FIELDS = [
  "sku",
  "barcode",
  "brand",
  "title",
  "category",
  "condition",
  "quantity_available",
  "unit",
  "price",
  "price_note",
  "warehouse_location",
  "aisle",
  "rack",
  "shelf",
  "pallet",
  "short_description",
  "long_description",
  "status",
  "photo_main",
  "photo_label",
  "photo_extra_1",
  "photo_extra_2"
];

export const IMPORT_COLUMNS = [
  "sku",
  "barcode",
  "brand",
  "title",
  "category",
  "condition",
  "quantity_available",
  "unit",
  "price",
  "price_note",
  "warehouse_location",
  "aisle",
  "rack",
  "shelf",
  "pallet",
  "short_description",
  "long_description",
  "status",
  "photo_main",
  "photo_label",
  "photo_extra_1",
  "photo_extra_2"
];

export const EMPTY_PRODUCT = {
  sku: "",
  barcode: "",
  brand: "",
  title: "",
  category: "",
  condition: "New surplus / warehouse stock",
  quantity_available: "",
  unit: "",
  price: "",
  price_note: "Price requires verification",
  warehouse_location: "",
  aisle: "",
  rack: "",
  shelf: "",
  pallet: "",
  short_description: "",
  long_description: "",
  status: "draft",
  photo_main: "",
  photo_label: "",
  photo_extra_1: "",
  photo_extra_2: ""
};

export function normalizeProduct(product = {}) {
  const details = Array.isArray(product.details) ? product.details.join("\n") : product.details;
  const status = product.status === "quote" ? "available" : product.status || "draft";

  return {
    ...EMPTY_PRODUCT,
    ...product,
    id: product.id,
    sku: valueOrEmpty(product.sku),
    barcode: valueOrEmpty(product.barcode),
    brand: valueOrEmpty(product.brand),
    title: valueOrEmpty(product.title),
    category: valueOrEmpty(product.category),
    condition: valueOrEmpty(product.condition || EMPTY_PRODUCT.condition),
    quantity_available: valueOrEmpty(product.quantity_available ?? product.quantityAvailable),
    unit: valueOrEmpty(product.unit),
    price: valueOrEmpty(product.price),
    price_note: valueOrEmpty(product.price_note || EMPTY_PRODUCT.price_note),
    warehouse_location: valueOrEmpty(product.warehouse_location),
    aisle: valueOrEmpty(product.aisle),
    rack: valueOrEmpty(product.rack),
    shelf: valueOrEmpty(product.shelf),
    pallet: valueOrEmpty(product.pallet),
    short_description: valueOrEmpty(product.short_description ?? product.shortDescription),
    long_description: valueOrEmpty(product.long_description ?? details),
    status,
    photo_main: valueOrEmpty(product.photo_main || product.images?.[0]),
    photo_label: valueOrEmpty(product.photo_label || product.images?.[1]),
    photo_extra_1: valueOrEmpty(product.photo_extra_1 || product.images?.[2]),
    photo_extra_2: valueOrEmpty(product.photo_extra_2 || product.images?.[3]),
    created_at: product.created_at,
    updated_at: product.updated_at,
    created_by: product.created_by,
    updated_by: product.updated_by
  };
}

export function fallbackInventory() {
  return fallbackProducts.map(normalizeProduct).filter((product) => product.status === "available");
}

export function productSearchText(product) {
  return [
    product.sku,
    product.barcode,
    product.brand,
    product.title,
    product.category,
    product.condition,
    product.short_description,
    product.long_description,
    product.warehouse_location,
    product.aisle,
    product.rack,
    product.shelf,
    product.pallet,
    product.status
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function filterProducts(products, { query = "", category = "All", status = "All" }) {
  const normalizedQuery = query.trim().toLowerCase();

  return products.filter((product) => {
    const matchesCategory = category === "All" || product.category === category;
    const matchesStatus = status === "All" || product.status === status;
    const matchesQuery = !normalizedQuery || productSearchText(product).includes(normalizedQuery);

    return matchesCategory && matchesStatus && matchesQuery;
  });
}

export function getProductCategories(products) {
  return Array.from(new Set(products.map((product) => product.category).filter(Boolean))).sort();
}

export async function fetchPublicProducts() {
  if (!isSupabaseConfigured) {
    return fallbackInventory();
  }

  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("status", "available")
    .order("updated_at", { ascending: false, nullsFirst: false });

  if (error) {
    console.warn("Using fallback inventory after public products query failed.", error);
    return fallbackInventory();
  }

  return data.map(normalizeProduct);
}

export async function fetchAdminProducts() {
  requireSupabase();

  const { data, error } = await supabase
    .from("products")
    .select("*")
    .order("updated_at", { ascending: false, nullsFirst: false });

  if (error) throw error;

  return data.map(normalizeProduct);
}

export async function fetchProductById(id) {
  requireSupabase();

  const { data, error } = await supabase.from("products").select("*").eq("id", id).single();
  if (error) throw error;

  return normalizeProduct(data);
}

export async function findProductByScan(scanValue) {
  requireSupabase();

  const trimmed = scanValue.trim();
  if (!trimmed) return null;

  const [skuResult, barcodeResult] = await Promise.all([
    supabase.from("products").select("*").ilike("sku", trimmed).limit(2),
    supabase.from("products").select("*").ilike("barcode", trimmed).limit(2)
  ]);

  if (skuResult.error) throw skuResult.error;
  if (barcodeResult.error) throw barcodeResult.error;

  const byId = new Map();
  [...skuResult.data, ...barcodeResult.data].forEach((product) => byId.set(product.id, normalizeProduct(product)));

  return Array.from(byId.values());
}

export async function saveProduct(product, userId) {
  requireSupabase();

  const payload = prepareProductPayload(product);
  const isUpdate = Boolean(product.id);

  if (isUpdate) {
    const { data, error } = await supabase
      .from("products")
      .update({ ...payload, updated_by: userId })
      .eq("id", product.id)
      .select()
      .single();

    if (error) throw error;
    return normalizeProduct(data);
  }

  const { data, error } = await supabase
    .from("products")
    .insert({ ...payload, created_by: userId, updated_by: userId })
    .select()
    .single();

  if (error) throw error;
  return normalizeProduct(data);
}

export async function updateProductStatus(product, status, userId) {
  requireSupabase();

  const { data, error } = await supabase
    .from("products")
    .update({ status, updated_by: userId })
    .eq("id", product.id)
    .select()
    .single();

  if (error) throw error;
  return normalizeProduct(data);
}

export async function duplicateProduct(product, userId) {
  const duplicate = {
    ...product,
    id: undefined,
    title: `${product.title} Copy`,
    status: "draft",
    created_at: undefined,
    updated_at: undefined,
    created_by: undefined,
    updated_by: undefined
  };

  return saveProduct(duplicate, userId);
}

export async function hardDeleteProduct(productId) {
  requireSupabase();

  const { error } = await supabase.from("products").delete().eq("id", productId);
  if (error) throw error;
}

export async function fetchActivity(limit = 25) {
  requireSupabase();

  const { data, error } = await supabase
    .from("inventory_activity")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  return data;
}

export async function fetchCategories() {
  requireSupabase();

  const { data, error } = await supabase.from("categories").select("*").order("name");
  if (error) throw error;

  return data;
}

export async function createCategory(name) {
  requireSupabase();

  const { error } = await supabase.from("categories").insert({ name: name.trim() });
  if (error) throw error;
}

export async function deleteCategory(id) {
  requireSupabase();

  const { error } = await supabase.from("categories").delete().eq("id", id);
  if (error) throw error;
}

export async function fetchStorageLocations() {
  requireSupabase();

  const { data, error } = await supabase.from("storage_locations").select("*").order("created_at", { ascending: false });
  if (error) throw error;

  return data;
}

export async function createStorageLocation(location) {
  requireSupabase();

  const { error } = await supabase.from("storage_locations").insert(location);
  if (error) throw error;
}

export async function deleteStorageLocation(id) {
  requireSupabase();

  const { error } = await supabase.from("storage_locations").delete().eq("id", id);
  if (error) throw error;
}

export async function uploadProductImage(file, product, field) {
  requireSupabase();

  if (!file) return "";

  const safeSku = slugify(product.sku || product.barcode || product.title || crypto.randomUUID());
  const safeName = slugify(file.name).replace(/\s+/g, "-");
  const path = `products/${safeSku}/${Date.now()}-${field}-${safeName}`;

  const { error } = await supabase.storage.from("product-images").upload(path, file, {
    cacheControl: "3600",
    upsert: true
  });

  if (error) throw error;

  const { data } = supabase.storage.from("product-images").getPublicUrl(path);
  return data.publicUrl;
}

export async function importProducts(rows, duplicateMode, currentProducts, userId) {
  requireSupabase();

  const existingByKey = new Map();
  currentProducts.forEach((product) => {
    if (product.sku) existingByKey.set(`sku:${product.sku.toLowerCase()}`, product);
    if (product.barcode) existingByKey.set(`barcode:${product.barcode.toLowerCase()}`, product);
  });

  const result = { created: 0, updated: 0, skipped: 0, errors: 0, messages: [] };

  for (const row of rows) {
    try {
      const product = normalizeProduct({
        ...row,
        status: row.status === "available" ? "available" : row.status || "draft"
      });

      product.status = PRODUCT_STATUSES.includes(product.status) ? product.status : "draft";

      if (!product.title || (!product.sku && !product.barcode)) {
        result.errors += 1;
        result.messages.push(`Missing title and SKU/barcode for row: ${JSON.stringify(row)}`);
        continue;
      }

      const duplicate =
        (product.sku && existingByKey.get(`sku:${product.sku.toLowerCase()}`)) ||
        (product.barcode && existingByKey.get(`barcode:${product.barcode.toLowerCase()}`));

      if (duplicate && duplicateMode === "skip") {
        result.skipped += 1;
        continue;
      }

      if (duplicate && duplicateMode === "update") {
        await saveProduct({ ...duplicate, ...product, id: duplicate.id }, userId);
        result.updated += 1;
        continue;
      }

      if (duplicate && duplicateMode === "draft") {
        product.status = "draft";
      }

      const saved = await saveProduct(product, userId);
      if (saved.sku) existingByKey.set(`sku:${saved.sku.toLowerCase()}`, saved);
      if (saved.barcode) existingByKey.set(`barcode:${saved.barcode.toLowerCase()}`, saved);
      result.created += 1;
    } catch (error) {
      result.errors += 1;
      result.messages.push(error.message);
    }
  }

  return result;
}

function prepareProductPayload(product) {
  const payload = {};

  PRODUCT_FIELDS.forEach((field) => {
    if (field === "quantity_available" || field === "price") {
      payload[field] = numberOrNull(product[field]);
      return;
    }

    payload[field] = emptyToNull(product[field]);
  });

  payload.status = PRODUCT_STATUSES.includes(payload.status) ? payload.status : "draft";
  payload.title = payload.title || product.sku || product.barcode || "Untitled telecom material";

  return payload;
}

function requireSupabase() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
  }
}

function valueOrEmpty(value) {
  return value === null || value === undefined ? "" : String(value);
}

function emptyToNull(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const normalized = Number(String(value).replace(/[$,]/g, ""));
  return Number.isFinite(normalized) ? normalized : null;
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

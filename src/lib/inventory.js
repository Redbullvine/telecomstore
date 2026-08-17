import openingCatalog from "../data/opening-catalog.json";
import openingPricing from "../data/opening-pricing.json";
import { slugifyCatalogValue } from "../config/catalog.mjs";
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
  "label_text",
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
  condition: "",
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
  label_text: "",
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
    condition: valueOrEmpty(product.condition),
    quantity_available: valueOrEmpty(product.quantity_available ?? product.quantityAvailable),
    public_availability: valueOrEmpty(
      product.public_availability || derivePublicAvailability(product.quantity_available ?? product.quantityAvailable)
    ),
    unit: valueOrEmpty(product.unit),
    price: valueOrEmpty(product.public_price ?? product.price),
    public_price: product.public_price ?? null,
    price_mode: valueOrEmpty(product.price_mode || "request_quote"),
    pricing_approved: product.pricing_approved === true,
    checkout_active: product.checkout_active === true,
    availability_text: valueOrEmpty(product.availability_text || publicAvailabilityLabel(product)),
    price_note: valueOrEmpty(product.public_price_note || product.price_note || EMPTY_PRODUCT.price_note),
    warehouse_location: valueOrEmpty(product.warehouse_location),
    aisle: valueOrEmpty(product.aisle),
    rack: valueOrEmpty(product.rack),
    shelf: valueOrEmpty(product.shelf),
    pallet: valueOrEmpty(product.pallet),
    short_description: valueOrEmpty(product.short_description ?? product.shortDescription),
    long_description: valueOrEmpty(product.long_description ?? details),
    label_text: valueOrEmpty(product.label_text),
    status,
    photo_main: valueOrEmpty(product.photo_main || product.images?.[0]),
    photo_label: valueOrEmpty(product.photo_label || product.images?.[1]),
    photo_extra_1: valueOrEmpty(product.photo_extra_1 || product.images?.[2]),
    photo_extra_2: valueOrEmpty(product.photo_extra_2 || product.images?.[3]),
    slug: valueOrEmpty(product.slug),
    manufacturer_mpn: valueOrEmpty(product.manufacturer_mpn),
    gtin: valueOrEmpty(product.gtin),
    specifications: product.specifications || {},
    currency_code: valueOrEmpty(product.currency_code || "USD"),
    meta_title: valueOrEmpty(product.meta_title),
    meta_description: valueOrEmpty(product.meta_description),
    search_keywords: Array.isArray(product.search_keywords) ? product.search_keywords : [],
    google_product_category: valueOrEmpty(product.google_product_category),
    canonical_url_override: valueOrEmpty(product.canonical_url_override),
    published_at: product.published_at,
    created_at: product.created_at,
    updated_at: product.updated_at,
    created_by: product.created_by,
    updated_by: product.updated_by
  };
}

export function fallbackInventory() {
  const prices = new Map(openingPricing.map((row) => [row.public_sku, row]));
  return openingCatalog.map((product) => normalizeProduct({ ...product, ...prices.get(product.sku) })).filter((product) => product.status === "available");
}

// Every product in opening-catalog.json derives its slug this way, so live rows
// resolve to the same /products/<slug> shape the sitemap and feed already use.
export function storefrontSlug(product = {}) {
  if (product.slug) return product.slug;
  const brand = slugifyCatalogValue(product.brand);
  const sku = slugifyCatalogValue(product.sku);
  return brand && sku ? `${brand}-${sku}` : brand || sku;
}

// Setting a product to 'available' in Admin is the publish action, but a row
// still has to be presentable before customers and Google see it. Photo intake
// creates rows with nothing but an image, and publishing one of those would put
// an untitled, uncategorised item on the storefront.
export function isStorefrontReady(product = {}) {
  return Boolean(product.sku && product.title && product.category && product.photo_main);
}

// The public catalog is the union of two sources:
//
//  1. get_public_product_catalog() — rows published from Admin. Authoritative:
//     a live row always replaces a static one with the same SKU.
//  2. opening-catalog.json — the 206 rights-cleared products committed for the
//     deploy. They remain so indexed /products/<slug> URLs and the Merchant
//     Center feed keep resolving for SKUs that are not in the database.
//
// Prices are deliberately not promoted here. Without an approved pricing review
// a live row has pricing_approved false, so it renders as "Price requires
// verification" rather than as a firm price a shopper could check out against.
export async function fetchStorefrontProducts() {
  const published = fallbackInventory();
  if (!isSupabaseConfigured) return published;

  let live = [];
  try {
    const { data, error } = await supabase.rpc("get_public_product_catalog");
    if (error) throw error;

    const prices = new Map(openingPricing.map((row) => [row.public_sku, row]));
    live = (data || [])
      .map((product) => normalizeProduct({ ...product, ...prices.get(product.sku) }))
      .filter(isStorefrontReady)
      .map((product) => {
        const slug = storefrontSlug(product);
        return { ...product, slug, canonical_path: product.canonical_path || `/products/${slug}` };
      });
  } catch (error) {
    // A database outage must leave the published catalog standing, not empty the
    // storefront and drop 206 indexed pages.
    console.warn("Live product catalog unavailable; showing the published catalog only.", error);
    return published;
  }

  const bySku = new Map(published.map((product) => [product.sku.toLowerCase(), product]));
  live.forEach((product) => bySku.set(product.sku.toLowerCase(), product));
  return [...bySku.values()];
}

export function derivePublicAvailability(quantity) {
  if (quantity === null || quantity === undefined || quantity === "") return "quote_only";
  const numeric = Number.parseFloat(String(quantity).replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return "quote_only";
  return numeric > 0 ? "in_stock" : "out_of_stock";
}

export function publicAvailabilityLabel(product = {}) {
  const labels = {
    in_stock: "In stock",
    out_of_stock: "Out of stock",
    backorder: "Backorder",
    quote_only: "Availability by quote"
  };
  return labels[product.public_availability] || "Availability by quote";
}

export function publicAvailabilityRank(product = {}) {
  const ranks = { in_stock: 4, backorder: 3, quote_only: 2, out_of_stock: 1 };
  return ranks[product.public_availability] || 0;
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
    product.manufacturer_mpn,
    product.gtin,
    ...(Array.isArray(product.search_keywords) ? product.search_keywords : []),
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

  const { data, error } = await supabase.rpc("get_public_product_catalog");

  if (error) {
    console.warn("Using fallback inventory after public catalog RPC failed.", error);
    return fallbackInventory();
  }

  const prices = new Map(openingPricing.map((row) => [row.public_sku, row]));
  return (data || [])
    .map((product) => normalizeProduct({ ...product, ...prices.get(product.sku) }))
    .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
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

  // Best-effort: remove the item's stored image files before the record
  // (and its product_images rows) disappear, so nothing orphans in storage.
  try {
    const [{ data: images }, { data: product }] = await Promise.all([
      supabase.from("product_images").select("storage_path").eq("product_id", productId),
      supabase.from("products").select("photo_main, photo_label, photo_extra_1, photo_extra_2").eq("id", productId).maybeSingle()
    ]);

    const paths = new Set();
    (images || []).forEach((image) => {
      if (image.storage_path) paths.add(image.storage_path);
    });
    ["photo_main", "photo_label", "photo_extra_1", "photo_extra_2"].forEach((field) => {
      const path = storagePathFromPublicUrl(product?.[field]);
      if (path) paths.add(path);
    });

    if (paths.size) await supabase.storage.from("product-images").remove([...paths]);
  } catch (cleanupError) {
    console.warn("Image cleanup during hard delete failed", cleanupError);
  }

  const { error } = await supabase.from("products").delete().eq("id", productId);
  if (error) throw error;
}

function storagePathFromPublicUrl(url) {
  const marker = "/object/public/product-images/";
  const index = (url || "").indexOf(marker);
  return index === -1 ? null : decodeURIComponent(url.slice(index + marker.length));
}

export async function deleteProductImage(image) {
  requireSupabase();

  if (image.storage_path) {
    const { error: storageError } = await supabase.storage.from("product-images").remove([image.storage_path]);
    if (storageError) console.warn("Storage removal failed for", image.storage_path, storageError);
  }

  const { error } = await supabase.from("product_images").delete().eq("id", image.id);
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

export const IMAGE_TYPES = [
  { value: "label_barcode", label: "Label / Barcode" },
  { value: "item", label: "Item photo" },
  { value: "other", label: "Other" }
];

const IMAGE_TYPE_VALUES = IMAGE_TYPES.map((type) => type.value);

export async function uploadIntakeImage(file, keyHint) {
  requireSupabase();

  const safeKey = slugify(keyHint || "intake") || "intake";
  const safeName = slugify(file.name || "photo.jpg") || "photo.jpg";
  const path = `intake/${safeKey}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;

  const { error } = await supabase.storage.from("product-images").upload(path, file, {
    cacheControl: "3600",
    upsert: false
  });

  if (error) throw error;

  const { data } = supabase.storage.from("product-images").getPublicUrl(path);
  return { path, url: data.publicUrl };
}

export async function addProductImages(productId, images, userId) {
  requireSupabase();

  if (!images.length) return [];

  const rows = images.map((image) => ({
    product_id: productId,
    url: image.url,
    storage_path: image.path || null,
    image_type: IMAGE_TYPE_VALUES.includes(image.type) ? image.type : "item",
    uploaded_by: userId || null
  }));

  const { data, error } = await supabase.from("product_images").insert(rows).select();
  if (error) throw error;

  return data;
}

export async function fetchProductImages(productId) {
  requireSupabase();

  const { data, error } = await supabase
    .from("product_images")
    .select("*")
    .eq("product_id", productId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data;
}

export async function logActivity(action, product, userId) {
  requireSupabase();

  const { error } = await supabase.from("inventory_activity").insert({
    product_id: product.id || null,
    actor_id: userId || null,
    action,
    after_data: {
      title: product.title || null,
      sku: product.sku || null,
      barcode: product.barcode || null,
      status: product.status || null
    }
  });

  if (error) throw error;
}

// Fills the legacy photo_* columns from uploaded intake images so existing
// thumbnails and the public storefront keep working. Only empty slots are
// filled; the full photo set always lives in product_images.
export function assignPhotoSlots(product, images) {
  const updated = { ...product };

  images.forEach((image) => {
    const slots =
      image.type === "label_barcode"
        ? ["photo_label", "photo_extra_1", "photo_extra_2"]
        : ["photo_main", "photo_extra_1", "photo_extra_2"];
    const slot = slots.find((field) => !updated[field]);
    if (slot) updated[slot] = image.url;
  });

  return updated;
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

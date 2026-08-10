// ============================================================================
// General Merchandise Shop transform (pure, deterministic, no I/O).
//
// Turns one Petra workbook row into the PUBLIC marketplace contract consumed by
// `sanitizeMarketplaceProduct()` in src/lib/marketplace-catalog.mjs.
//
// Vocabulary boundary (docs/petra-import-plan.md) is preserved exactly:
//   VENDOR SKU -> manufacturer_mpn + public sku (live-catalog convention)
//   PETRA SKU  -> supplier SKU: PRIVATE. Never emitted by buildPublicRecord().
//   PRICE      -> supplier dealer cost: PRIVATE. Only an input to the price rule.
//   MAP / MSRP -> PRIVATE. MAP is a price floor input; MSRP is review evidence.
//   UPC        -> gtin, emitted only when the checksum validates.
//
// Pricing follows the rule already established in
// scripts/generate-petra-public-pricing.mjs: public price = dealer cost x 2,
// raised to MAP when MAP is higher, rounded to cents. Authorized by Danny on
// 2026-08-10 ("double all prices when putting them on the site").
//
// Petra imagery is published under the supplier's verbal authorization to
// Danny (2026-08-10) covering everything in the product download document.
// ============================================================================

import {
  expandAbbreviations,
  gtinCheckDigitValid,
  normalizeGtin,
  normalizeManufacturer,
  normalizeMpn,
  normalizeWhitespace,
  slugify,
} from "./petra-transform.mjs";
import { calculatePublicPrice } from "../generate-petra-public-pricing.mjs";

// --- Department mapping -------------------------------------------------------
//
// The 12 Petra PRODUCT CLASS values collapse onto the eight stable public
// departments already declared in src/config/marketplace.mjs. `deals` is not a
// source class: it is served by the clearance flag, so nothing maps to it here.
export const PETRA_CLASS_TO_DEPARTMENT = Object.freeze({
  "Home Theater, Audio & Music": "electronics",
  "Computers, Tablets & Gaming": "electronics",
  "TVs & Projectors": "electronics",
  "Cell Phones & Accessories": "electronics",
  "Kitchen": "home-kitchen",
  "Home & Office": "home-kitchen",
  "Tools & Home Improvement": "tools",
  "Automotive & Marine": "automotive-marine",
  "Outdoor & Fitness": "outdoor-fitness",
  "Fitness Technology & Equipment": "outdoor-fitness",
  "Health & Beauty": "health-beauty",
  "Appliance Parts & RTO": "appliance-parts",
  "Appliance Accessories, Tools & RTO": "appliance-parts",
});

export const DEPARTMENT_NAMES = Object.freeze({
  electronics: "Electronics",
  "home-kitchen": "Home & Kitchen",
  tools: "Tools & Home Improvement",
  "automotive-marine": "Automotive & Marine",
  "outdoor-fitness": "Outdoor & Fitness",
  "health-beauty": "Health & Beauty",
  "appliance-parts": "Appliance Parts",
  deals: "Deals",
});

// A row whose PRODUCT CLASS is unknown is routed by its SUBCATEGORY text rather
// than silently dropped, so a future workbook cannot lose products to a rename.
const SUBCATEGORY_FALLBACK = [
  [/appliance part/i, "appliance-parts"],
  [/automotive|marine|vehicle/i, "automotive-marine"],
  [/kitchen|cookware|utensil|small appliance|home d|household/i, "home-kitchen"],
  [/health|beauty|personal care/i, "health-beauty"],
  [/outdoor|fitness|sport|camping|patio|lawn|garden/i, "outdoor-fitness"],
  [/tool|hardware|electrical|adhesive|paint|plumbing/i, "tools"],
  [/audio|video|speaker|headphone|computer|cable|phone|tv|camera|gaming|network|battery|batteries|power/i, "electronics"],
];

export function resolveDepartment(row) {
  const productClass = normalizeWhitespace(row["PRODUCT CLASS"]);
  const mapped = PETRA_CLASS_TO_DEPARTMENT[productClass];
  if (mapped) return { slug: mapped, name: DEPARTMENT_NAMES[mapped], basis: "product_class" };

  const haystack = [row["SUBCATEGORY"], row["SUBCATEGORY2"], row["SUBCATEGORY3"], row["DESCRIPTION"]]
    .map((part) => normalizeWhitespace(part))
    .join(" ");
  for (const [pattern, slug] of SUBCATEGORY_FALLBACK) {
    if (pattern.test(haystack)) return { slug, name: DEPARTMENT_NAMES[slug], basis: "subcategory" };
  }
  // Last resort keeps the product listed and findable rather than dropping it.
  return { slug: "electronics", name: DEPARTMENT_NAMES.electronics, basis: "default" };
}

// --- Field helpers -----------------------------------------------------------

// Petra bullet lists arrive as "&bull;"-delimited runs. Split BEFORE the shared
// normalizer, which collapses each bullet marker into "; ".
export function parseSpecBullets(raw) {
  return String(raw ?? "")
    .split(/&bull;|&#8226;|•/gi)
    .map((part) => normalizeWhitespace(part).replace(/;+\s*$/, "").trim())
    .filter((part) => part.length > 1);
}

// Petra images live in an S3 bucket named "petraimages.com". A dotted bucket name
// cannot be served over valid TLS — the virtual-hosted host does not match AWS's
// *.s3.amazonaws.com wildcard certificate, and S3 rejects path-style addressing
// for this bucket — so the images exist over http only. An http <img> on an https
// page is blocked as mixed content, so the URL cannot simply be rewritten to
// https: it must be proxied.
//
// We therefore publish a first-party path that the netlify.toml `/shop-images/*`
// rule proxies to the bucket. Only the filename is carried over, and only from
// the expected Petra host, so a malformed or unexpected source URL yields no
// image rather than an arbitrary proxy target.
export const IMAGE_PROXY_PREFIX = "/shop-images/";
const PETRA_IMAGE_HOST = /^https?:\/\/petraimages\.com\.s3\.amazonaws\.com\//i;

export function normalizeImageUrl(raw) {
  const url = normalizeWhitespace(raw);
  if (!url || !PETRA_IMAGE_HOST.test(url)) return "";
  const file = url.split("/").pop().split("?")[0];
  // Keep it to a plain image filename: no traversal, no nested path.
  if (!/^[A-Za-z0-9._-]+\.(jpg|jpeg|png|webp|gif)$/i.test(file)) return "";
  return `${IMAGE_PROXY_PREFIX}${file}`;
}

// --- GTIN recovery ------------------------------------------------------------
//
// The workbook stores UPC as a NUMBER, so Excel silently drops leading zeros:
// a UPC-12 of "086844413619" arrives as 86844413619 (11 digits). In this
// workbook 1,234 values are exactly 11 digits long and every one of them
// validates once the zero is restored.
//
// This is recovery of a known spreadsheet artifact, not invention: the restored
// value must pass the GS1 mod-10 check digit, which a wrong guess fails 9 times
// out of 10. `normalizeGtin()` keeps its stricter "never pads" contract for the
// telecom importer; this function is the marketplace-only relaxation, and it
// only ever prepends zeros — no digit is altered, added in the middle, or
// truncated.
//
// Correct GTINs are what let Google Merchant Center match a listing to a known
// product, so recovering 1,237 of them is the single biggest Shopping win here.
export function recoverGtin(raw) {
  const strict = normalizeGtin(raw);
  if (strict.valid) return { gtin: strict.gtin, valid: true, basis: "as_supplied" };

  const digits = normalizeWhitespace(raw).replace(/\D/g, "");
  if (!digits) return { gtin: "", valid: false, basis: "missing" };

  for (const length of [8, 12, 13, 14]) {
    if (digits.length >= length) continue;
    const padded = digits.padStart(length, "0");
    if (gtinCheckDigitValid(padded)) {
      return { gtin: padded, valid: true, basis: "leading_zero_restored" };
    }
  }
  return { gtin: "", valid: false, basis: "unrecoverable" };
}

// --- Google Shopping classification ------------------------------------------
//
// `google_product_category` is intentionally kept at Google's TOP-LEVEL taxonomy
// names, which are stable and safe to assert. A wrong deep path is a Merchant
// Center disapproval, and Google refines categorisation itself, so precision
// here buys nothing. `product_type` below carries our own full taxonomy, is
// free-form by specification, and is where the real signal lives.
export const GOOGLE_CATEGORY_BY_DEPARTMENT = Object.freeze({
  electronics: "Electronics",
  "home-kitchen": "Home & Garden",
  tools: "Hardware",
  "automotive-marine": "Vehicles & Parts",
  "outdoor-fitness": "Sporting Goods",
  "health-beauty": "Health & Beauty",
  "appliance-parts": "Home & Garden",
  deals: "Home & Garden",
});

// Our own taxonomy string: "Department > Subcategory > Finer subcategory".
export function productType(row, departmentName) {
  return [departmentName, normalizeWhitespace(row["SUBCATEGORY"]), normalizeWhitespace(row["SUBCATEGORY2"])]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .filter((part, index, all) => all.indexOf(part) === index)
    .join(" > ");
}

export function isDiscontinued(row) {
  return /discontinued/i.test(normalizeWhitespace(row["NOTES1"]));
}

export function availableQuantity(row) {
  const parsed = Number(String(row["AVAILABLE"] ?? "").replace(/[,\s]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

export function availabilityText(row) {
  const quantity = availableQuantity(row);
  if (quantity > 0) return quantity >= 10 ? "In stock" : `In stock — only ${quantity} left`;
  return isDiscontinued(row) ? "Final stock — ask us to check" : "Available to order";
}

// Keywords power the shop's client-side filter. Keep them public-safe: brand,
// MPN and descriptive text only, never the supplier SKU.
export function buildSearchKeywords(row, { brand, mpn }) {
  const parts = [
    brand,
    mpn,
    normalizeWhitespace(row["SUBCATEGORY"]),
    normalizeWhitespace(row["SUBCATEGORY2"]),
    normalizeWhitespace(row["SUBCATEGORY3"]),
    normalizeWhitespace(row["PRODUCT CLASS"]),
  ];
  const seen = new Set();
  const keywords = [];
  for (const part of parts) {
    const cleaned = String(part || "").trim();
    if (!cleaned) continue;
    const dedupeKey = cleaned.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    keywords.push(cleaned);
  }
  return keywords;
}

// --- Public record -----------------------------------------------------------

// Every key here is part of the published contract. Adding a supplier-side key
// is a boundary violation; assertPublicRecordClean() is the enforcement.
// `capAtMsrp` is off by default: the authorized rule is cost x 2 (2026-08-10).
// Turning it on keeps the doubling wherever it lands at or under the
// manufacturer's suggested retail and caps the rest at MSRP, never going below
// the MAP floor. Offered because doubling puts ~66% of this workbook above MSRP,
// which competes against the Google Shopping ranking goal.
export function buildPublicRecord(row, index = 0, { capAtMsrp = false } = {}) {
  const flags = [];
  const brand = normalizeManufacturer(row["BRAND NAME"]);
  const mpn = normalizeMpn(row["VENDOR SKU"]);
  const gtin = recoverGtin(row["UPC"]);
  const department = resolveDepartment(row);
  const terseTitle = expandAbbreviations(row["DESCRIPTION"]);

  // LONG DESC carries the full retail title ("Brand MPN Descriptive Title");
  // KEYWORDS carries the same title without the brand/MPN prefix. Both are far
  // better public copy than the terse all-caps DESCRIPTION, which is the
  // fallback when either is blank. No claim is invented here.
  const retailTitle = normalizeWhitespace(row["LONG DESC"]);
  const descriptiveTitle = normalizeWhitespace(row["KEYWORDS"]);
  const title = retailTitle || descriptiveTitle || terseTitle;
  const shortDescription = descriptiveTitle || terseTitle;
  const specs = parseSpecBullets(row["SPECS"]);

  const pricing = calculatePublicPrice({ cost: row["PRICE"], map: row["MAP"] });
  const msrp = Number(String(row["MSRP"] ?? "").replace(/[$,\s]/g, ""));
  const mapFloor = Number(String(row["MAP"] ?? "").replace(/[$,\s]/g, ""));
  if (
    capAtMsrp
    && pricing.status === "priced"
    && Number.isFinite(msrp) && msrp > 0
    && pricing.publicPrice > msrp
    && !(Number.isFinite(mapFloor) && mapFloor > msrp) // never price under MAP
  ) {
    pricing.publicPrice = Math.round((msrp + Number.EPSILON) * 100) / 100;
    pricing.basis = "msrp_cap";
    flags.push("price_capped_at_msrp");
  }
  const discontinued = isDiscontinued(row);
  const quantity = availableQuantity(row);
  const imageUrl = normalizeImageUrl(row["IMAGE URL"]);

  if (!mpn) flags.push("missing_mpn");
  if (!title) flags.push("missing_title");
  if (!brand) flags.push("missing_brand");
  if (!imageUrl) flags.push("missing_image");
  if (!gtin.valid) flags.push("unverified_gtin");
  if (gtin.basis === "leading_zero_restored") flags.push("gtin_leading_zero_restored");
  if (pricing.status !== "priced") flags.push(`price_${pricing.status}`);
  // Recorded for review: the manufacturer part number and the supplier SKU are
  // the same string here, so the public SKU is worth a human glance even though
  // the value itself is the manufacturer's and public.
  if (mpn && normalizeWhitespace(row["PETRA SKU"]).toUpperCase() === mpn.toUpperCase()) {
    flags.push("supplier_sku_matches_mpn");
  }
  if (department.basis !== "product_class") flags.push(`department_${department.basis}`);
  if (discontinued) flags.push("discontinued");

  const slug = slugify(brand, mpn || title);
  const priced = pricing.status === "priced" && Number(pricing.publicPrice) > 0;

  return {
    sourceRow: index + 1,
    flags,
    priceBasis: priced ? pricing.basis : null,
    record: {
      id: slug ? `gm-${slug}` : "",
      // Public SKU follows the live convention: the manufacturer part number,
      // never the Petra supplier SKU.
      sku: mpn,
      slug,
      brand,
      title,
      manufacturer_mpn: mpn,
      // Only a checksum-valid GTIN is published; schema.org gtin markup and
      // Merchant Center identification both depend on it being real.
      gtin: gtin.valid ? gtin.gtin : "",
      // Google requires a condition; REFURB is the workbook's own flag.
      condition: /^y(es)?$/i.test(normalizeWhitespace(row["REFURB"])) ? "refurbished" : "new",
      google_product_category: GOOGLE_CATEGORY_BY_DEPARTMENT[department.slug] || "Home & Garden",
      product_type: productType(row, department.name),
      department_slug: department.slug,
      department_name: department.name,
      subcategory: normalizeWhitespace(row["SUBCATEGORY"]),
      short_description: shortDescription,
      long_description: specs.join("\n"),
      search_keywords: buildSearchKeywords(row, { brand, mpn }),
      availability: availabilityText(row),
      // Discontinued stock is the shop's clearance/Deals pool.
      clearance: discontinued && quantity > 0,
      price_mode: priced ? "fixed" : "request_quote",
      public_price: priced ? pricing.publicPrice : null,
      currency_code: "USD",
      image_url: imageUrl,
      image_alt: title ? `${title} product image` : "",
      meta_title: title ? `${title} | Telecom Store Marketplace` : "",
      meta_description: shortDescription
        ? `${shortDescription} Buy ${brand || "this item"} at Telecom Store.`.slice(0, 320)
        : "",
      published_at: null,
      updated_at: null,
    },
  };
}

// --- Boundary enforcement ----------------------------------------------------

export const ALLOWED_PUBLIC_KEYS = Object.freeze([
  "id", "sku", "slug", "brand", "title", "manufacturer_mpn", "gtin", "condition",
  "google_product_category", "product_type",
  "department_slug", "department_name", "subcategory", "short_description",
  "long_description", "search_keywords", "availability", "clearance",
  "price_mode", "public_price", "currency_code", "image_url", "image_alt",
  "meta_title", "meta_description", "published_at", "updated_at",
]);

const FORBIDDEN_KEY_PATTERN = /petra|supplier|dealer|cost|wholesale|\bmap\b|msrp|margin|markup|invoice|notes\d|refurb|po[_\s-]?eta/i;

// Hard boundary checks. These throw, so the build fails closed rather than
// publishing a supplier-private field.
//
// Deliberately NOT a hard check: the supplier SKU string appearing inside
// supplier-authored descriptive copy. Petra prints manufacturer cross-reference
// numbers in its own SPECS text, and for some brands (ERP appliance parts) the
// Petra SKU *is* the manufacturer's part number — "cross reference numbers
// include ER2183141". That is the manufacturer's identifier in the
// manufacturer's words, not disclosure of a private key. Those rows are flagged
// and counted in the build report instead; see supplierSkuInCopy() below.
export function assertPublicRecordClean(record, sourceRow = {}) {
  const keys = Object.keys(record);
  const unexpected = keys.filter((key) => !ALLOWED_PUBLIC_KEYS.includes(key));
  if (unexpected.length) {
    throw new Error(`Public record exposes unexpected keys: ${unexpected.join(", ")}`);
  }
  const forbiddenKey = keys.find((key) => FORBIDDEN_KEY_PATTERN.test(key));
  if (forbiddenKey) {
    throw new Error(`Public record key is supplier-private: ${forbiddenKey}`);
  }

  // The real identity risk: the supplier SKU must never become the public SKU.
  // It is allowed to equal the public SKU only when it also equals the vendor
  // MPN, because then the value is the manufacturer's part number (29 rows).
  const supplierSku = normalizeWhitespace(sourceRow["PETRA SKU"]).toUpperCase();
  const vendorMpn = normalizeMpn(sourceRow["VENDOR SKU"]).toUpperCase();
  const publicSku = String(record.sku || "").toUpperCase();
  if (supplierSku && publicSku === supplierSku && publicSku !== vendorMpn) {
    throw new Error(`Public SKU is the supplier SKU, not the manufacturer part number (${record.sku})`);
  }

  // The dealer cost is the one figure that must never surface. MAP is NOT
  // checked here: calculatePublicPrice() legitimately publishes MAP as the price
  // floor, so a MAP-basis price is correct, not a leak. The check is limited to
  // the record's price fields — scanning free text would false-positive on spec
  // bullets that happen to contain the same number (weights, dimensions).
  const cost = Number(String(sourceRow["PRICE"] ?? "").replace(/[$,\s]/g, ""));
  if (Number.isFinite(cost) && cost > 0 && record.public_price !== null) {
    if (Math.abs(Number(record.public_price) - cost) < 0.005) {
      throw new Error(`Published price equals the private dealer cost (${record.sku})`);
    }
  }
  return true;
}

// Reportable, non-fatal: the supplier SKU string occurs in published copy we are
// republishing verbatim under Petra's authorization.
export function supplierSkuInCopy(record, sourceRow = {}) {
  const supplierSku = normalizeWhitespace(sourceRow["PETRA SKU"]).toUpperCase();
  const mpn = String(record.manufacturer_mpn || "").toUpperCase();
  if (!supplierSku || supplierSku === mpn) return false;
  const copy = [record.title, record.short_description, record.long_description, record.meta_description]
    .join(" ")
    .toUpperCase();
  return copy.includes(supplierSku);
}

export function buildCatalog(rows, options = {}) {
  const results = [];
  const seenSlug = new Map();
  const skipped = [];

  rows.forEach((row, index) => {
    const built = buildPublicRecord(row, index, options);
    if (!built.record.sku || !built.record.slug || !built.record.title) {
      skipped.push({ sourceRow: built.sourceRow, reason: "missing_public_identity", flags: built.flags });
      return;
    }
    assertPublicRecordClean(built.record, row);
    if (supplierSkuInCopy(built.record, row)) built.flags.push("supplier_sku_in_supplier_copy");

    // A repeated brand+MPN is the same product in the workbook; keep the first
    // occurrence and prefer the variant that is actually in stock.
    const existing = seenSlug.get(built.record.slug);
    if (existing) {
      const existingStocked = /^In stock/.test(existing.record.availability);
      const candidateStocked = /^In stock/.test(built.record.availability);
      if (candidateStocked && !existingStocked) {
        results[existing.position] = built;
        seenSlug.set(built.record.slug, { ...built, position: existing.position });
      }
      skipped.push({ sourceRow: built.sourceRow, reason: "duplicate_slug", flags: built.flags });
      return;
    }
    seenSlug.set(built.record.slug, { ...built, position: results.length });
    results.push(built);
  });

  return { built: results, skipped };
}

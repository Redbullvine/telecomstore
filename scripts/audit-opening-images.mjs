import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import Papa from "papaparse";

const root = process.cwd();
const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const sourcePath = arg("--source");
if (!sourcePath) throw new Error("--source must point to the private Petra CSV");

const catalogPath = arg("--catalog") || path.join(root, "src/data/opening-catalog.json");
const stagingRoot = arg("--staging") || path.join(root, "tmp/opening-image-staging");
const ownedInputs = String(arg("--owned-images") || "").split(",").map((value) => value.trim()).filter(Boolean);
const auditDate = new Date().toISOString().slice(0, 10);
const imageDir = path.join(stagingRoot, "files");

const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"));
if (catalog.length !== 206) throw new Error(`Expected 206 opening products; found ${catalog.length}`);

const sourceLines = (await fs.readFile(sourcePath, "utf8")).replace(/^\uFEFF/, "").split(/\r?\n/);
const parsed = Papa.parse(sourceLines.slice(2).join("\n"), { header: true, skipEmptyLines: true });
if (parsed.errors.length) throw new Error(parsed.errors.map((error) => error.message).join("; "));
const supplierByMpn = new Map(parsed.data.map((row) => [String(row["VENDOR SKU"] || "").trim(), row]));

await fs.mkdir(imageDir, { recursive: true });

function safeName(value) {
  return String(value).replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "") || "image";
}

function domainOf(value) {
  try { return new URL(value).hostname.toLowerCase(); } catch { return "invalid-url"; }
}

function normalizedUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    return `${url.protocol}//${url.hostname.toLowerCase()}${url.pathname}`;
  } catch { return String(value).trim(); }
}

function nearUrlFingerprint(value) {
  return normalizedUrl(value).toLowerCase().replace(/\/(?:\d+x\d+|large|medium|small)\//g, "/");
}

function dimensions(buffer, contentType = "") {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 10 && ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"))) {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }
  if (buffer.length >= 16 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    const kind = buffer.subarray(12, 16).toString("ascii");
    if (kind === "VP8X" && buffer.length >= 30) {
      return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
    }
    if (kind === "VP8L" && buffer.length >= 25) {
      const bits = buffer.readUInt32LE(21);
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    }
  }
  if ((contentType.includes("jpeg") || (buffer[0] === 0xff && buffer[1] === 0xd8)) && buffer.length >= 4) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1];
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      }
      if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
      const segmentLength = buffer.readUInt16BE(offset + 2);
      if (segmentLength < 2) break;
      offset += 2 + segmentLength;
    }
  }
  return { width: null, height: null };
}

function extensionFor(contentType, sourceUrl) {
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("webp")) return ".webp";
  if (contentType.includes("gif")) return ".gif";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return ".jpg";
  const ext = path.extname(new URL(sourceUrl).pathname).toLowerCase();
  return [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext) ? ext : ".bin";
}

async function fetchCandidate(product, supplierRow) {
  const sourceUrl = String(supplierRow["IMAGE URL"] || "").trim();
  const base = {
    public_sku: product.sku,
    manufacturer_mpn: product.manufacturer_mpn,
    manufacturer: product.brand,
    category: product.category,
    title: product.title,
    source_class: "petra_supplier_feed",
    source_domain: domainOf(sourceUrl),
    source_url: sourceUrl,
    normalized_url: normalizedUrl(sourceUrl),
    near_url_fingerprint: nearUrlFingerprint(sourceUrl),
    rights_status: "pending_petra_confirmation",
    approval_decision: "not_approved",
    match_status: "exact_mpn_catalog_association_visual_review_pending",
    match_confidence: "medium",
    response_status: sourceUrl ? "pending" : "missing_url",
    http_status: null,
    content_type: "",
    file_size_bytes: null,
    pixel_width: null,
    pixel_height: null,
    sha256: "",
    local_file: "",
    error: ""
  };
  if (!sourceUrl) return base;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(sourceUrl, { redirect: "follow", signal: controller.signal });
    base.http_status = response.status;
    base.content_type = String(response.headers.get("content-type") || "").split(";")[0].toLowerCase();
    if (!response.ok) {
      base.response_status = "http_error";
      base.error = `HTTP ${response.status}`;
      return base;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const size = dimensions(buffer, base.content_type);
    const ext = extensionFor(base.content_type, sourceUrl);
    const filename = `${safeName(product.sku)}${ext}`;
    await fs.writeFile(path.join(imageDir, filename), buffer);
    base.response_status = base.content_type.startsWith("image/") ? "working" : "unexpected_content_type";
    base.file_size_bytes = buffer.length;
    base.pixel_width = size.width;
    base.pixel_height = size.height;
    base.sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    base.local_file = `files/${filename}`;
    if (!size.width || !size.height) base.error = "Image dimensions could not be parsed";
    return base;
  } catch (error) {
    base.response_status = error.name === "AbortError" ? "timeout" : "fetch_error";
    base.error = error.message;
    return base;
  } finally {
    clearTimeout(timer);
  }
}

const pending = catalog.map((product) => {
  const supplierRow = supplierByMpn.get(String(product.manufacturer_mpn || "").trim());
  if (!supplierRow) throw new Error(`No Petra row matched manufacturer MPN ${product.manufacturer_mpn}`);
  return { product, supplierRow };
});

const candidates = new Array(pending.length);
let nextIndex = 0;
async function worker() {
  while (nextIndex < pending.length) {
    const index = nextIndex++;
    candidates[index] = await fetchCandidate(pending[index].product, pending[index].supplierRow);
    if ((index + 1) % 25 === 0 || index + 1 === pending.length) process.stdout.write(`Audited ${index + 1}/${pending.length}\n`);
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()));

async function collectOwned(input, output) {
  const stat = await fs.stat(input);
  if (stat.isFile()) { output.push(input); return; }
  const entries = await fs.readdir(input, { withFileTypes: true });
  for (const entry of entries) {
    const child = path.join(input, entry.name);
    if (entry.isDirectory()) await collectOwned(child, output);
    else if (/\.(?:jpe?g|png|webp|gif)$/i.test(entry.name)) output.push(child);
  }
}

const ownedFiles = [];
for (const input of ownedInputs) {
  try { await collectOwned(input, ownedFiles); } catch { /* Optional local source. */ }
}
const catalogKeys = new Map();
for (const product of catalog) {
  catalogKeys.set(String(product.sku).toLowerCase(), product);
  catalogKeys.set(String(product.manufacturer_mpn).toLowerCase(), product);
}
const ownedReview = ownedFiles.map((file) => {
  const stem = path.basename(file, path.extname(file)).toLowerCase();
  const product = catalogKeys.get(stem);
  return {
    filename: path.basename(file),
    source_class: "user_owned_local",
    matched_public_sku: product?.sku || "",
    exact_filename_match: Boolean(product),
    rights_status: product ? "user_owned_exact_match_manual_content_review" : "unmatched_not_for_opening_catalog",
    file_size_bytes: null
  };
});
for (const entry of ownedReview) {
  const file = ownedFiles.find((candidate) => path.basename(candidate) === entry.filename);
  if (file) entry.file_size_bytes = (await fs.stat(file)).size;
}

function groupsFor(field) {
  const groups = new Map();
  for (const candidate of candidates) {
    const value = candidate[field];
    if (!value) continue;
    const rows = groups.get(value) || [];
    rows.push(candidate);
    groups.set(value, rows);
  }
  return new Map([...groups].filter(([, rows]) => rows.length > 1).map(([key, rows], index) => [key, { id: `${field}-${index + 1}`, count: rows.length }]));
}
const urlGroups = groupsFor("normalized_url");
const nearUrlGroups = groupsFor("near_url_fingerprint");
const hashGroups = groupsFor("sha256");

const auditRows = candidates.map((candidate) => ({
  public_sku: candidate.public_sku,
  manufacturer_mpn: candidate.manufacturer_mpn,
  manufacturer: candidate.manufacturer,
  category: candidate.category,
  title: candidate.title,
  source_class: candidate.source_class,
  source_domain: candidate.source_domain,
  response_status: candidate.response_status,
  http_status: candidate.http_status ?? "",
  content_type: candidate.content_type,
  pixel_width: candidate.pixel_width ?? "",
  pixel_height: candidate.pixel_height ?? "",
  file_size_bytes: candidate.file_size_bytes ?? "",
  duplicate_url_group: urlGroups.get(candidate.normalized_url)?.id || "",
  near_duplicate_url_group: nearUrlGroups.get(candidate.near_url_fingerprint)?.id || "",
  duplicate_content_group: hashGroups.get(candidate.sha256)?.id || "",
  match_status: candidate.match_status,
  match_confidence: candidate.match_confidence,
  rights_status: candidate.rights_status,
  approved_public_image_count: 0,
  storefront_image_status: "category_placeholder",
  review_status: "manual_review_required",
  notes: candidate.error || "Confirm exact product appearance and Petra reseller image rights before approval."
}));

const manualRows = candidates.map((candidate) => ({
  public_sku: candidate.public_sku,
  manufacturer_mpn: candidate.manufacturer_mpn,
  manufacturer: candidate.manufacturer,
  title: candidate.title,
  source_class: candidate.source_class,
  source_domain: candidate.source_domain,
  response_status: candidate.response_status,
  resolution: candidate.pixel_width && candidate.pixel_height ? `${candidate.pixel_width}x${candidate.pixel_height}` : "unknown",
  match_status: candidate.match_status,
  rights_status: candidate.rights_status,
  recommended_action: "Confirm exact MPN image and obtain Petra reseller-use permission",
  approval_checkbox: "",
  reviewer_status: "pending_review",
  reviewer_notes: ""
}));

function csv(rows) {
  return Papa.unparse(rows, { newline: "\n", quotes: true }) + "\n";
}

const manifest = {
  schema_version: 1,
  generated_on: auditDate,
  policy: {
    public_catalog_rule: "Only user-owned images or official manufacturer assets with explicit reseller-use permission may be approved.",
    supplier_rule: "Petra candidates remain private and pending_petra_confirmation; never hotlink supplier assets.",
    approval_workflow: "A future reviewer adds only an approved local public asset reference after MPN and rights verification."
  },
  counts: {
    products: catalog.length,
    candidate_images: candidates.length,
    approved_public_images: 0,
    pending_petra_confirmation: candidates.length,
    placeholders_required: catalog.length
  },
  products: Object.fromEntries(catalog.map((product) => [product.sku, {
    manufacturer_mpn: product.manufacturer_mpn,
    image_rights_status: "pending_petra_confirmation",
    approved_public_images: [],
    pending_candidate_count: 1,
    storefront_fallback: "category_placeholder"
  }]))
};

const privateAudit = {
  generated_on: auditDate,
  warning: "PRIVATE LOCAL REVIEW DATA — contains supplier image URLs; never commit or publish.",
  candidates,
  unmatched_or_unassociated_user_owned_assets: ownedReview
};

function esc(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
const cards = candidates.map((candidate) => `
  <article class="card" data-sku="${esc(candidate.public_sku)}">
    <div class="image">${candidate.local_file ? `<img src="${esc(candidate.local_file)}" alt="Review candidate for ${esc(candidate.manufacturer)} ${esc(candidate.manufacturer_mpn)}">` : `<div class="missing">${esc(candidate.response_status)}</div>`}</div>
    <div class="body"><h2>${esc(candidate.title)}</h2><p><b>${esc(candidate.manufacturer)}</b></p>
    <dl><dt>Public SKU</dt><dd>${esc(candidate.public_sku)}</dd><dt>Manufacturer MPN</dt><dd>${esc(candidate.manufacturer_mpn)}</dd><dt>Source</dt><dd>Petra supplier feed · ${esc(candidate.source_domain)}</dd><dt>Resolution</dt><dd>${candidate.pixel_width || "?"} × ${candidate.pixel_height || "?"}</dd><dt>Status</dt><dd>${esc(candidate.response_status)} · ${esc(candidate.rights_status)}</dd></dl>
    <label><input type="checkbox" data-field="approved"> Approve only after exact-product and rights verification</label>
    <select data-field="status"><option>pending_review</option><option>exact_product_confirmed_rights_pending</option><option>approved_for_public_use</option><option>rejected</option></select>
    <textarea data-field="notes" placeholder="Reviewer notes"></textarea></div>
  </article>`).join("");
const preview = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Opening image review — private local preview</title><style>
body{font-family:Arial,sans-serif;margin:0;background:#f3f5f4;color:#16211d}.top{position:sticky;top:0;background:#14211d;color:#fff;padding:16px;z-index:2}.top h1{margin:0 0 6px;font-size:22px}.top p{margin:0;color:#c9d4cf}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:14px;padding:14px}.card{background:#fff;border:1px solid #d7dedb;border-radius:10px;overflow:hidden}.image{aspect-ratio:4/3;display:grid;place-items:center;background:#fff;border-bottom:1px solid #e1e6e3}.image img{width:100%;height:100%;object-fit:contain}.missing{color:#8b2d2d}.body{padding:12px}.body h2{font-size:16px;margin:0 0 6px}.body p{margin:0 0 8px;color:#235c48}dl{display:grid;grid-template-columns:110px 1fr;gap:4px;font-size:12px}dt{color:#66736e}dd{margin:0;word-break:break-word}label{display:block;font-size:12px;margin:10px 0}select,textarea{box-sizing:border-box;width:100%;margin-top:6px;padding:7px}textarea{min-height:64px}</style></head><body>
<div class="top"><h1>Private opening image review</h1><p>206 candidates · nothing here is approved for public use · local review only</p></div><main class="grid">${cards}</main>
<script>const key='opening-image-review-v1';const saved=JSON.parse(localStorage.getItem(key)||'{}');document.querySelectorAll('.card').forEach(card=>{const sku=card.dataset.sku;card.querySelectorAll('[data-field]').forEach(el=>{const field=el.dataset.field;if(saved[sku]?.[field]!==undefined){if(el.type==='checkbox')el.checked=saved[sku][field];else el.value=saved[sku][field]}el.addEventListener('change',()=>{saved[sku] ||= {};saved[sku][field]=el.type==='checkbox'?el.checked:el.value;localStorage.setItem(key,JSON.stringify(saved))})})});</script></body></html>`;

const working = candidates.filter((candidate) => candidate.response_status === "working").length;
const countBy = (items, key) => [...items.reduce((map, item) => map.set(item[key], (map.get(item[key]) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
const categoryTable = countBy(catalog, "category").map(([name, count]) => `| ${name} | ${count} |`).join("\n");
const manufacturerTable = countBy(catalog, "brand").map(([name, count]) => `| ${name} | ${count} |`).join("\n");
const resolutionTable = [...candidates.reduce((map, item) => {
  const key = item.pixel_width && item.pixel_height ? `${item.pixel_width}×${item.pixel_height}` : "unknown";
  map.set(key, (map.get(key) || 0) + 1);
  return map;
}, new Map())].map(([name, count]) => `| ${name} | ${count} |`).join("\n");
const duplicateDetails = [...hashGroups.values()].map((group) => {
  const rows = candidates.filter((candidate) => hashGroups.get(candidate.sha256)?.id === group.id);
  return `- ${group.id}: ${rows.map((row) => `${row.public_sku} (${row.title})`).join(" and ")} are byte-for-byte identical and require separate exact-product review.`;
}).join("\n") || "- None.";
const validGtinCount = catalog.filter((product) => /^\d{8}$|^\d{12,14}$/.test(String(product.gtin || ""))).length;
const report = `# Opening catalog image audit\n\nDate: ${auditDate}\n\n## Safety boundary\n\nThis audit covers all 206 opening products. No supplier image is public, hotlinked, copied into the public build, or approved by this work. Raw Petra image URLs and downloaded review files exist only under the ignored \`tmp/opening-image-staging/\` directory.\n\nThe approval rule is intentionally strict: only user-owned images or official manufacturer assets with explicit reseller-use permission may become public. Every Petra candidate remains \`pending_petra_confirmation\`.\n\n## Results\n\n- Products audited: ${catalog.length}\n- Petra catalog matches by exact manufacturer MPN: ${pending.length}\n- Candidate image URLs: ${candidates.length}\n- Working image responses: ${working}\n- Broken, timed out, or unexpected responses: ${candidates.length - working}\n- Approved public images: 0\n- Products using safe category placeholders: ${catalog.length}\n- Exact duplicate URL groups: ${urlGroups.size}\n- Near-duplicate URL groups: ${nearUrlGroups.size}\n- Exact duplicate content groups: ${hashGroups.size}\n- User-owned files inspected: ${ownedReview.length}\n- User-owned files with an exact opening SKU/MPN filename match: ${ownedReview.filter((row) => row.exact_filename_match).length}\n- Official manufacturer image candidates with explicit reseller-use permission found locally: 0\n\nA supplier-catalog association proves which Petra row supplied a URL; it does not prove that the pixels depict the exact MPN. Therefore every candidate still requires visual confirmation in the private local preview.\n\n### Image resolution\n\n| Resolution | Candidate count |\n|---|---:|\n${resolutionTable}\n\n### Duplicate-content review\n\n${duplicateDetails}\n\n## Catalog organization\n\n### Categories\n\n| Customer-facing category | Products |\n|---|---:|\n${categoryTable}\n\n### Manufacturers\n\n| Manufacturer | Products |\n|---|---:|\n${manufacturerTable}\n\nThe storefront is searchable by title, manufacturer, category, public SKU, manufacturer MPN, validated GTIN, and derived public-safe keywords. Cards and product details retain quote controls and category placeholders until an image is approved.\n\nCustomer-facing fulfillment language is: **Availability and shipping are confirmed before payment.**\n\n## Google Shopping and search readiness\n\n- Exact manufacturer MPN present: ${catalog.filter((product) => product.manufacturer_mpn).length}/${catalog.length}.\n- Validated GTIN present: ${validGtinCount}/${catalog.length}.\n- Approved public image reference present: 0/${catalog.length}.\n- Image alt-text behavior: ready for future approved assets; it combines manufacturer, title, and MPN.\n- Google Shopping readiness: **blocked**. No product has an approved public image, and 198 request-quote products have no public purchase price. The 8 fixed-price candidates remain non-checkout because shipping, destination, tax, and fulfillment guards are incomplete.\n- Organic search readiness: identity/search fields are present, but richer product copy and image assets must not be published until content rights and exact-product accuracy are confirmed.\n\n## Local review workflow\n\n1. Run \`node scripts/audit-opening-images.mjs --source <private-petra-csv> --owned-images <optional-local-image-paths>\`.\n2. Open \`tmp/opening-image-staging/review.html\` locally. It shows thumbnails, public SKU, manufacturer MPN, source class/domain, resolution, response status, rights status, an approval checkbox, a reviewer status, and notes.\n3. Confirm the image depicts the exact manufacturer and MPN.\n4. Obtain and retain explicit reseller-use permission for any supplier or manufacturer asset.\n5. Copy an approved asset into a controlled public product-image location using a neutral public filename. Never hotlink Petra.\n6. Update \`operations/opening-image-approval-manifest.json\` with only the approved local public reference, then run tests and build before release.\n\n## Known limitations and manual decisions\n\n- No production \`public.product_images\` records were queried or changed. The repository contains no approved opening-product image export to evaluate.\n- Existing official manufacturer manuals and pricing evidence are reference material, not image-use permission.\n- Unassociated user-owned warehouse photos remain outside this 206-product image set because filenames do not establish an exact SKU/MPN match.\n- Image rights, pixel-level exact-product confirmation, final alt text, and any richer supplier-authored copy require human approval.\n- The 8 approved prices remain fixed-price candidates, but checkout stays disabled because fulfillment, destination, shipping, and tax guards are not complete. The other 198 products remain request quote.\n`;

await fs.mkdir(path.join(root, "operations"), { recursive: true });
await fs.mkdir(path.join(root, "docs"), { recursive: true });
await fs.writeFile(path.join(root, "operations/opening-image-audit.csv"), csv(auditRows));
await fs.writeFile(path.join(root, "operations/opening-image-manual-review.csv"), csv(manualRows));
await fs.writeFile(path.join(root, "operations/opening-image-approval-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
await fs.writeFile(path.join(root, "docs/opening-image-audit-report.md"), report);
await fs.writeFile(path.join(stagingRoot, "private-image-audit.json"), JSON.stringify(privateAudit, null, 2) + "\n");
await fs.writeFile(path.join(stagingRoot, "review.html"), preview);

console.log(JSON.stringify({ products: catalog.length, candidates: candidates.length, working, approved: 0, pending: candidates.length, placeholders: catalog.length, duplicateUrlGroups: urlGroups.size, nearDuplicateUrlGroups: nearUrlGroups.size, duplicateContentGroups: hashGroups.size, ownedExactMatches: ownedReview.filter((row) => row.exact_filename_match).length }, null, 2));

// ============================================================================
// Probe every supplier product image and record which ones actually exist.
//
//   node scripts/audit-shop-images.mjs --source "Petra_Products.xlsx"
//
// Writes scripts/data/shop-image-audit.json — a tracked allowlist of image files
// confirmed to return HTTP 200. The catalog build reads it and publishes ONLY
// products whose image is on that list (Danny, 2026-08-12: "add items only with
// photos"), so a product never reaches the shop with a broken image.
//
// The workbook lists an image URL for every row, but 82 of them are absent from
// the bucket and return 403 — S3 answers 403 rather than 404 because the bucket
// denies listing. Transient 500s do occur, so each file gets several attempts
// before being judged missing.
//
// Requests go to the http origin directly, which is the only way to reach this
// bucket (see normalizeImageUrl for why https is impossible).
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { normalizeImageUrl, IMAGE_PROXY_PREFIX } from "./lib/general-merchandise.mjs";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const ROOT = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ORIGIN = "http://petraimages.com.s3.amazonaws.com/600x600/";
const CONCURRENCY = 24;
const ATTEMPTS = 3;

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const sourcePath = path.resolve(ROOT, arg("--source", "Petra_Products.xlsx"));
if (!fs.existsSync(sourcePath)) {
  console.error(`Source workbook not found: ${sourcePath}`);
  process.exit(1);
}

const workbook = XLSX.readFile(sourcePath, { raw: true, cellDates: false });
const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { range: 2, defval: null, raw: true })
  .filter((row) => String(row["VENDOR SKU"] ?? "").trim() || String(row["PETRA SKU"] ?? "").trim());

// Unique image filenames, derived through the same normalizer the build uses.
const files = [...new Set(
  rows.map((row) => normalizeImageUrl(row["IMAGE URL"])).filter(Boolean).map((url) => url.slice(IMAGE_PROXY_PREFIX.length)),
)].sort();

console.log(`Probing ${files.length} unique image files at ${CONCURRENCY} at a time (up to ${ATTEMPTS} attempts each)...`);

async function probe(file) {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${ORIGIN}${encodeURIComponent(file)}`, {
        method: "HEAD",
        signal: AbortSignal.timeout(20000),
      });
      if (response.ok) return { file, status: response.status, ok: true };
      // 403 here means "absent" and is final; 5xx and timeouts are worth retrying.
      if (response.status === 403 || response.status === 404) return { file, status: response.status, ok: false };
      if (attempt === ATTEMPTS) return { file, status: response.status, ok: false };
    } catch {
      if (attempt === ATTEMPTS) return { file, status: 0, ok: false };
    }
    await new Promise((resolve) => { setTimeout(resolve, 500 * attempt); });
  }
  return { file, status: 0, ok: false };
}

const results = [];
let next = 0;
let done = 0;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (next < files.length) {
    const index = next;
    next += 1;
    results[index] = await probe(files[index]);
    done += 1;
    if (done % 250 === 0) console.log(`  ${done}/${files.length}`);
  }
}));

const ok = results.filter((result) => result.ok).map((result) => result.file).sort();
const missing = results.filter((result) => !result.ok).map(({ file, status }) => ({ file, status }))
  .sort((a, b) => a.file.localeCompare(b.file));

const outPath = path.resolve(ROOT, "scripts/data/shop-image-audit.json");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify({
  // No supplier terms here: filenames and HTTP status only.
  note: "Allowlist of supplier image files confirmed to return HTTP 200. Regenerate with scripts/audit-shop-images.mjs.",
  checked: files.length,
  available: ok.length,
  missing_count: missing.length,
  available_files: ok,
  missing_files: missing,
}, null, 2)}\n`, "utf8");

console.log("");
console.log(`Available: ${ok.length}   Missing: ${missing.length}   (${((ok.length / Math.max(files.length, 1)) * 100).toFixed(1)}% have a real photo)`);
if (missing.length) {
  const byStatus = {};
  for (const item of missing) byStatus[item.status] = (byStatus[item.status] || 0) + 1;
  console.log(`Missing by HTTP status: ${Object.entries(byStatus).map(([status, count]) => `${status}=${count}`).join(", ")}`);
}
console.log(`Wrote ${path.relative(ROOT, outPath)}`);

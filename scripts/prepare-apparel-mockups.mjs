// ============================================================================
// Split supplied front/back apparel mockups into single-garment product images.
//
//   node scripts/prepare-apparel-mockups.mjs --source "<folder>"
//
// Each supplied file is a front-and-back pair on one canvas. Google wants the
// main product image to show a single garment, so this measures each garment
// from the pixels, crops it, and pads out to a square using the backdrop colour
// sampled from the source. The garment is never scaled or recoloured — only
// backdrop is added, so artwork, print, colour, and proportions are untouched.
//
// Writes <slug>-front.png and <slug>-back.png into public/images/custom-workwear
// and leaves the supplied originals where they are.
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const OUT_DIR = path.resolve(ROOT, "public/images/custom-workwear");
const TMP = path.resolve(ROOT, "tmp/apparel-crop");

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}
const SRC = arg("--source", "C:/Users/redbu/Projects/telecomstore/public/images/custom-workwear");

// Supplied file -> product slug. Mapping comes from the SKU labels that were
// printed on the earlier revisions of these same mockups.
const MAP = [
  ["telecom_tees_1.PNG", "your-internet-depends-on-my-tiny-glass-t-shirt"],
  ["telecom_tees_2.PNG", "out-of-order-try-again-tomorrow-t-shirt"],
  ["telecom_tees_3.png", "my-people-skills-are-fine-it-is-my-tolerance-to-idiots-that-needs-work-t-shirt"],
  ["telecom_tees_4.PNG", "when-you-get-paid-by-the-hour-heavy-equipment-division-t-shirt"],
  ["telecom_tees_5.PNG", "powered-by-caffeine-and-questionable-decisions-t-shirt"],
  ["telecom_tees_6.PNG", "under-construction-since-1973-t-shirt"],
  ["telecom_tees_7.PNG", "check-engine-light-has-been-on-so-long-we-are-friends-now-t-shirt"],
  ["telecom_tees_8.PNG", "low-battery-approach-with-coffee-t-shirt"],
  ["telecom_tees_9.png", "warning-may-contain-bad-decisions-t-shirt"],
  ["telecom_tees_10.PNG", "i-make-connections-for-a-living-t-shirt"],
];

const TOL = 42;            // pastel garments sit close to the white backdrop
const MIN_COL_FRAC = 0.16; // a column must be substantially garment to count
const MIN_ROW_FRAC = 0.10;
const PAD_FRAC = 0.06;
const MIN_SIDE = 800;

fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

const results = [];
for (const [file, slug] of MAP) {
  const src = path.join(SRC, file);
  if (!fs.existsSync(src)) { console.error(`MISSING: ${file}`); continue; }

  const probe = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", src]).toString().trim();
  const [W, H] = probe.split(",").map(Number);
  const raw = path.join(TMP, `${slug}.raw`);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", src, "-f", "rawvideo", "-pix_fmt", "rgb24", raw]);
  const buf = fs.readFileSync(raw);
  const at = (x, y) => { const i = (y * W + x) * 3; return [buf[i], buf[i + 1], buf[i + 2]]; };

  // Backdrop = the most common colour across a grid of sample points. Sampling a
  // single corner picked up a border/edge artefact on some files and produced a
  // grey pad instead of the white studio background.
  const tally = new Map();
  for (let y = 4; y < H; y += 17) {
    for (let x = 4; x < W; x += 17) {
      const [r, g, b] = at(x, y);
      const key = `${r >> 3},${g >> 3},${b >> 3}`;
      const entry = tally.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      entry.n += 1; entry.r += r; entry.g += g; entry.b += b;
      tally.set(key, entry);
    }
  }
  const top = [...tally.values()].sort((a, b) => b.n - a.n)[0];
  const bg = [Math.round(top.r / top.n), Math.round(top.g / top.n), Math.round(top.b / top.n)];
  const bgHex = `0x${bg.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  const on = (x, y) => {
    const [r, g, b] = at(x, y);
    return Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]) > TOL;
  };

  // Find the real gap between the two garments instead of assuming the midpoint:
  // scan the middle third for the column with the least garment coverage. A
  // midpoint split was slicing through a sleeve on several files.
  const colHits = new Array(W).fill(0);
  for (let x = 0; x < W; x++) {
    let n = 0;
    for (let y = 0; y < H; y += 2) if (on(x, y)) n++;
    colHits[x] = n;
  }
  let CENTRE = Math.floor(W / 2);
  let bestHits = Infinity;
  for (let x = Math.floor(W * 0.36); x <= Math.floor(W * 0.64); x++) {
    if (colHits[x] < bestHits) { bestHits = colHits[x]; CENTRE = x; }
  }
  for (const [side, xStart, xEnd] of [["front", 0, CENTRE - 1], ["back", CENTRE, W - 1]]) {
    let left = xEnd, right = xStart, top = H, bottom = -1;
    for (let x = xStart; x <= xEnd; x++) {
      let hits = 0;
      for (let y = 0; y < H; y++) if (on(x, y)) hits++;
      if (hits >= H * MIN_COL_FRAC) { if (x < left) left = x; if (x > right) right = x; }
    }
    for (let y = 0; y < H; y++) {
      let hits = 0;
      for (let x = xStart; x <= xEnd; x++) if (on(x, y)) hits++;
      if (hits >= (xEnd - xStart + 1) * MIN_ROW_FRAC) { if (y < top) top = y; bottom = y; }
    }
    if (bottom < 0 || right < left) { console.error(`  ${slug} ${side}: no garment detected`); continue; }

    const gw = right - left + 1;
    const gh = bottom - top + 1;
    const pad = Math.round(Math.max(gw, gh) * PAD_FRAC);
    // Clamp to the centre line so the neighbouring garment can never appear.
    const cx0 = Math.max(side === "front" ? 0 : CENTRE, left - pad);
    const cx1 = Math.min(side === "front" ? CENTRE - 1 : W - 1, right + pad);
    const cy0 = Math.max(0, top - pad);
    const cy1 = Math.min(H - 1, bottom + pad);
    const cw = cx1 - cx0 + 1;
    const ch = cy1 - cy0 + 1;

    const S = Math.max(MIN_SIDE, Math.max(gw, gh) + pad * 2);
    const padX = Math.round(S / 2 - ((left + right) / 2 - cx0));
    const padY = Math.round(S / 2 - ((top + bottom) / 2 - cy0));
    const out = path.join(OUT_DIR, `${slug}-${side}.png`);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", src, "-vf",
      `crop=${cw}:${ch}:${cx0}:${cy0},pad=${S}:${S}:${padX}:${padY}:${bgHex}`, "-frames:v", "1", out]);
    results.push({ slug, side, garment: `${gw}x${gh}`, output: `${S}x${S}`, fill: `${((Math.max(gw, gh) / S) * 100).toFixed(0)}%` });
    console.log(`${`${slug}-${side}`.padEnd(84)} garment ${String(gw).padStart(4)}x${String(gh).padStart(4)} -> ${S}x${S} (fill ${((Math.max(gw, gh) / S) * 100).toFixed(0)}%)`);
  }
  fs.rmSync(raw, { force: true });
}
console.log(`\n${results.length} images written to ${path.relative(ROOT, OUT_DIR)}`);

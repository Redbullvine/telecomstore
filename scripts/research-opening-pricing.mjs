#!/usr/bin/env node
// ============================================================================
// research-opening-pricing.mjs -- deterministic pricing + shipping researcher.
//
// Inputs:
//   --petra <path>        private Petra feed CSV (NEVER committed; read-only)
//   --catalog             src/data/opening-catalog.json
//   --calibration         operations/opening-pricing-calibration.json
//   --template            operations/opening-pricing-template.csv (updated)
//   --evidence-date       fixed date string for deterministic output
//
// Committed outputs (NO supplier cost, wholesale, or margin anywhere):
//   operations/opening-pricing-researched.csv
//   operations/opening-shipping-classes.csv
//   operations/opening-pricing-review.csv
//   docs/opening-pricing-research-report.md
//   operations/opening-pricing-template.csv   (public_price for approved only;
//                                              checkout_active stays false)
//
// Private output (git-ignored tmp/, for Danny only):
//   tmp/pricing-private/opening-margins-private.csv  (cost, margin, MAP, MSRP)
//
// Pricing rules:
//   * proposed = min(MSRP, max(MAP, brand_factor x MSRP)), rounded to .99
//   * never below supplier cost; margin < 25% -> manual_review
//   * MAP always respected as a floor
//   * uncalibrated brands are never auto-approved (manual_review)
//   * anything uncertain stays request-quote
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Papa = require("papaparse");

const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : dflt; };
const petraPath = arg("--petra");
const catalogPath = arg("--catalog", "src/data/opening-catalog.json");
const calibrationPath = arg("--calibration", "operations/opening-pricing-calibration.json");
const templatePath = arg("--template", "operations/opening-pricing-template.csv");
const evidenceDate = arg("--evidence-date", "2026-08-03");
if (!petraPath || !fs.existsSync(petraPath)) { console.error("--petra <path to private Petra CSV> is required"); process.exit(2); }

const round2 = (n) => Math.round(n * 100) / 100;
const to99 = (p) => Math.max(0.99, Math.round(p) - 0.01);
const num = (v) => { const n = Number(String(v ?? "").replace(/[$,]/g, "")); return Number.isFinite(n) ? n : 0; };
const csvOut = (rows, cols) => { const e = (v) => { const s = v == null ? "" : String(v); return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; }; return [cols.join(","), ...rows.map((r) => cols.map((c) => e(r[c])).join(","))].join("\n") + "\n"; };

// --- load inputs -------------------------------------------------------------
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const calibration = JSON.parse(fs.readFileSync(calibrationPath, "utf8"));
const rawPetra = fs.readFileSync(petraPath, "utf8");
const petraLines = rawPetra.split(/\r?\n/);
const hdrIdx = petraLines.findIndex((l) => l.toUpperCase().includes("PETRA SKU") && l.toUpperCase().includes("VENDOR SKU"));
const petra = Papa.parse(petraLines.slice(hdrIdx).join("\n"), { header: true, skipEmptyLines: "greedy" }).data;
const byMpn = new Map();
for (const r of petra) { const k = String(r["VENDOR SKU"] || "").trim().toUpperCase(); if (k && !byMpn.has(k)) byMpn.set(k, r); }

// --- shipping classification -------------------------------------------------
function classifyShipping(r) {
  const L = num(r["LENGTH"]), W = num(r["WIDTH"]), H = num(r["HEIGHT"]);
  const shipWeight = num(r["ESTIMATED SHIP WEIGHT"]) || num(r["WEIGHT-UNPACKED"]);
  if (!(L > 0 && W > 0 && H > 0) || !(shipWeight > 0)) {
    return { cls: "manual_quote", billed: null, dimWeight: null, longest: null, missing: true };
  }
  const dimWeight = round2((L * W * H) / 139);
  const billed = Math.max(shipWeight, dimWeight);
  const longest = Math.max(L, W, H);
  let cls;
  if (longest > 96 || billed > 70) cls = "freight";
  else if (longest > 48 || billed > 35) cls = "oversize";
  else if (billed > 12) cls = "large";
  else if (billed > 2) cls = "medium";
  else cls = "small";
  return { cls, billed: round2(billed), dimWeight, longest, shipWeight: round2(shipWeight), missing: false };
}
const SHIP_RATES = {
  small: { flat: 7.95, range: "6.95-8.95", note: "padded mailer or small box; dim weight not a factor" },
  medium: { flat: 12.95, range: "9.95-15.95", note: "single-wall box; dim weight occasionally binds on light bulky items" },
  large: { flat: 21.95, range: "16.95-29.95", note: "double-wall box; dim weight often binds (cable spools, antennas)" },
  oversize: { flat: 49.95, range: "39.95-89.95", note: "long/heavy parcel (masts, poles, 1000ft spools); UPS additional-handling likely" },
  freight: { flat: null, range: "manual", note: "over UPS parcel limits; quote LTL per order" },
  manual_quote: { flat: null, range: "manual", note: "missing dimensions or weight; review before rating" },
};

// --- pricing research --------------------------------------------------------
const researched = [], review = [], shipping = [], privateRows = [], templatePrice = new Map(), templateClass = new Map();
let approved = 0, requestQuote = 0, manualReview = 0, marginSum = 0, marginN = 0, missingDims = 0;

for (const p of catalog) {
  const r = byMpn.get(p.sku.toUpperCase());
  const cal = calibration.brands[p.brand];
  const msrp = r ? num(r["MSRP"]) : 0;
  const map = r ? num(r["MAP"]) : 0;
  const cost = r ? num(r["PRICE"]) : 0; // PRIVATE — only ever written to tmp/
  const ship = r ? classifyShipping(r) : { cls: "manual_quote", missing: true };
  if (ship.missing) missingDims++;

  let proposed = null, status, confidence, basis, evidence = "", lowest = "", typical = "", highest = "", note = "";
  if (!r) {
    status = "manual_review"; confidence = "low"; basis = "none"; note = "No supplier feed match; research manually.";
  } else if (cal && msrp > 0) {
    const computed = Math.min(msrp, Math.max(map, cal.factor * msrp));
    proposed = Math.max(map, Math.min(msrp, to99(computed)));
    proposed = round2(proposed);
    const sampled = p.sku.toUpperCase() === String(cal.sample_mpn || "").toUpperCase();
    confidence = sampled ? "high" : "medium";
    basis = sampled ? "direct_observation" : "brand_calibration";
    evidence = (cal.observed || []).map((o) => o.url).join(" | ");
    if (sampled) {
      const prices = (cal.observed || []).map((o) => o.price).sort((a, b) => a - b);
      lowest = prices[0] ?? ""; typical = prices[Math.floor(prices.length / 2)] ?? ""; highest = prices[prices.length - 1] ?? "";
    } else {
      typical = round2(cal.factor * msrp); highest = msrp;
    }
    if (cost > 0) {
      if (proposed <= cost) { status = "keep_request_quote"; note = "Calibrated market price does not clear supplier cost; keep request-quote."; proposed = null; }
      else {
        const margin = (proposed - cost) / proposed;
        if (margin < 0.25) { status = "manual_review"; note = "Margin below 25% floor at calibrated price."; }
        else {
          status = "approved_candidate";
          marginSum += margin; marginN++;
        }
      }
    } else { status = "manual_review"; note = "No supplier cost on file; confirm before pricing."; }
    if (cal.market_below_map_note && status === "approved_candidate") {
      status = "manual_review"; note = "MAP floor is above observed street prices (" + cal.market_below_map_note + ")";
    }
  } else {
    // Uncalibrated brand: suggest, never approve.
    status = "manual_review"; confidence = "low"; basis = "none";
    if (msrp > 0) { typical = ""; highest = msrp; note = "Brand not yet market-sampled; suggested ceiling is list price " + msrp + "."; }
    else note = "No list price in feed; research manually.";
  }

  if (status === "keep_request_quote") requestQuote++;
  else if (status === "manual_review") manualReview++;
  else approved++;

  researched.push({
    public_sku: p.sku, manufacturer_mpn: p.sku, manufacturer: p.brand, category: p.category, title: p.title,
    lowest_reliable_price: lowest, typical_public_price: typical, highest_reasonable_price: highest,
    proposed_retail_price: status === "approved_candidate" ? proposed : "",
    estimate_basis: basis, pricing_evidence_urls: evidence, evidence_date: evidenceDate,
    confidence, pricing_status: status, notes: note,
  });
  if (status !== "approved_candidate") {
    review.push({ public_sku: p.sku, manufacturer: p.brand, title: p.title, pricing_status: status, confidence, reason: note || status, suggested_ceiling: highest || "" });
  }
  const rate = SHIP_RATES[ship.cls];
  shipping.push({
    public_sku: p.sku, manufacturer: p.brand, shipping_class: ship.cls,
    packaged_weight_lb: ship.shipWeight ?? "", dimensional_weight_lb: ship.dimWeight ?? "", billed_weight_lb: ship.billed ?? "",
    longest_side_in: ship.longest ?? "", dim_weight_binds: ship.dimWeight != null && ship.billed === ship.dimWeight ? "yes" : "no",
    packaging_assumption: ship.missing ? "MISSING DIMS/WEIGHT - review" : "single boxed unit; Petra estimated ship weight",
    suggested_ups_ground_flat: rate.flat ?? "", suggested_rate_range: rate.range, manual_quote_required: rate.flat == null ? "yes" : "no",
    class_note: rate.note,
  });
  privateRows.push({
    public_sku: p.sku, manufacturer: p.brand, supplier_cost: cost || "", map: map || "", msrp: msrp || "",
    proposed_retail_price: status === "approved_candidate" ? proposed : "",
    expected_gross_margin_pct: status === "approved_candidate" && cost > 0 ? round2(((proposed - cost) / proposed) * 100) : "",
    pricing_status: status,
  });
  if (status === "approved_candidate") templatePrice.set(p.sku, proposed);
  templateClass.set(p.sku, ship.cls);
}

// --- write committed outputs -------------------------------------------------
fs.writeFileSync("operations/opening-pricing-researched.csv", csvOut(researched, ["public_sku","manufacturer_mpn","manufacturer","category","title","lowest_reliable_price","typical_public_price","highest_reasonable_price","proposed_retail_price","estimate_basis","pricing_evidence_urls","evidence_date","confidence","pricing_status","notes"]));
fs.writeFileSync("operations/opening-shipping-classes.csv", csvOut(shipping, ["public_sku","manufacturer","shipping_class","packaged_weight_lb","dimensional_weight_lb","billed_weight_lb","longest_side_in","dim_weight_binds","packaging_assumption","suggested_ups_ground_flat","suggested_rate_range","manual_quote_required","class_note"]));
fs.writeFileSync("operations/opening-pricing-review.csv", csvOut(review, ["public_sku","manufacturer","title","pricing_status","confidence","reason","suggested_ceiling"]));

// --- private output (git-ignored) --------------------------------------------
fs.mkdirSync("tmp/pricing-private", { recursive: true });
fs.writeFileSync("tmp/pricing-private/opening-margins-private.csv", csvOut(privateRows, ["public_sku","manufacturer","supplier_cost","map","msrp","proposed_retail_price","expected_gross_margin_pct","pricing_status"]));

// --- update the pricing template (prices for approved only; checkout false) --
const tpl = Papa.parse(fs.readFileSync(templatePath, "utf8"), { header: true, skipEmptyLines: true });
const tplRows = tpl.data.map((row) => ({
  ...row,
  public_price: templatePrice.has(row.public_sku) ? String(templatePrice.get(row.public_sku)) : "",
  shipping_class: templateClass.get(row.public_sku) || row.shipping_class || "",
  checkout_active: "false",
}));
fs.writeFileSync(templatePath, csvOut(tplRows, tpl.meta.fields));

// --- report ------------------------------------------------------------------
const classCounts = shipping.reduce((a, s) => { a[s.shipping_class] = (a[s.shipping_class] || 0) + 1; return a; }, {});
const avgMargin = marginN ? round2((marginSum / marginN) * 100) : null;
const stats = { reviewed: catalog.length, approved_candidates: approved, keep_request_quote: requestQuote, manual_review: manualReview, average_margin_pct_approved: avgMargin, shipping_classes: classCounts, missing_dims_or_weight: missingDims };
const report = `# Opening pricing & shipping research report

Evidence date: ${evidenceDate}. Method: per-brand market sampling (manufacturer,
distributor, and major-retailer listings; auctions and marketplaces excluded)
calibrated against the supplier feed's list prices. See
\`operations/opening-pricing-calibration.json\` for every sampled MPN and URL.

**No supplier cost, wholesale, MAP, or margin data appears in committed files.**
Per-item cost and margin live only in the git-ignored
\`tmp/pricing-private/opening-margins-private.csv\` for Danny's local review.
Aggregate margin across approved candidates: **${avgMargin ?? "n/a"}%**.

## Counts
- Products reviewed: **${stats.reviewed}**
- Approved pricing candidates: **${approved}** (calibrated brand, MAP-respecting, >=25% margin, never below cost)
- Keep request-quote: **${requestQuote}**
- Manual review: **${manualReview}** (uncalibrated brands, sub-25% margins, MAP-above-market cases, or missing data)
- Missing dimensions/weight: **${missingDims}**

## Shipping classes
${Object.entries(classCounts).map(([k, v]) => `- ${k}: ${v}`).join("\n")}

Suggested UPS Ground flats: small $7.95 (6.95-8.95), medium $12.95 (9.95-15.95),
large $21.95 (16.95-29.95), oversize $49.95 (39.95-89.95), freight/manual by quote.
Dimensional weight (L*W*H/139) is billed when it exceeds actual weight; the
per-item breakdown is in \`operations/opening-shipping-classes.csv\`.

## Rules applied
1. Proposed retail = min(list, max(MAP, brand-factor x list)), rounded to .99.
2. Never below supplier cost (checked privately); margin floor 25%.
3. MAP respected as an absolute floor; MAP-above-street items go to manual review.
4. Uncalibrated brands are never auto-approved.
5. All uncertain items remain request-quote with checkout disabled.
6. Checkout stays disabled for every product in this phase.

## Decisions Danny must approve
1. The ${approved} approved candidate prices (template + researched CSV).
2. The ${manualReview} manual-review items (largest groups: uncalibrated brands
   listed in the calibration file's note; Ethereal MAP-vs-street call).
3. The proposed UPS Ground flat rates per class, and how to handle the
   oversize/freight items (flat vs live rates vs quote-only shipping).
4. Whether request-quote-only items should display "price on request" copy.
`;
fs.writeFileSync("docs/opening-pricing-research-report.md", report);
console.log(JSON.stringify(stats, null, 2));

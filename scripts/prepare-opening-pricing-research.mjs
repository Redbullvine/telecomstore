import fs from "node:fs";
import process from "node:process";
import Papa from "papaparse";

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback; };
const supplierCsv = arg("--supplier-csv");
const evidencePath = arg("--evidence", "operations/opening-pricing-evidence.json");
const approvalsPath = arg("--approvals", "operations/opening-approved-prices.json");
if (!supplierCsv) throw new Error("--supplier-csv is required");
const catalog = JSON.parse(fs.readFileSync("src/data/opening-catalog.json", "utf8"));
const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
const approvals = JSON.parse(fs.readFileSync(approvalsPath, "utf8"));
const approvedPrices = new Map(Object.entries(approvals.prices || {}));
const rawSupplier = fs.readFileSync(supplierCsv, "utf8").split(/\r?\n/).slice(2).join("\n");
const parsed = Papa.parse(rawSupplier, { header: true, skipEmptyLines: true });
if (parsed.errors.length) throw new Error(parsed.errors.map((error) => error.message).join("; "));

const normalizeMpn = (value) => String(value || "").trim().toUpperCase();
const comparableMpn = (value) => normalizeMpn(value).replace(/[^A-Z0-9]/g, "");
const reputableSeller = /(antennasdirect|apc|bhphotovideo|bestbuy|cdw|connection|cyberpower|digikey|eaton|fullcompass|grainger|graybar|homedepot|idealind|lowes|markertek|mouser|officedepot|pcrichard|petra|provantage|pyle|quill|rcaaccessories|rs-online|solidsignal|staples|target|tequipment|tripplite|vtechphones|weboost|zoro)\./i;
const supplierByMpn = new Map(parsed.data.map((row) => [normalizeMpn(row["VENDOR SKU"]), row]));
const number = (value) => { const n = Number(String(value || "").replace(/[$,]/g, "")); return Number.isFinite(n) && n > 0 ? n : null; };
const round = (value, digits = 2) => value === null ? null : Number(value.toFixed(digits));
const median = (values) => { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; };
const csvCell = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const writeCsv = (file, rows) => { const headers = Object.keys(rows[0]); fs.writeFileSync(file, [headers.join(","), ...rows.map((row) => headers.map((key) => csvCell(row[key])).join(","))].join("\n") + "\n"); };

function shippingAssessment(source) {
  const weight = number(source?.["ESTIMATED SHIP WEIGHT"]);
  const dimensions = [number(source?.LENGTH), number(source?.WIDTH), number(source?.HEIGHT)];
  if (!weight || dimensions.some((value) => !value)) return { shipping_class: "manual_quote", packaged_weight: weight, dimensions, dimensional_weight: null, concerns: "Missing supplier estimated ship weight or one or more dimensions; packaging must be measured.", manual_quote: true };
  const [length, width, height] = [...dimensions].sort((a, b) => b - a);
  const dimWeight = Math.ceil(length * width * height / 139);
  const billable = Math.max(Math.ceil(weight), dimWeight);
  const lengthGirth = length + 2 * width + 2 * height;
  let shippingClass = "small";
  if (weight > 150 || length > 108 || lengthGirth > 165) shippingClass = "freight";
  else if (weight > 70 || length > 60 || lengthGirth > 130 || dimWeight > Math.max(weight * 1.5, 20)) shippingClass = "oversize";
  else if (billable > 35 || length > 36) shippingClass = "large";
  else if (billable > 10 || length > 24) shippingClass = "medium";
  const concerns = `${dimWeight > weight ? `DIM weight ${dimWeight} lb exceeds supplier estimated ship weight ${round(weight)} lb.` : "No DIM-weight uplift indicated by recorded dimensions."} ${lengthGirth > 130 ? `Length plus girth is ${round(lengthGirth)} in; large-package review required.` : "Within the 130-in large-package screening threshold."}`;
  return { shipping_class: shippingClass, packaged_weight: weight, dimensions: [length, width, height], dimensional_weight: dimWeight, concerns, manual_quote: ["oversize", "freight"].includes(shippingClass) };
}

const researched = [], publicReview = [], privateReview = [], shipping = [], template = [];
let matchedSupplier = 0;
for (const product of catalog) {
  const mpn = product.manufacturer_mpn || product.sku;
  const source = supplierByMpn.get(normalizeMpn(mpn));
  if (source) matchedSupplier += 1;
  const cost = number(source?.PRICE), map = number(source?.MAP), msrp = number(source?.MSRP);
  const supplierNotes = `${source?.NOTES1 || ""} ${source?.NOTES2 || ""}`.trim();
  const discontinued = /discontinued|obsolete|end.?of.?life|eol/i.test(supplierNotes);
  const exactMpnKey = comparableMpn(mpn);
  const itemEvidence = (evidence[product.sku]?.sources || []).filter((item) => comparableMpn(`${item.title} ${item.url}`).includes(exactMpnKey));
  const pricedSources = itemEvidence.map((item) => ({ ...item, observed: item.prices?.[0] })).filter((item) => item.observed > 0 && reputableSeller.test(`${item.seller}.`));
  const observed = pricedSources.map((item) => item.observed);
  const low = observed.length ? Math.min(...observed) : null, typical = median(observed), high = observed.length ? Math.max(...observed) : null;
  const distinctPricedSellers = new Set(pricedSources.map((item) => item.seller)).size;
  const spreadSafe = low && high ? high / low <= 1.75 : false;
  const strong = distinctPricedSellers >= 2 && spreadSafe && typical !== null && (cost === null || typical >= cost) && (map === null || typical >= map) && !discontinued;
  const status = strong ? "approved_candidate" : discontinued ? "keep_request_quote" : "manual_review";
  const confidence = distinctPricedSellers >= 3 && strong ? "high" : distinctPricedSellers >= 2 && strong ? "medium" : itemEvidence.length ? "low" : "none";
  const proposed = strong ? round(typical) : null;
  const approvedPrice = approvedPrices.has(product.sku) ? Number(approvedPrices.get(product.sku)) : null;
  if (approvedPrice !== null && (!(approvedPrice > 0) || !strong || approvedPrice !== proposed)) {
    throw new Error(`Approved price must exactly match a positive researched candidate price for ${product.sku}`);
  }
  const margin = proposed && cost ? round((proposed - cost) / proposed * 100, 1) : null;
  const evidenceUrls = itemEvidence.map((item) => item.url).join(" | ");
  const assessment = shippingAssessment(source);
  const reason = strong ? "Two or more distinct priced public sellers; price spread, supplier cost, and MAP gates passed." : discontinued ? "Supplier record indicates discontinued/obsolete; retain quote workflow." : "Insufficient or conflicting exact-MPN public price evidence; manual review required.";
  researched.push({ public_sku: product.sku, manufacturer_mpn: mpn, manufacturer: product.brand, category: product.category, title: product.title, lowest_reliable_price: round(low), typical_public_price: round(typical), highest_reasonable_price: round(high), proposed_retail_price: proposed, pricing_approved: approvedPrice !== null ? "true" : "false", approved_public_price: approvedPrice ?? "", pricing_evidence_urls: evidenceUrls, evidence_date: "2026-08-03", confidence, pricing_status: status, notes: reason });
  publicReview.push({ public_sku: product.sku, manufacturer_mpn: mpn, manufacturer: product.brand, title: product.title, pricing_status: status, confidence, reason, proposed_retail_price: proposed, pricing_approved: approvedPrice !== null ? "true" : "false", approved_public_price: approvedPrice ?? "", evidence_urls: evidenceUrls });
  privateReview.push({ public_sku: product.sku, exact_mpn: mpn, manufacturer: product.brand, approved_title: product.title, private_supplier_cost: cost, supplier_map: map, supplier_msrp: msrp, proposed_retail_price: proposed, expected_gross_margin_percent: margin, pricing_status: status, confidence_level: confidence, evidence_urls: evidenceUrls, private_supplier_notes: supplierNotes });
  shipping.push({ public_sku: product.sku, manufacturer_mpn: mpn, manufacturer: product.brand, shipping_class: assessment.shipping_class, packaged_weight_lb: round(assessment.packaged_weight), dimensional_weight_lb: assessment.dimensional_weight, billed_weight_lb: assessment.packaged_weight && assessment.dimensional_weight ? Math.max(Math.ceil(assessment.packaged_weight), assessment.dimensional_weight) : "", length_in: assessment.dimensions[0], width_in: assessment.dimensions[1], height_in: assessment.dimensions[2], packaging_assumption: "Supplier dimensions and estimated ship weight are screening inputs only; no packaging adder was invented. Verify a packed unit before activation.", dimensional_weight_concerns: assessment.concerns, suggested_ups_ground_flat: "", suggested_rate_range: "Not proposed—requires origin ZIP, destination zone, negotiated account rate, and surcharge validation.", manual_quote_required: assessment.manual_quote ? "true" : "false", shipping_evidence_urls: "https://www.ups.com/us/en/support/shipping-support/shipping-dimensions-weight | https://www.ups.com/us/en/support/shipping-support/shipping-costs-rates/daily-rates" });
  template.push({ public_sku: product.sku, approved_title: product.title, public_price: approvedPrice ?? "", price_mode: approvedPrice !== null ? "fixed" : "request_quote", pricing_approved: approvedPrice !== null ? "true" : "false", checkout_active: "false", shipping_class: assessment.shipping_class, taxable: "false", stripe_price_id: "", allowed_countries: "", stripe_shipping_rate_id: "", automatic_tax: "false", notes: approvedPrice !== null ? `${status}; price approved by Danny; checkout remains disabled` : `${status}; request quote; checkout remains disabled` });
}
if (researched.length !== 206 || matchedSupplier !== 206) throw new Error(`Expected 206 catalog and supplier matches; got catalog=${researched.length}, supplier=${matchedSupplier}`);
const unknownApprovals = [...approvedPrices.keys()].filter((sku) => !catalog.some((product) => product.sku === sku));
if (unknownApprovals.length) throw new Error(`Approved prices contain unknown public SKUs: ${unknownApprovals.join(", ")}`);
writeCsv("operations/opening-pricing-researched.csv", researched);
writeCsv("operations/opening-pricing-review.csv", publicReview);
writeCsv("operations/opening-shipping-classes.csv", shipping);
writeCsv("operations/opening-pricing-template.csv", template);
fs.mkdirSync("tmp/pricing-private", { recursive: true });
writeCsv("tmp/pricing-private/opening-margins-private.csv", privateReview);

const groupCount = (rows, key) => Object.fromEntries([...Map.groupBy(rows, (row) => row[key])].map(([name, values]) => [name, values.length]));
const pricingCounts = groupCount(researched, "pricing_status"), shippingCounts = groupCount(shipping, "shipping_class");
const margins = privateReview.map((row) => row.expected_gross_margin_percent).filter((value) => value !== null);
const missingMeasurements = shipping.filter((row) => row.shipping_class === "manual_quote").length;
const averageMargin = margins.length ? round(margins.reduce((sum, value) => sum + value, 0) / margins.length, 1) : null;
const report = `# Opening pricing and shipping research report

Research date: 2026-08-03

## Outcome

- Products reviewed by exact manufacturer MPN: ${researched.length}
- Approved pricing candidates: ${pricingCounts.approved_candidate || 0}
- Prices approved by Danny: ${approvedPrices.size}
- Keep request quote: ${pricingCounts.keep_request_quote || 0}
- Manual pricing review: ${pricingCounts.manual_review || 0}
- Average proposed gross margin across candidates: ${averageMargin ?? "n/a"}%
- Products missing a supplier estimated ship weight or dimension: ${missingMeasurements}

## Shipping-class counts

${["small", "medium", "large", "oversize", "freight", "manual_quote"].map((name) => `- ${name}: ${shippingCounts[name] || 0}`).join("\n")}

## Method and safety gates

Each exact MPN was searched against current public web results. Auction sites and large third-party marketplaces were excluded. A price became an \`approved_candidate\` only when at least two distinct public sellers exposed prices, the observed spread was no greater than 75%, the median public price was not below known supplier cost or MAP, and the supplier record did not indicate discontinuation. These are recommendations for Danny's review, not final prices.

The supporting search-evidence archive is kept locally in the git-ignored \`operations/opening-pricing-evidence.json\`. Candidate calculations count only exact-MPN title/URL matches from the reputable manufacturer, distributor, and major-retailer allowlist in the preparation script. Supplier URLs and research evidence are not published with the public repository.

Shipping uses only supplier-recorded dimensions and estimated ship weight. UPS publishes a 139 dimensional-weight divisor for daily rates, a 150-lb package limit, a 108-in length limit, and a 165-in length-plus-girth limit. No flat rate is recommended without the ship-from ZIP, destination zone, negotiated UPS rate, packed-unit measurements, and surcharge review. Products missing any required measurement remain \`manual_quote\`.

The private supplier-cost and per-item margin review is local-only at \`tmp/pricing-private/opening-margins-private.csv\` and is narrowly ignored by Git. Supplier cost is absent from every committed research file, shipping file, pricing template, and frontend JSON.

## Approval decisions required

Danny has approved the prices recorded in \`operations/opening-approved-prices.json\`. Before checkout is activated, he must still confirm packed dimensions and weight, select an origin ZIP and supported destinations, approve a carrier/Stripe shipping rate, decide taxable status and automatic-tax treatment, and explicitly activate checkout per SKU. No checkout flag is enabled by this approval.
`;
fs.writeFileSync("docs/opening-pricing-research-report.md", report);
console.log(JSON.stringify({ products: researched.length, supplier_matches: matchedSupplier, pricing: pricingCounts, shipping: shippingCounts, missing_measurements: missingMeasurements, average_margin_percent: averageMargin }, null, 2));

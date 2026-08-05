import fs from "node:fs";
import process from "node:process";
import Papa from "papaparse";
import { publicPricing, validatePricingRows } from "./lib/pricing-validation.mjs";

const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const input = arg("--input");
const catalogPath = arg("--catalog") || "src/data/opening-catalog.json";
const serverOutput = arg("--server-output") || "netlify/functions/_shared/opening-pricing.json";
const publicOutput = arg("--public-output") || "src/data/opening-pricing.json";
if (!input) throw new Error("--input is required");
const parsed = Papa.parse(fs.readFileSync(input, "utf8"), { header: true, skipEmptyLines: true });
if (parsed.errors.length) throw new Error(parsed.errors.map((error) => error.message).join("; "));
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const rows = validatePricingRows(parsed.data, catalog, { partial: process.argv.includes("--partial") });
fs.writeFileSync(serverOutput, JSON.stringify(rows, null, 2) + "\n");
fs.writeFileSync(publicOutput, JSON.stringify(publicPricing(rows), null, 2) + "\n");
console.log(`Validated ${rows.length} pricing rows. No checkout is enabled without complete price, shipping, and tax configuration.`);

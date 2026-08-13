// Write the server-side trusted checkout catalog for approved apparel variants.
//
//   node scripts/build-apparel-commerce.mjs
//
// The browser sends only {sku, quantity}; price, shipping class, and countries are
// resolved from this file by netlify/functions/_shared/checkout-core.mjs. Kept
// separate from opening-pricing.json so the live telecom payment configuration is
// never rewritten. checkout_active stays false while the packaged weight is
// undocumented, because a session would otherwise fail the shipping check.
import fs from "node:fs";
import path from "node:path";
import { apparelCommerceRows } from "./lib/apparel-feed.mjs";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const rows = apparelCommerceRows();
const active = rows.filter((row) => row.checkout_active);
const out = path.resolve(ROOT, "netlify/functions/_shared/apparel-commerce.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
console.log(`Apparel commerce rows: ${rows.length} (checkout_active: ${active.length})`);
console.log(`Wrote ${path.relative(ROOT, out)}`);

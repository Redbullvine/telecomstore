# General Merchandise Shop

The `/shop` marketplace, populated from the Petra supplier workbook. The routing,
filters, product pages, and schema.org markup already existed and returned zero
products by design; this is the publication that fills it.

## Authorization

| Decision | Source |
| --- | --- |
| Publish Petra product content and imagery | Petra sales representative to Danny, 2026-08-10 — the product download document may be used in full |
| Public price = dealer cost x 2 | Danny, 2026-08-10 ("double all prices when putting them on the site") |
| Rank for Google Shopping | Danny, 2026-08-10 |

## Build

```bash
npm run build:shop
```

Runs two scripts in order:

1. `scripts/build-general-merchandise-catalog.mjs` — reads the workbook and writes
   the published catalog, the details file, the bundled summary, the tracked
   report, and a gitignored private review CSV.
2. `scripts/build-google-shopping-feed.mjs` — reads only the published catalog and
   writes the Merchant Center feed and the shop sitemap.

The workbook is **not** tracked (`.gitignore` covers `/Petra_Products.xlsx`). It
carries dealer cost, MAP, MSRP, and supplier SKUs, none of which may be committed.

### Outputs

| Path | Tracked | Contents |
| --- | --- | --- |
| `public/data/marketplace-catalog.json` | yes | 2,557 products, public contract only (~2.2 MB, 225 KB gzipped) |
| `public/data/marketplace-details.json` | yes | spec bullets keyed by slug, fetched only on product pages |
| `src/data/marketplace-summary.json` | yes | department counts for the homepage (755 bytes) |
| `public/feeds/google-shopping.xml` | yes | Merchant Center feed, 2,557 items |
| `public/sitemap-shop.xml` | yes | 2,566 URLs |
| `docs/general-merchandise-build-report.md` | yes | aggregate counts only |
| `tmp/general-merchandise/private-review.csv` | **no** | supplier SKU, cost, MAP, MSRP per row |

## Pricing

`calculatePublicPrice()` in `scripts/generate-petra-public-pricing.mjs` is reused
unchanged: **dealer cost x 2, raised to MAP where MAP is higher, rounded to
cents.** A price is never derived from MSRP and never invented; a row with no
usable cost publishes as request-a-quote instead.

### What Petra's PRICE column is

`PRICE`, `MAP`, and `MSRP` are three independent columns. **`PRICE` is the dealer
cost we pay Petra, not the manufacturer's price.** Petra's discount off MSRP is
inconsistent across the catalog, which is what makes a flat multiplier behave
unevenly:

| Dealer cost as a share of MSRP | 10th pct | 25th | Median | 75th | 90th |
| --- | --- | --- | --- | --- | --- |
| | 35% | 46% | **57%** | 70% | 81% |

Consequences:

- Doubling stays under MSRP only when cost is ≤50% of MSRP — **878 of 2,556
  items (34%)**. The other 66% exceed MSRP.
- Selling at MSRP would still return a **median 43% margin** (30% on the weaker
  quartile), so the cap below is an ordinary retail markup, not a giveaway.
- **25 items have a dealer cost above MSRP.** Capping those at MSRP would publish
  a price below what we pay Petra (up to $23.99 per unit on `ADD-AKSA`), so the
  cap skips them, leaves the doubled price, and flags
  `msrp_below_cost_cap_skipped`. With `--cap-at-msrp` on, zero published prices
  fall below dealer cost, and items above MSRP drop from 1,679 to 44 (the 25
  cost-above-MSRP rows plus MAP floors).
- `MAP` is set on only 594 of 2,557 rows; 0 means Petra sets no advertising floor.

### Open pricing question

**1,679 of 2,556 priced items (66%) list above the manufacturer's suggested
retail price, at a median of 1.30x MSRP** (worst case 3.55x). Doubling is the
authorized rule and is what ships, but it works against the Google Shopping goal,
because Shopping surfaces and ranks partly on price competitiveness and Merchant
Center can flag price-value problems.

The remedy is one flag — it keeps the doubling wherever it lands at or under MSRP
and caps only the overages, never going below a MAP floor:

```bash
node scripts/build-general-merchandise-catalog.mjs --cap-at-msrp && node scripts/build-google-shopping-feed.mjs
```

Left off by default. It is a pricing decision, not a technical one.

## Boundary

The published catalog is a public artifact, so the build **fails closed** rather
than emitting a supplier-private field. `assertPublicRecordClean()` throws on:

- any key outside `ALLOWED_PUBLIC_KEYS`, or any key matching the private-name
  pattern (`supplier`, `cost`, `msrp`, `margin`, …);
- the public SKU being the Petra SKU rather than the manufacturer part number;
- the dealer cost being published as the price.

Two things are deliberately **not** fatal, because treating them as leaks
produced false positives:

- **MAP as the published price.** When MAP exceeds double cost, MAP *is* the
  correct price by the pricing rule.
- **The supplier SKU appearing in supplier-authored copy.** Petra prints
  manufacturer cross-reference numbers in its own spec text, and for some brands
  (ERP appliance parts) the Petra SKU *is* the manufacturer's part number —
  "cross reference numbers include ER2183141". Those rows are flagged
  (`supplier_sku_in_supplier_copy`) and counted in the report.

`tests/general-merchandise.test.mjs` asserts all of the above, and re-checks the
built artifact for private column names.

## Images

Petra images live in an S3 bucket named `petraimages.com`. **They cannot be
hotlinked from an https page:**

- the virtual-hosted host `petraimages.com.s3.amazonaws.com` has a dotted bucket
  name, so it does not match AWS's `*.s3.amazonaws.com` wildcard certificate and
  TLS fails outright;
- path-style (`https://s3.amazonaws.com/petraimages.com/...`) is rejected by S3
  with `PermanentRedirect` back to the virtual-hosted host;
- the images are served fine over **http**, which an https page blocks as mixed
  content.

So the catalog stores a first-party path, `/shop-images/<file>.jpg`, proxied to
the bucket by the `/shop-images/*` rule in `netlify.toml` (mirrored for local
development by the `server.proxy` entry in `vite.config.mjs`). Netlify fetches the
http origin server-side and serves the bytes over the site certificate.

The rule is pinned to that one bucket and prefix, and `normalizeImageUrl()`
accepts only a plain image filename from the expected host, so the proxy cannot be
used against an arbitrary target.

This also serves Shopping: `image_link` in the feed and `image` in the schema.org
markup are absolute first-party https URLs that Googlebot can fetch.

## Google Shopping

- **GTIN recovery.** The workbook stores UPC as a number, so Excel drops leading
  zeros: 1,234 values arrive as exactly 11 digits, a UPC-12 short its leading
  zero. `recoverGtin()` restores zeros only, and only when the result passes the
  GS1 mod-10 check digit — a wrong guess fails 9 times in 10. That lifts verified
  GTINs from 1,283 to **2,519 of 2,557**. A GTIN that cannot be verified is
  published as empty rather than guessed; those 38 items identify on brand + MPN,
  and the feed emits `identifier_exists=no` if both are missing.
- **Feed attributes.** id, title, description, link, image_link, availability,
  price, brand, condition, gtin/mpn, google_product_category, product_type.
- **`google_product_category`** uses Google's stable top-level taxonomy names
  only. A wrong deep path is a disapproval and Google refines categorisation
  itself; `product_type` carries our full path, is free-form by specification, and
  is where the real signal is.
- **Landing-page consistency.** Merchant Center cross-checks the product page
  against the feed, so schema.org availability is derived from real stock
  (`InStock` vs `BackOrder`) and `itemCondition` from the workbook's REFURB flag,
  rather than asserting in-stock-and-new for everything.
- **Crawl.** `public/sitemap-shop.xml` lists every product URL and is registered
  as a second `Sitemap:` directive in `robots.txt`. The shop sets
  `noindex,follow` only while the catalog is empty.

### Submitting the feed

The feed is a static file at `https://telecomstore.net/feeds/google-shopping.xml`.
In Merchant Center, add it as a scheduled fetch and re-run `npm run build:shop`
whenever a new workbook arrives, so the fetched file stays current.

## Data source precedence

`fetchMarketplaceCatalog()` prefers the `get_public_marketplace_catalog()` RPC and
falls back to the published static catalog when the RPC returns nothing or errors.

This is a deliberate change from the original "RPC only, no static fallback"
boundary in `docs/petra-marketplace-architecture.md`. That rule existed because
nothing had been rights-cleared or price-approved, so there was nothing legitimate
to publish. Both conditions are now resolved, the pricing rule is fixed in the
build, and the build refuses to emit a private field — so the static catalog *is*
the approved publication. It also keeps the shop and its images available to
Googlebot when Supabase is unreachable.

Per-item database publication approvals remain the higher-precedence path: as soon
as the RPC returns rows, they win.

## Departments

The 12 Petra product classes collapse onto the eight existing public departments.
`deals` is not a source class — it is the clearance pool (discontinued items that
still have stock), which is why `filterMarketplaceProducts()` treats
`department: "deals"` as a clearance filter instead of a slug match. Before that
fix, `/shop/deals` could only ever render empty.

| Department | Products |
| --- | --- |
| Home & Kitchen | 832 |
| Electronics | 688 |
| Tools & Home Improvement | 365 |
| Appliance Parts | 272 |
| Automotive & Marine | 223 |
| Outdoor & Fitness | 141 |
| Health & Beauty | 36 |
| Deals (clearance, cross-cutting) | 315 |

A product class that is not in the map falls back to subcategory text rather than
being dropped, so a future workbook rename cannot silently lose products.

## Content mapping

Petra's `DESCRIPTION` is a terse all-caps abbreviation ("EPI236 AIR PURIFIER
BLK"). The workbook also carries the real retail copy, which is what the shop
shows:

| Shop field | Workbook column |
| --- | --- |
| `title` | `LONG DESC` — the full retail title |
| `short_description` | `KEYWORDS` — the same title without the brand/MPN prefix |
| `long_description` | `SPECS` — bullet list, split into discrete lines |
| `subcategory` | `SUBCATEGORY`; `SUBCATEGORY2/3` feed `product_type` and search |

`DESCRIPTION` is the fallback when the better columns are blank, expanded through
the existing abbreviation dictionary. No specification or claim is invented.

## Not done

- **No production database write.** The gates in
  `docs/production-import-gate.md` are untouched, no confirmation file was
  created, and no Supabase credential was used.
- **Not pushed or deployed.** Committed to `claude/general-merchandise-shop` only.
- 1 of 2,558 rows is skipped as a duplicate brand+MPN; the stocked variant wins.

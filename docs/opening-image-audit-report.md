# Opening catalog image audit

Date: 2026-08-04

## Safety boundary

This audit covers all 206 opening products. No supplier image is public, hotlinked, copied into the public build, or approved by this work. Raw Petra image URLs and downloaded review files exist only under the ignored `tmp/opening-image-staging/` directory.

The approval rule is intentionally strict: only user-owned images or official manufacturer assets with explicit reseller-use permission may become public. Every Petra candidate remains `pending_petra_confirmation`.

## Results

- Products audited: 206
- Petra catalog matches by exact manufacturer MPN: 206
- Candidate image URLs: 206
- Working image responses: 206
- Broken, timed out, or unexpected responses: 0
- Approved public images: 0
- Products using safe category placeholders: 206
- Exact duplicate URL groups: 0
- Near-duplicate URL groups: 0
- Exact duplicate content groups: 1
- User-owned files inspected: 104
- User-owned files with an exact opening SKU/MPN filename match: 0
- Official manufacturer image candidates with explicit reseller-use permission found locally: 0

A supplier-catalog association proves which Petra row supplied a URL; it does not prove that the pixels depict the exact MPN. Therefore every candidate still requires visual confirmation in the private local preview.

### Image resolution

| Resolution | Candidate count |
|---|---:|
| 600×600 | 206 |

### Duplicate-content review

- sha256-1: MHX-LHDME2 (2M HDMI Cable 18G) and MHX-LHDME4 (4M HDMI Cable 18G) are byte-for-byte identical and require separate exact-product review.

## Catalog organization

### Categories

| Customer-facing category | Products |
|---|---:|
| Network Cabling & Connectors | 89 |
| Network Equipment | 43 |
| Antennas & RF | 30 |
| Telephone Equipment | 18 |
| Terminals, Jacks & Wall Plates | 10 |
| Telecom Tools | 9 |
| Cable Management | 7 |

### Manufacturers

| Manufacturer | Products |
|---|---:|
| Tripp Lite by Eaton | 53 |
| RCA | 37 |
| Vericom | 21 |
| Ideal | 17 |
| Labor Saving Devices | 10 |
| Ethereal | 8 |
| APC | 7 |
| Clarity | 7 |
| Antennas Direct | 6 |
| Eagle Aspen | 6 |
| Pyle | 6 |
| Datacomm Electronics | 4 |
| Nanuk | 4 |
| Winegard | 4 |
| Kenwood | 2 |
| Prime | 2 |
| Stanley | 2 |
| Vtech | 2 |
| At&t | 1 |
| Cyberpower | 1 |
| Eco4life | 1 |
| Energizer Connect | 1 |
| Gemini | 1 |
| Helios | 1 |
| Koblenz | 1 |
| Wilson Electronics | 1 |

The storefront is searchable by title, manufacturer, category, public SKU, manufacturer MPN, validated GTIN, and derived public-safe keywords. Cards and product details retain quote controls and category placeholders until an image is approved.

Customer-facing fulfillment language is: **Availability and shipping are confirmed before payment.**

## Google Shopping and search readiness

- Exact manufacturer MPN present: 206/206.
- Validated GTIN present: 206/206.
- Approved public image reference present: 0/206.
- Image alt-text behavior: ready for future approved assets; it combines manufacturer, title, and MPN.
- Google Shopping readiness: **blocked**. No product has an approved public image, and 198 request-quote products have no public purchase price. The 8 fixed-price candidates remain non-checkout because shipping, destination, tax, and fulfillment guards are incomplete.
- Organic search readiness: identity/search fields are present, but richer product copy and image assets must not be published until content rights and exact-product accuracy are confirmed.

## Local review workflow

1. Run `node scripts/audit-opening-images.mjs --source <private-petra-csv> --owned-images <optional-local-image-paths>`.
2. Open `tmp/opening-image-staging/review.html` locally. It shows thumbnails, public SKU, manufacturer MPN, source class/domain, resolution, response status, rights status, an approval checkbox, a reviewer status, and notes.
3. Confirm the image depicts the exact manufacturer and MPN.
4. Obtain and retain explicit reseller-use permission for any supplier or manufacturer asset.
5. Copy an approved asset into a controlled public product-image location using a neutral public filename. Never hotlink Petra.
6. Update `operations/opening-image-approval-manifest.json` with only the approved local public reference, then run tests and build before release.

## Known limitations and manual decisions

- No production `public.product_images` records were queried or changed. The repository contains no approved opening-product image export to evaluate.
- Existing official manufacturer manuals and pricing evidence are reference material, not image-use permission.
- Unassociated user-owned warehouse photos remain outside this 206-product image set because filenames do not establish an exact SKU/MPN match.
- Image rights, pixel-level exact-product confirmation, final alt text, and any richer supplier-authored copy require human approval.
- The 8 approved prices remain fixed-price candidates, but checkout stays disabled because fulfillment, destination, shipping, and tax guards are not complete. The other 198 products remain request quote.

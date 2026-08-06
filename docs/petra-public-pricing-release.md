# Petra public merchandise pricing release

## Public pricing boundary

The 206-product opening catalog was revalidated against Petra's August 5, 2026 10:40:01 PM catalog snapshot. The opening-product boundary did not expand: none of the 20 newly added supplier SKUs was automatically published.

Only 17 products currently satisfy every publication gate: exact identity match, positive availability, no discontinued or sale/territory restriction, confirmed MAP handling, a candidate price at or below MSRP, and usable numeric exact-MPN market evidence. The other 189 products remain `request_quote` with no public price.

Every listed record uses `listed_price_shipping_quote`, keeps `checkout_active=false`, and remains in the quote-to-payment workflow. Listed amounts cover merchandise only; shipping and tax are confirmed after review.

No supplier identity, supplier SKU, private catalog field, confidential wholesale cost, MAP value, MSRP, margin, or internal calculation is included in the browser or public pricing bundles.

## Supplier catalog change audit

| Result | Count |
| --- | ---: |
| Current unique Petra SKUs | 2,587 |
| Added since August 4 snapshot | 20 |
| Removed since August 4 snapshot | 11 |
| Supplier price changes | 24 |
| Newly in stock | 28 |
| Newly out of stock | 35 |
| Current zero-stock rows | 576 |
| Current discontinued rows | 623 |
| Current sale/territory-restricted rows | 279 |

## Opening catalog audit

| Result | Count |
| --- | ---: |
| Opening catalog products | 206 |
| Exact matches | 206 |
| Ambiguous matches | 0 |
| Unmatched products | 0 |
| Products receiving public prices | 17 |
| Products remaining quote-only | 189 |
| Standard-rule prices | 15 |
| Prices raised to the applicable advertised-price floor | 2 |
| Out-of-stock products | 31 |
| Discontinued products | 3 |
| Sale/territory-restricted products | 18 |
| Supplier price changes affecting opening products | 2 |
| Opening products newly in stock | 3 |
| Opening products newly out of stock | 4 |

Published-price range: $4.58 to $129.99. Median published price: $21.36.

The row-level public audit in `operations/petra-public-pricing-audit.csv` identifies products only by public identity and records match/status classifications without confidential supplier values.

## Matching and pricing safeguards

- Identity matching is PETRA SKU first, exact manufacturer/vendor SKU second, and UPC third. Titles are never used.
- A 100% cost-markup candidate is raised to MAP when required, but it is not published when it exceeds MSRP or the supported exact-market ceiling.
- Missing numeric exact-MPN market evidence leaves a product quote-only.
- Zero stock, discontinued status, sale/territory restrictions, ambiguous identity, and unconfirmed MAP prevent price publication.
- Direct checkout remains disabled; shipping stays separate and is confirmed before payment.
- The browser submits only public SKU and quantity. The server remains authoritative for the public merchandise-price snapshot.

## Repeatable update

Run the private-source generator with the current local Petra workbook, the immediately preceding private snapshot, the private identity map, and the private exact-MPN market research file. Then run `npm run validate:opening-pricing` and the complete repository validation suite. The generator writes only sanitized public outputs and aggregate/status audit data.

# Petra public merchandise pricing release

## Public pricing boundary

The approved 206-product opening catalog now carries a public merchandise price. Every priced record uses `listed_price_shipping_quote`, keeps `checkout_active=false`, and remains in the existing quote-to-payment workflow.

The listed amount covers merchandise only. Shipping is calculated after order review based on destination, product size, weight, and carrier charges. Tax and shipping are confirmed before payment.

No supplier identity, supplier SKU, private catalog field, confidential price input, MAP value, MSRP, margin, or internal calculation is included in the browser or public pricing bundles.

## Audit totals

| Result | Count |
| --- | ---: |
| Approved catalog products | 206 |
| Matched products | 206 |
| Products receiving public prices | 206 |
| Products remaining quote-only | 0 |
| Standard-rule prices | 202 |
| Prices raised to the applicable advertised-price floor | 4 |
| Products with a positive advertised-price floor reported | 40 |
| Products with no positive advertised-price floor reported | 166 |
| Missing valid inputs | 0 |
| Invalid inputs | 0 |
| Public-pricing restrictions found in recorded supplier notes | 0 |
| Ambiguous matches | 0 |
| Unmatched products | 0 |

Published-price range: $4.58 to $1,748.68. Median published price: $54.28.

The row-level public audit in `operations/petra-public-pricing-audit.csv` identifies products by public SKU, manufacturer, MPN, and GTIN and records the match/status classification without confidential supplier values.

## Commerce safeguards

- The browser submits only public SKU and quantity to the quote endpoint.
- The server snapshots the current public merchandise price from its approved bundle.
- Direct checkout continues to require the separate `fixed` mode plus explicit checkout, shipping, destination, and tax configuration; none of the 206 records meet that direct-checkout gate.
- Admin review remains responsible for confirmed freight and tax.
- Stripe receives only the admin-confirmed final total through the quote-to-payment workflow.
- The public catalog RPC remains supplier-safe; RPC results receive the same public-only pricing overlay in the storefront client.

## Repeatable update

Run the private-source generator with the current local supplier catalog and the private identity map, then run `npm run validate:opening-pricing`. The generator writes only approved public outputs and aggregate/status audit data. Private source rows and confidential values are never copied into repository files.

# Petra Marketplace private dry-run report

Source snapshot: 2026-08-05T22:40:01-05:00
Rows reconciled: 2,587
Unique supplier SKUs: 2,587

No database, public-product, public-price, or image-publication writes were performed.

## Departments

| Department | Rows |
| --- | ---: |
| appliance-parts | 244 |
| automotive-marine | 177 |
| deals | 349 |
| electronics | 630 |
| health-beauty | 35 |
| home-kitchen | 739 |
| outdoor-fitness | 119 |
| tools | 294 |

## Publication safeguards

| Check | Count |
| --- | ---: |
| Positive inventory | 2,011 |
| Zero inventory (hidden) | 576 |
| Discontinued | 623 |
| Discontinued with inventory (Deals review) | 349 |
| Restricted | 279 |
| Identity conflicts | 105 |
| Unmapped departments | 0 |
| Public browse candidates before manual approval | 1,726 |
| Valid supplier image URLs | 2,587 |

## GTIN data quality

| Result | Rows |
| --- | ---: |
| bad_check_digit | 1,203 |
| bad_length_10 | 1 |
| bad_length_11 | 1,239 |
| bad_length_9 | 2 |
| missing | 8 |
| non_numeric | 30 |
| ok | 104 |
| public browse candidates with a valid GTIN | 0 |

GTIN fallback matching is **disabled for this snapshot**. The export contains widespread truncation/rounding, so even values that happen to pass a checksum cannot be treated as authoritative. Raw values are retained only inside the ignored private dry-run artifact for later remediation.

## Pricing review

| Status | Count |
| --- | ---: |
| discontinued_clearance | 324 |
| map_review | 4 |
| market_review_required | 128 |
| price_ready | 789 |
| quote_only | 861 |
| unprofitable | 481 |

These are review classifications, not approved public prices. Even price_ready records still require market review and Danny's approval before publication.

## Refresh delta versus the prior private snapshot

| Change | Rows |
| --- | ---: |
| additions | 20 |
| removals | 11 |
| cost changes | 24 |
| map changes | 0 |
| msrp changes | 3 |
| newly in stock | 28 |
| newly out of stock | 35 |
| newly discontinued | 9 |
| image changes | 0 |

All calculations remain private. No supplier cost, MAP, MSRP, margin, supplier SKU, supplier identity, or raw feed value is included in this report.

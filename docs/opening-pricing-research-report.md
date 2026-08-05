# Opening pricing and shipping research report

Research date: 2026-08-03

## Outcome

- Products reviewed by exact manufacturer MPN: 206
- Approved pricing candidates: 8
- Prices approved by Danny: 8
- Keep request quote: 0
- Manual pricing review: 198
- Average proposed gross margin across candidates: 45.1%
- Products missing a supplier estimated ship weight or dimension: 0

## Shipping-class counts

- small: 167
- medium: 25
- large: 8
- oversize: 6
- freight: 0
- manual_quote: 0

## Method and safety gates

Each exact MPN was searched against current public web results. Auction sites and large third-party marketplaces were excluded. A price became an `approved_candidate` only when at least two distinct public sellers exposed prices, the observed spread was no greater than 75%, the median public price was not below known supplier cost or MAP, and the supplier record did not indicate discontinuation. These are recommendations for Danny's review, not final prices.

The supporting search-evidence archive is kept locally in the git-ignored `operations/opening-pricing-evidence.json`. Candidate calculations count only exact-MPN title/URL matches from the reputable manufacturer, distributor, and major-retailer allowlist in the preparation script. Supplier URLs and research evidence are not published with the public repository.

Shipping uses only supplier-recorded dimensions and estimated ship weight. UPS publishes a 139 dimensional-weight divisor for daily rates, a 150-lb package limit, a 108-in length limit, and a 165-in length-plus-girth limit. No flat rate is recommended without the ship-from ZIP, destination zone, negotiated UPS rate, packed-unit measurements, and surcharge review. Products missing any required measurement remain `manual_quote`.

The private supplier-cost and per-item margin review is local-only at `tmp/pricing-private/opening-margins-private.csv` and is narrowly ignored by Git. Supplier cost is absent from every committed research file, shipping file, pricing template, and frontend JSON.

## Approval decisions required

Danny has approved the prices recorded in `operations/opening-approved-prices.json`. Before checkout is activated, he must still confirm packed dimensions and weight, select an origin ZIP and supported destinations, approve a carrier/Stripe shipping rate, decide taxable status and automatic-tax treatment, and explicitly activate checkout per SKU. No checkout flag is enabled by this approval.

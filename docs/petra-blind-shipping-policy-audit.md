# Petra blind-shipping and fulfillment policy audit

Audit date: 2026-08-03

Decision scope: fulfillment readiness for the eight approved-price opening products

Result: **do not activate Stripe checkout**

## Executive decision

Choose **E. Request quote only** for Petra-fulfilled products until Petra supplies the account-specific Fulfillment Services Agreement and a shipping method whose complete customer charge is known before Telecom Store accepts payment.

Petra publicly confirms blind dropshipping, but only for approved ecommerce customers who have signed a Fulfillment Services Agreement. Petra's public knowledge base also says shipping is calculated and added after an order is processed. Fulfillment orders never qualify for free freight, and carrier rates, fuel, accessorial, delivery-area, dimensional, oversize, insurance, and other charges may apply. Those rules do not provide a safe amount for a customer-facing Stripe charge.

The eight retail prices remain approved, but price approval is separate from fulfillment approval. All eight products must keep `checkout_active = false`.

## Evidence scope and limitations

Verified public sources:

- [Petra Terms & Conditions](https://www.petra.com/terms-conditions/)
- [Petra Knowledge Base](https://www.petra.com/knowledge-base)
- [Petra Marketplace Reseller FAQ](https://www.petra.com/help/marketplace-reseller-faq)
- [Petra Reseller Agreements and Authorizations](https://www.petra.com/reseller-agreements)
- [Petra: What is Drop Shipping?](https://blog.petra.com/blog/what-is-drop-shipping?hs_amp=true)
- [Petra: A Guide to Choosing the Right Supplier](https://blog.petra.com/blog/a-guide-to-choosing-the-right-supplier)

Product dimensions, last-known availability, returnability, and the presence—not the value—of a MAP record were checked against Danny's local account Prodlist snapshot dated 2026-07-29. No supplier cost, MAP amount, MSRP, account number, credential, or private price is reproduced here.

No relevant Petra onboarding, fulfillment, or shipping agreement was found in the connected Gmail mailbox. The Petra browser session was not signed in, so the account-specific flat-rate agreement and Fulfillment Services Agreement were unavailable. These missing documents are controlling evidence, not optional background.

## Verified fulfillment rules

### Blind shipping and branding

- Petra provides blind drop-ship service only to approved Etailers who have signed a Fulfillment Services Agreement.
- Petra's marketplace FAQ says dropship orders are blind shipped with no mention of Petra on the box.
- Petra's official dropshipping article says the supplier ships directly to the customer under the retailer's name with tracking information.
- Blind-ship label customization is available by request through Petra's dropship support team.
- It is **unconfirmed** whether Danny's account is currently approved for the fulfillment program or whether blind shipping is automatic after approval versus selected per order.
- It is **unconfirmed** whether the visible shipper name would be Telecom Store, Fatanett, or another approved DBA.
- It is **unconfirmed** whether Petra or manufacturer invoices, wholesale prices, Petra-branded inserts, or other paperwork can appear inside a package.
- Custom packing slips, logos, customer-facing return addresses, carrier-label return names, and per-order blind-ship fees are governed by the unavailable Fulfillment Services Agreement or account setup.

### Shipping

- Petra's default carrier is FedEx. Other carrier choices can be available for web or emailed orders, but Petra says only FedEx rates are shown on web orders.
- Petra offers account-specific flat-rate shipping options based on total shipment weight. The controlling flat-rate agreement requires account login and was unavailable for this audit.
- Petra says shipping is not included in the web subtotal; it is calculated and added after the order is processed.
- Fulfillment orders never qualify for free freight.
- Non-prepaid shipments can receive carrier, fuel, accessorial, delivery-area, extended-area, dimensional, oversize, insurance, and other charges. These charges are added to the invoice and are non-refundable.
- Unless otherwise agreed in writing, Petra selects the best shipping method based on product characteristics and destination.
- Orders are FOB origin from Petra's distribution center. Petra's published business address is 2101 S Kelly, Edmond, Oklahoma 73013, but the rate-calculation origin ZIP for every fulfillment order remains unconfirmed.
- Petra uses best efforts to ship qualifying orders received by 2:00 p.m. Central the same day, subject to carrier pickup. Dropship and fulfillment orders are expressly excluded from that same-day commitment.
- Weekend orders may be submitted but do not ship until Monday. Holiday rules are not published.
- There is no minimum order quantity.
- Backorders can be handled as Ship Complete or Ship Incomplete. Ship Incomplete may create multiple shipments. Petra also states that backorders ship automatically unless cancelled in advance; backordered products under $10 are automatically cancelled, while higher-value backordered or discontinued products trigger sales-representative contact.
- Orders released to Petra's distribution center are not cancellable.
- The public sources do not confirm use of Telecom Store's own carrier account, final-rate availability before submission, a rate API, multi-warehouse origins, tracking delivery method, signature rules, address-correction fees, or a fulfillment-specific cancellation cutoff.

### Returns, damage, loss, and warranty

- Every return requires a Return Goods Authorization signed by an authorized Petra representative. Unauthorized returns are refused. An RA is valid for 60 days.
- The RA number must appear on the outer shipping carton. Vendor packaging must not receive shipping labels or handwritten RA numbers.
- Products must be double packaged with all original packaging, parts, accessories, and manuals.
- Return freight to Petra is prepaid by Petra's customer and shipped FOB destination.
- Defective products may be returned to Petra within 30 days of Petra's sale to its customer. After 30 days, the applicable manufacturer warranty process controls.
- Non-defective products may be returned within 90 days if resalable and complete, subject to a 15% restocking fee.
- Special orders and closeouts are not returnable. Vendors may separately prohibit returns for specific products.
- Petra issues account/card credit rather than cash and asks customers to allow one week for return processing.
- Orders are FOB origin. Carrier damage becomes the carrier's responsibility. General parcel damage claims must be made directly to the carrier within 10 days and retain all packaging. Truck-line visible damage must be noted before acceptance and reported with documentation within 24 hours.
- Petra's ecommerce returns contact handles shipping claims, return questions, and RMAs, but the public rules do not establish whether an end customer may contact Petra directly. Until the Fulfillment Services Agreement says otherwise, Telecom Store should remain the customer's first contact and should coordinate the Petra RMA or claim.
- Lost-package handling, chargeback allocation, replacement timing, return-label branding, and return freight for non-damage customer returns remain unconfirmed.

### Product and channel restrictions

- Petra may require manufacturer authorization or prohibit online sale of specific products. Customers must immediately remove products when Petra instructs them to do so.
- Petra's account Prodlist excludes products requiring manufacturer approval. All eight SKUs appear in Danny's 2026-07-29 account Prodlist, so no additional manufacturer approval was indicated by that snapshot. This must be reconfirmed before activation.
- The public marketplace exclusion list does not name IDEAL, RCA, Vericom, or Tripp Lite by Eaton, the brands represented by these eight products.
- Petra access does not guarantee that a marketplace or sales channel permits a listing. Returns caused by channel-listing rejection remain subject to restocking fees.
- A MAP record exists for each of the eight products in the private account feed. The approved prices already passed the project's private MAP gate, but continuing compliance requires fresh feeds and current manufacturer policies.
- Public product data and images are not treated as proof of a transferable right to republish every asset. Website-domain approval and image/content usage rights remain unconfirmed.

### Account and order integration

- Confirmed order methods: Petra website, sales representative, and FTP. FTP setup requires a static IP and Petra coordination.
- The account Prodlist is a CSV updated hourly; Petra recommends downloading it at least twice per week because inventory changes quickly.
- Manual account order history exposes order details and invoices after sign-in.
- Public sources do not confirm a Petra shipping-rate API, order API, EDI, XML, automated order acknowledgement, webhook, tracking feed, cancellation feed, or real-time inventory reservation.
- Required delivery-address fields and whether customer phone numbers or email addresses are transmitted to carriers remain unconfirmed.

## Eight-SKU fulfillment decision

| Manufacturer MPN | Last-known availability (2026-07-29 feed) | Package screening data | Blind ship | Known restrictions | Safe for Stripe test checkout |
| --- | ---: | --- | --- | --- | --- |
| 85-372 | 5 | 4.50 × 3.50 × 1.40 in.; 0.45 lb | Unconfirmed | MAP record; returnable; account agreement missing | No |
| DH6HHE | 0 | 7.90 × 5.00 × 1.20 in.; 0.35 lb | Unconfirmed | MAP record; returnable; no last-known stock | No |
| TPH530BR | 6 | 8.70 × 3.90 × 1.40 in.; 0.3417 lb | Unconfirmed | MAP record; returnable | No |
| TPH532BR | 2 | 8.10 × 5.75 × 1.60 in.; 0.5361 lb | Unconfirmed | MAP record; returnable | No |
| VH47R | 13 | 5.75 × 3.80 × 0.40 in.; 0.20 lb | Unconfirmed | MAP record; returnable | No |
| AHD50-04294 | 6 | 8.50 × 8.30 × 3.00 in.; 3.41 lb | Unconfirmed | MAP record; returnable | No |
| SWIVEL6USB | 0 | 7.70 × 4.45 × 2.55 in.; 1.00 lb | Unconfirmed | MAP record; returnable; no last-known stock | No |
| TLM609SA | 6 | 15.80 × 5.10 × 1.80 in.; 2.08 lb | Unconfirmed | MAP record; returnable | No |

None screens as oversize from the recorded single-unit dimensions and weight, but that does not eliminate residential, rural, delivery-area, fuel, dimensional, insurance, address-correction, multi-package, or other carrier charges. Availability is **unconfirmed now** because Petra says the feed updates hourly and the local snapshot is from 2026-07-29.

## Recommended fulfillment architecture

Current state: **E. Request quote only.**

Do not use real-time Petra-calculated shipping because no verified rate API or pre-submission final-rate response is documented. Do not construct a Petra destination/package table without the signed flat-rate agreement and surcharge rules. Do not subsidize a Telecom Store flat rate without enough lane-level evidence and margin protection. Do not charge shipping after a Stripe payment because the customer total would not be known at authorization time.

If Petra confirms a binding weight-based flat-rate agreement that includes destination scope and every surcharge, option **C** could be reconsidered with an explicit reserve and reconciliation policy. If Petra exposes a final, binding rate before order submission, option **A** could be designed. Until then, Stripe checkout must remain disabled.

## Readiness

**READY TO CONFIGURE STRIPE TEST SHIPPING: NO.**

Blocking reasons:

1. Danny's account-level Etailer approval and signed Fulfillment Services Agreement are unverified.
2. Complete shipping cost is not known before Petra processes the order.
3. The account flat-rate agreement, fee schedule, surcharge treatment, and own-carrier-account rules are unavailable.
4. Package branding, packing-slip/invoice contents, return address, and end-customer return workflow are incomplete.
5. Blind-ship qualification and live availability are unconfirmed for every SKU; two were out of stock in the last-known feed.

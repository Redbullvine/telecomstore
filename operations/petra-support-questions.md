# Petra fulfillment questions requiring written confirmation

Prepared: 2026-08-03

Purpose: close the blockers identified in the public-policy audit before any Stripe test checkout is enabled.

This is a question list only. No message was sent. Do not include Petra credentials, supplier costs, MAP amounts, account payment data, or customer personal information when requesting answers.

## Priority 1 — account approval and blind-shipping identity

1. Is the Telecom Store/Fatanett account approved as an Etailer for Petra's fulfillment program?
2. Has the account signed the current Fulfillment Services Agreement? Please provide the current executed copy and all schedules/addenda.
3. After approval, is blind shipping automatic for every fulfillment order, an account-level setting, or a per-order option?
4. Which business name is currently configured on outbound labels: Telecom Store, Fatanett, another DBA, or none?
5. Does any Petra name, address, logo, account number, supplier invoice, wholesale price, manufacturer invoice, promotion, or other Petra-identifying material appear on or inside a blind-shipped package?
6. Can we provide a Telecom Store packing slip, logo, customer-service details, and return instructions? What formats, dimensions, review steps, and fees apply?
7. What return name and address appear on the carrier label? Can they be customized to Telecom Store?
8. Are there blind-ship, pick/pack, label-customization, packing-slip, per-line, per-box, or per-order fees? Please provide the full current fee schedule.

## Priority 1 — binding shipping cost before customer payment

9. Can Petra return a complete, binding shipping charge before we submit a fulfillment order? If yes, through which portal/API/FTP field and how long is the quote valid?
10. Please provide the account's current flat-rate agreement, including every weight tier, destination zone, service, package limit, exclusion, and effective date.
11. Does a flat rate include fuel, residential, delivery-area, extended-area, rural, dimensional, oversize, additional-handling, signature, declared-value/insurance, address-correction, and remote-area charges?
12. If a surcharge is not included, can its exact amount be known before order submission?
13. What ship-from ZIP or origin should Telecom Store use for rate estimates? Can an order originate from more than one Petra or vendor warehouse?
14. Which carriers and services are available for fulfillment orders? Is FedEx Ground guaranteed, or may Petra choose another service?
15. May Telecom Store use its own UPS or FedEx account? If yes, which billing and third-party-account fields are required, and which Petra handling fees remain?
16. Does Petra provide a shipping-rate API, EDI transaction, XML endpoint, FTP response, CSV table, or other machine-readable quote service? Please provide current specifications and sandbox/test access.
17. For split shipments or multiple origins, is shipping quoted and charged per shipment? Can a single customer order produce later supplemental freight charges?
18. Are shipping charges ever adjusted after shipment? If so, what events cause an adjustment and how is it communicated?

## Priority 1 — eight-SKU eligibility

For each MPN—`85-372`, `DH6HHE`, `TPH530BR`, `TPH532BR`, `VH47R`, `AHD50-04294`, `SWIVEL6USB`, and `TLM609SA`—please confirm in writing:

19. Is the product eligible for blind dropshipping on this account?
20. Is it currently available for fulfillment, and is inventory reserved at order acknowledgement or only at warehouse release?
21. What packed dimensions, billable weight, package count, origin ZIP, and carrier restrictions apply?
22. Is it subject to additional handling, oversize, dimensional, hazardous-material, signature, territory, or channel surcharges/restrictions?
23. Is it returnable through Petra, and do product/vendor-specific exceptions override the general return policy?
24. Is manufacturer or website-domain authorization required for sale on `telecomstore.net`?
25. What current MAP policy applies, and how are policy changes communicated?
26. May Telecom Store use Petra's product images, descriptions, manuals, trademarks, and other content on its own website and in Google Shopping?

## Priority 2 — ordering, acknowledgement, tracking, and cancellation

27. What is the supported production order workflow for ecommerce fulfillment: web portal, FTP batch, API, EDI, XML, CSV upload, email, or another method?
28. Please provide current technical specifications, required authentication, test process, acknowledgement format, error codes, and support escalation path.
29. What fields are required for residential and commercial delivery addresses?
30. Must the customer's phone number or email be transmitted to Petra or the carrier? If so, how is it used and protected?
31. How are order acknowledgement, rejection, partial acceptance, backorder, cancellation, shipment, and tracking messages delivered?
32. When is inventory committed to an order?
33. What is the cancellation deadline for fulfillment orders, and how do we receive confirmation that cancellation succeeded before charging/refunding a customer?
34. What are the exact weekday, weekend, and holiday processing rules for fulfillment orders? Is there a fulfillment-specific cutoff distinct from the public 2:00 p.m. Central best-effort cutoff?
35. Can Ship Complete be forced for all ecommerce orders? If not, how do we prevent unapproved split shipments and multiple freight charges?
36. Can backorders be disabled at the account or order level?
37. How and when are tracking numbers delivered? Are package-level carrier, service, tracking number, ship date, origin, and freight charge included?

## Priority 2 — returns, damage, loss, and customer service

38. Must the end customer contact Telecom Store, Petra, or the manufacturer first for returns, defects, shipping damage, and lost packages?
39. May Petra issue an RMA or carrier claim directly to an end customer, or must Telecom Store request it as the Petra account holder?
40. What return address and business name should Telecom Store publish to customers?
41. Who pays return freight for non-defective returns, defective products, wrong items, transit damage, and refused packages?
42. Does Petra provide a customer-facing return label? If yes, whose branding/address appears and how is the label cost charged?
43. What evidence and deadlines apply to concealed damage, visible damage, shortages, lost packages, and delivery disputes?
44. When Petra sends a replacement without freight expense, does that apply to every fulfillment product and destination?
45. Which warranties are handled by Petra during the first 30 days, and which manufacturers require direct service from day one?
46. How are RMA approvals, credits, denials, restocking fees, replacement tracking, and claim outcomes reported electronically?

## Decision request

Please identify one supported method that guarantees the complete customer shipping amount before Telecom Store accepts payment. If no such method exists, confirm that Petra fulfillment must remain request-quote or post-order invoiced rather than prepaid ecommerce checkout.

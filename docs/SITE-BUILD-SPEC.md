# TelecomStore.net Build Spec

## Goal

Build a clean, contractor-grade telecom material website for Telecom Store using the domain `telecomstore.net`.

The site should start as a quote-request storefront, not a full checkout store. Telecom parts often require verification, bulk pricing, shipping coordination, and compatibility checks.

## Business angle

Telecom Store has access to a large warehouse of telecom products including copper splicing materials, fiber materials, closures, modules, terminals, tools, and accessories.

The first version needs to prove inventory, collect leads, and make it easy to request quotes by SKU.

## Core pages / sections

1. Home
2. Inventory catalog
3. Product cards
4. Product detail route or modal
5. Request quote form
6. Contact / sourcing request
7. About warehouse inventory

## Initial categories

- Copper Splicing
- Fiber
- Closures
- Terminals
- Cable Hardware
- Tools
- Test Equipment
- Pedestals / Cabinets
- Misc Telecom Material

## Product data model

Each product should support:

- id
- sku
- brand
- title
- category
- condition
- quantityAvailable
- unit
- pairCapacity or technical capacity
- shortDescription
- details
- images
- status: quote / available / hold / sold

## Quote form fields

- Name
- Company
- Email
- Phone
- SKU or product name
- Quantity needed
- Project location
- Need-by date
- Notes

## Netlify

Use Vite build command:

`npm run build`

Publish folder:

`dist`

## Future upgrades

- Supabase inventory database
- Admin inventory editor
- Image upload flow
- OCR label extraction
- Bulk CSV import
- Stripe quote deposits or checkout
- Shipping calculator
- Google Merchant Center feed

# Telecom Store BAINTU Starter Pack

This is a starter package for `telecomstore.net`.

## What this is

A Vite + React starter storefront for telecom warehouse materials.

It is set up as a quote-request store, not a full checkout store. That is the safer first version because telecom parts usually need quantity verification, compatibility checks, freight/shipping planning, and bulk pricing.

## Quick start

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

Netlify publish folder:

```text
dist
```

## Where products live

```text
src/data/products.json
```

## Where product photos live

```text
public/images/products/
```

## Give BAINTU this prompt

Open:

```text
BAINTU_PROMPT.txt
```

Copy that whole file into BAINTU.

## Inventory intake

Use:

```text
docs/inventory-intake-template.csv
docs/PHOTO-NAMING-GUIDE.md
```

Best workflow:

1. Take product photos.
2. Rename photos by SKU.
3. Add product rows to the CSV.
4. Have BAINTU convert the CSV rows into `products.json`.
5. Verify before publishing.

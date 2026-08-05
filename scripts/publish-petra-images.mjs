import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import Papa from "papaparse";

import { findDuplicateImageUrls, normalizePetraImageUrl } from "./lib/petra-image-utils.mjs";

const root = process.cwd();
const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const sourcePath = arg("--source");
const identityMapPath = arg("--identity-map");
if (!sourcePath) throw new Error("--source must point to the private Petra CSV");
if (!identityMapPath) throw new Error("--identity-map must point to the private approved identity CSV");

const catalogPath = path.join(root, "src/data/opening-catalog.json");
const imageMapPath = path.join(root, "src/data/petra-product-images.json");
const restrictionsPath = path.join(root, "src/data/image-restrictions.json");
const auditPath = path.join(root, "operations/petra-image-publication-audit.json");
const reportPath = path.join(root, "docs/petra-image-publication-report.md");
const migrationPath = path.join(root, "supabase/migrations/20260805213000_publish_petra_product_images.sql");
const legacyAuditPath = path.join(root, "operations/opening-image-audit.csv");
const legacyReviewPath = path.join(root, "operations/opening-image-manual-review.csv");
const approvalManifestPath = path.join(root, "operations/opening-image-approval-manifest.json");

const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"));
if (catalog.length !== 206) throw new Error(`Expected 206 public products; found ${catalog.length}`);

const sourceLines = (await fs.readFile(sourcePath, "utf8")).replace(/^\uFEFF/, "").split(/\r?\n/);
const supplier = Papa.parse(sourceLines.slice(2).join("\n"), { header: true, skipEmptyLines: true });
if (supplier.errors.length) throw new Error(supplier.errors.map((error) => error.message).join("; "));

const identities = Papa.parse(await fs.readFile(identityMapPath, "utf8"), { header: true, skipEmptyLines: true });
if (identities.errors.length) throw new Error(identities.errors.map((error) => error.message).join("; "));

const requiredHeaders = ["VENDOR SKU", "PETRA SKU", "UPC", "IMAGE URL"];
for (const header of requiredHeaders) {
  if (!supplier.meta.fields.includes(header)) throw new Error(`Petra CSV is missing required header: ${header}`);
}

const clean = (value) => String(value || "").trim();
const upper = (value) => clean(value).toUpperCase();
const addIndex = (map, key, row) => {
  if (!key) return;
  const rows = map.get(key) || [];
  rows.push(row);
  map.set(key, rows);
};

const bySupplierSku = new Map();
const byMpn = new Map();
const byGtin = new Map();
for (const row of supplier.data) {
  addIndex(bySupplierSku, upper(row["PETRA SKU"]), row);
  addIndex(byMpn, upper(row["VENDOR SKU"]), row);
  addIndex(byGtin, clean(row.UPC), row);
}

const identityByPublicSku = new Map(identities.data.map((row) => [upper(row.proposed_public_sku), row]));
const ambiguous = [];
const unmatched = [];
const matchedSupplierRows = new Set();
const imageRecords = [];
const methodCounts = { supplier_sku: 0, manufacturer_mpn: 0, gtin: 0 };

for (const product of catalog) {
  const identity = identityByPublicSku.get(upper(product.sku));
  const candidates = [
    ["supplier_sku", identity ? bySupplierSku.get(upper(identity.supplier_sku)) : undefined],
    ["manufacturer_mpn", byMpn.get(upper(product.manufacturer_mpn))],
    ["gtin", byGtin.get(clean(product.gtin))]
  ];
  const [method, rows] = candidates.find(([, items]) => items?.length) || [];
  if (!rows) {
    unmatched.push({ sku: product.sku, manufacturer_mpn: product.manufacturer_mpn, gtin: product.gtin });
    continue;
  }
  if (rows.length !== 1) {
    ambiguous.push({ sku: product.sku, method, matches: rows.length });
    continue;
  }

  const supplierRow = rows[0];
  const rawUrl = clean(supplierRow["IMAGE URL"]);
  const publicUrl = normalizePetraImageUrl(rawUrl);
  if (!publicUrl) {
    unmatched.push({ sku: product.sku, manufacturer_mpn: product.manufacturer_mpn, gtin: product.gtin, reason: "invalid_or_empty_image_url" });
    continue;
  }

  methodCounts[method] += 1;
  matchedSupplierRows.add(supplierRow);
  imageRecords.push({
    public_sku: product.sku,
    manufacturer_mpn: product.manufacturer_mpn,
    gtin: product.gtin,
    brand: product.brand,
    title: product.title,
    photo_main: publicUrl,
    photo_source: "Petra CSV",
    image_rights_status: "approved",
    publish_supplier_image: true,
    alt_text: `${product.brand} ${product.title} (${product.manufacturer_mpn}) product image`
  });
}

if (ambiguous.length) throw new Error(`Ambiguous image matches: ${JSON.stringify(ambiguous)}`);
if (unmatched.length) throw new Error(`Unmatched catalog products: ${JSON.stringify(unmatched)}`);
if (imageRecords.length !== 206) throw new Error(`Expected 206 published image records; found ${imageRecords.length}`);

const duplicateUrls = findDuplicateImageUrls(imageRecords);

const imagesBySku = new Map(imageRecords.map((row) => [row.public_sku, row]));
const updatedCatalog = catalog.map((product) => {
  const image = imagesBySku.get(product.sku);
  return {
    ...product,
    photo_main: image.photo_main,
    image_rights_status: image.image_rights_status,
    publish_supplier_image: image.publish_supplier_image,
    image_source: image.photo_source
  };
});

const restrictions = {
  schema_version: 1,
  blocked_products: [],
  blocked_brands: [],
  blocked_supplier_skus: [],
  note: "Add a verified restriction here and republish, or insert an active protected database restriction for immediate RPC enforcement."
};

const audit = {
  generated_at: new Date().toISOString(),
  source_csv: path.basename(sourcePath),
  source_rows: supplier.data.length,
  source_image_fields: supplier.meta.fields.filter((field) => /image|photo|picture/i.test(field)),
  total_catalog_products: catalog.length,
  matched_catalog_products: imageRecords.length,
  match_methods: methodCounts,
  primary_images: imageRecords.length,
  alternate_images: 0,
  placeholders_remaining: catalog.length - imageRecords.length,
  invalid_image_urls: 0,
  unmatched_csv_rows: supplier.data.length - matchedSupplierRows.size,
  ambiguous_matches: ambiguous.length,
  duplicate_urls: duplicateUrls.length,
  duplicate_content_groups_from_prior_audit: 1,
  restricted_products_skipped: 0,
  rights_approved: imageRecords.length,
  publish_supplier_image_true: imageRecords.length,
  url_normalization: "http://petraimages.com.s3.amazonaws.com/... -> https://s3.us-east-2.amazonaws.com/petraimages.com/..."
};

await writeJson(imageMapPath, imageRecords);
await writeJson(restrictionsPath, restrictions);
await writeJson(catalogPath, updatedCatalog);
await writeJson(auditPath, audit);
const publicationReport = report(audit, duplicateUrls);
await fs.writeFile(reportPath, publicationReport, "utf8");
await fs.writeFile(path.join(root, "docs/opening-image-audit-report.md"), publicationReport, "utf8");
await fs.writeFile(migrationPath, migration(imageRecords), "utf8");
await updateLegacyAuditFiles(imageRecords);

console.log(JSON.stringify(audit, null, 2));

function sql(value) { return `'${String(value).replaceAll("'", "''")}'`; }

function migration(records) {
  const values = records.map((row) => `  (${sql(row.public_sku)}, ${sql(row.manufacturer_mpn)}, ${sql(row.gtin)}, ${sql(row.photo_main)}, ${sql(row.alt_text)})`).join(",\n");
  return `-- Publish Petra CSV product images with reversible restrictions.
-- Generated from a private local CSV. No supplier SKU, cost, quantity, MAP,
-- MSRP, account data, or other confidential supplier field is embedded here.

begin;

create table if not exists public.product_image_restrictions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete cascade,
  brand text,
  supplier_sku text,
  reason text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_image_restrictions_one_target_check check (
    num_nonnulls(product_id, brand, supplier_sku) = 1
  ),
  constraint product_image_restrictions_brand_not_blank_check check (brand is null or btrim(brand) <> ''),
  constraint product_image_restrictions_supplier_sku_not_blank_check check (supplier_sku is null or btrim(supplier_sku) <> '')
);

alter table public.product_image_restrictions enable row level security;
revoke all on table public.product_image_restrictions from public, anon;
grant select, insert, update, delete on table public.product_image_restrictions to authenticated;

drop policy if exists "Approved inventory users can read product image restrictions" on public.product_image_restrictions;
create policy "Approved inventory users can read product image restrictions"
on public.product_image_restrictions for select to authenticated
using (public.is_approved_inventory_user());

drop policy if exists "Approved inventory users can insert product image restrictions" on public.product_image_restrictions;
create policy "Approved inventory users can insert product image restrictions"
on public.product_image_restrictions for insert to authenticated
with check (public.is_approved_inventory_user());

drop policy if exists "Approved inventory users can update product image restrictions" on public.product_image_restrictions;
create policy "Approved inventory users can update product image restrictions"
on public.product_image_restrictions for update to authenticated
using (public.is_approved_inventory_user()) with check (public.is_approved_inventory_user());

drop policy if exists "Approved inventory users can delete product image restrictions" on public.product_image_restrictions;
create policy "Approved inventory users can delete product image restrictions"
on public.product_image_restrictions for delete to authenticated
using (public.is_approved_inventory_user());

create index if not exists product_image_restrictions_product_idx
  on public.product_image_restrictions(product_id) where active and product_id is not null;
create index if not exists product_image_restrictions_brand_idx
  on public.product_image_restrictions(lower(brand)) where active and brand is not null;
create index if not exists product_image_restrictions_supplier_sku_idx
  on public.product_image_restrictions(lower(supplier_sku)) where active and supplier_sku is not null;

drop trigger if exists set_product_image_restrictions_updated_at
  on public.product_image_restrictions;
create trigger set_product_image_restrictions_updated_at
before update on public.product_image_restrictions
for each row execute function public.set_updated_at();

create temp table petra_image_seed (
  public_sku text primary key,
  manufacturer_mpn text not null,
  gtin text not null,
  public_url text not null,
  alt_text text not null
) on commit drop;

insert into petra_image_seed (public_sku, manufacturer_mpn, gtin, public_url, alt_text) values
${values};

do $$
declare matched_count integer;
begin
  select count(*) into matched_count
  from petra_image_seed s
  where exists (
    select 1 from public.products p
    where p.sku = s.public_sku
      and lower(p.manufacturer_mpn) = lower(s.manufacturer_mpn)
      and p.gtin = s.gtin
  );
  if matched_count not in (0, 206) then
    raise exception 'Petra image seed requires either an empty disposable catalog or all 206 exact SKU/MPN/GTIN matches; found %', matched_count;
  end if;
end $$;

insert into public.product_images (
  product_id, url, source_type, source_url, alt_text, sort_order,
  is_primary, publishable, rights_status, image_type
)
select
  p.id,
  s.public_url,
  'supplier',
  s.public_url,
  s.alt_text,
  0,
  not exists (select 1 from public.product_images current where current.product_id = p.id and current.is_primary),
  true,
  'approved',
  'item'
from petra_image_seed s
join public.products p
  on p.sku = s.public_sku
 and lower(p.manufacturer_mpn) = lower(s.manufacturer_mpn)
 and p.gtin = s.gtin
where not exists (
  select 1 from public.product_images existing
  where existing.product_id = p.id and existing.url = s.public_url
);

create or replace function public.get_public_product_catalog()
returns table (
  id uuid, sku text, brand text, title text, category text, condition text,
  public_availability text, price numeric, currency_code text,
  public_price_note text, short_description text, long_description text,
  photo_main text, photo_label text, photo_extra_1 text, photo_extra_2 text,
  slug text, manufacturer_mpn text, gtin text, specifications jsonb,
  meta_title text, meta_description text, search_keywords text[],
  google_product_category text, canonical_url_override text,
  published_at timestamptz, updated_at timestamptz, status text
)
language sql stable security definer set search_path = pg_catalog
as $$
  select
    p.id, p.sku, p.brand, p.title, p.category, p.condition,
    case when p.quantity_available > 0 then 'in_stock'
         when p.quantity_available = 0 then 'out_of_stock'
         else 'quote_only' end,
    p.price, p.currency_code, case when p.price is null then 'Request quote' end,
    p.short_description, p.long_description,
    case when image_restriction.blocked is true then null else coalesce(public_image.url, p.photo_main) end,
    p.photo_label, p.photo_extra_1, p.photo_extra_2,
    p.slug, p.manufacturer_mpn, p.gtin, p.specifications,
    p.meta_title, p.meta_description, p.search_keywords,
    p.google_product_category, p.canonical_url_override,
    p.published_at, p.updated_at, p.status
  from public.products p
  left join lateral (
    select true as blocked
    from public.product_image_restrictions r
    where r.active is true
      and (
        r.product_id = p.id
        or (r.brand is not null and lower(r.brand) = lower(p.brand))
        or (r.supplier_sku is not null and exists (
          select 1
          from public.product_supplier_offers offer
          join public.supplier_products sp on sp.id = offer.supplier_product_id
          where offer.product_id = p.id
            and lower(sp.supplier_sku) = lower(r.supplier_sku)
        ))
      )
    limit 1
  ) image_restriction on true
  left join lateral (
    select pi.url
    from public.product_images pi
    where pi.product_id = p.id
      and pi.publishable is true
      and pi.rights_status = 'approved'
      and image_restriction.blocked is null
    order by pi.is_primary desc, pi.sort_order, pi.created_at
    limit 1
  ) public_image on true
  where p.status = 'available'
  order by p.updated_at desc nulls last;
$$;

revoke all on function public.get_public_product_catalog() from public;
grant execute on function public.get_public_product_catalog() to anon, authenticated;

comment on table public.product_image_restrictions is
  'Protected reversible controls for suppressing supplier images by product, brand, or private supplier SKU.';
comment on function public.get_public_product_catalog() is
  'Public-safe storefront projection with approved product images and protected restriction filtering.';

commit;
`;
}

function report(data, duplicateUrls) {
  return `# Petra product image publication audit

Generated: ${data.generated_at}

Petra authorized Telecom Store to display product image URLs supplied in its CSV. The private source CSV and supplier identifiers remain untracked. Public image URLs use the S3 regional HTTPS form required for secure storefront delivery.

| Measure | Count |
| --- | ---: |
| Approved catalog products | ${data.total_catalog_products} |
| Products matched to Petra rows | ${data.matched_catalog_products} |
| Supplier-SKU matches | ${data.match_methods.supplier_sku} |
| Exact MPN matches | ${data.match_methods.manufacturer_mpn} |
| GTIN fallback matches | ${data.match_methods.gtin} |
| Primary images published | ${data.primary_images} |
| Alternate images | ${data.alternate_images} |
| Placeholder-only products | ${data.placeholders_remaining} |
| Invalid image URLs | ${data.invalid_image_urls} |
| Unmatched CSV rows outside the opening catalog | ${data.unmatched_csv_rows} |
| Ambiguous matches | ${data.ambiguous_matches} |
| Duplicate URL groups | ${data.duplicate_urls} |
| Restricted products skipped | ${data.restricted_products_skipped} |
| Rights set to approved | ${data.rights_approved} |
| Supplier-image publication enabled | ${data.publish_supplier_image_true} |

The prior byte-level audit found one duplicate-content group (MHX-LHDME2 and MHX-LHDME4) even though their source URLs differ. Both remain traceable to separate exact Petra MPN rows and are included under the new blanket Petra authorization.

Duplicate URL groups: ${duplicateUrls.length ? JSON.stringify(duplicateUrls) : "none"}.

## Reversible restrictions

The protected database restriction table can suppress supplier images immediately by product, brand/manufacturer, or supplier SKU without deleting product or catalog data. Anonymous users receive no table privileges. The storefront RPC exposes only the selected approved URL and never returns a supplier SKU or supplier table field.
`;
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function updateLegacyAuditFiles(records) {
  const urls = new Map(records.map((row) => [row.public_sku, row.photo_main]));
  const auditRows = Papa.parse(await fs.readFile(legacyAuditPath, "utf8"), { header: true, skipEmptyLines: true }).data
    .map((row) => ({ ...row, rights_status: "approved", approved_public_image_count: "1", storefront_image_status: "petra_csv_image", review_status: "approved_by_petra_authorization", notes: "Petra authorized display of CSV-supplied product image URLs on telecomstore.net." }));
  const reviewRows = Papa.parse(await fs.readFile(legacyReviewPath, "utf8"), { header: true, skipEmptyLines: true }).data
    .map((row) => ({ ...row, rights_status: "approved", recommended_action: "publish_petra_csv_image", reviewer_status: "approved_by_petra_authorization", reviewer_notes: "Petra authorization confirmed for CSV-supplied image URLs." }));
  await fs.writeFile(legacyAuditPath, Papa.unparse(auditRows, { newline: "\n" }) + "\n", "utf8");
  await fs.writeFile(legacyReviewPath, Papa.unparse(reviewRows, { newline: "\n" }) + "\n", "utf8");
  await writeJson(approvalManifestPath, {
    schema_version: 2,
    generated_on: new Date().toISOString().slice(0, 10),
    policy: {
      authorization: "Petra confirmed that CSV-supplied product image URLs may be displayed on telecomstore.net.",
      revocation: "Protected restrictions may disable an image by product, brand/manufacturer, or supplier SKU without deleting catalog data."
    },
    counts: { products: 206, candidate_images: 206, approved_public_images: 206, placeholders_required: 0 },
    products: Object.fromEntries(records.map((row) => [row.public_sku, {
      manufacturer_mpn: row.manufacturer_mpn,
      image_rights_status: "approved",
      approved_public_images: [urls.get(row.public_sku)],
      publish_supplier_image: true,
      storefront_fallback: "category_placeholder_on_error"
    }]))
  });
}

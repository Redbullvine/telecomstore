// Local-DB integration tests. OPT-IN: they run only when PETRA_TEST_DB_URL is
// set to a LOCAL disposable Supabase database. This keeps `npm test` hermetic
// by default (these are skipped) while still allowing full verification of the
// transactional loader against a real local database.
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(here, "..", "scripts", "import-petra-catalog.mjs");
const source = path.join(here, "..", "tmp", "catalog-prep", "opening-catalog-287.json");
const DB = process.env.PETRA_TEST_DB_URL || "";
const ready = Boolean(DB) && fs.existsSync(source);
const require = createRequire(import.meta.url);

function runImporter(extraEnv = {}) {
  try {
    const out = execFileSync(process.execPath, [scriptPath, "--apply-local", "--source", source], {
      encoding: "utf8",
      env: { ...process.env, PETRA_DB_URL: DB, ...extraEnv },
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") };
  }
}

async function withClient(fn) {
  const { Client } = require("pg");
  const c = new Client({ connectionString: DB });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

test("local import is idempotent on rerun (zero new products)", { skip: !ready }, async () => {
  runImporter(); // ensure imported
  const before = await withClient((c) => c.query("select count(*)::int n from public.products"));
  const res = runImporter();
  const j = JSON.parse(res.out);
  assert.equal(j.inserted, 0, "rerun must insert zero new products");
  const after = await withClient((c) => c.query("select count(*)::int n from public.products"));
  assert.equal(after.rows[0].n, before.rows[0].n);
});

test("anon RPC returns every imported product as quote-only with null price", { skip: !ready }, async () => {
  await withClient(async (c) => {
    const prod = await c.query("select count(*)::int n from public.products");
    await c.query("set role anon");
    const rpc = await c.query(
      `select count(*)::int total,
              count(*) filter (where price is null)::int price_null,
              count(*) filter (where public_availability='quote_only')::int quote_only
       from public.get_public_product_catalog()`
    );
    assert.equal(rpc.rows[0].total, prod.rows[0].n);
    assert.equal(rpc.rows[0].price_null, rpc.rows[0].total);
    assert.equal(rpc.rows[0].quote_only, rpc.rows[0].total);
  });
});

test("no publishable/product images exist (Petra image rights pending)", { skip: !ready }, async () => {
  await withClient(async (c) => {
    const imgs = await c.query("select count(*)::int n from public.product_images");
    const pub = await c.query("select count(*)::int n from public.product_images where publishable is true");
    assert.equal(imgs.rows[0].n, 0);
    assert.equal(pub.rows[0].n, 0);
  });
});

test("anon cannot read the products base table or supplier data", { skip: !ready }, async () => {
  await withClient(async (c) => {
    await c.query("set role anon");
    await assert.rejects(() => c.query("select * from public.products limit 1"), /permission denied/);
    // Supplier tables: anon obtains no rows (RLS) whether denied or filtered.
    const sp = await c.query("select count(*)::int n from public.supplier_products").catch((e) => ({ err: e }));
    if (!sp.err) assert.equal(sp.rows[0].n, 0);
  });
});

test("a forced mid-transaction failure rolls back with no partial catalog", { skip: !ready }, async () => {
  const before = await withClient((c) => c.query("select count(*)::int n from public.products"));
  const res = runImporter({ PETRA_FORCE_FAIL: "1" });
  assert.equal(res.code, 1, "forced failure must exit nonzero");
  assert.match(res.out, /failed_stage/);
  const after = await withClient((c) => c.query("select count(*)::int n from public.products"));
  assert.equal(after.rows[0].n, before.rows[0].n, "rollback must leave product count unchanged");
});

test("supplier cost/MAP/MSRP are never persisted by this quote-only import", { skip: !ready }, async () => {
  await withClient(async (c) => {
    const snap = await c.query(
      "select count(*) filter (where supplier_cost is not null)::int cost, count(*) filter (where map_price is not null)::int map, count(*) filter (where msrp is not null)::int msrp from public.supplier_product_snapshots"
    );
    assert.equal(snap.rows[0].cost, 0);
    assert.equal(snap.rows[0].map, 0);
    assert.equal(snap.rows[0].msrp, 0);
  });
});

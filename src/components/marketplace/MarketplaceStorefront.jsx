import React, { useEffect, useMemo, useState } from "react";
import { Lock, PackageSearch, Search, ShoppingBag, X } from "lucide-react";
import { applyStorefrontMetadata } from "../../lib/storefront-catalog.mjs";
import {
  MARKETPLACE_DEPARTMENTS,
  filterMarketplaceProducts,
  marketplaceDepartmentPath,
  marketplaceMetadata,
  marketplaceProductPath,
  resolveMarketplaceRoute,
} from "../../lib/marketplace-catalog.mjs";
import { fetchMarketplaceCatalog, fetchMarketplaceProductDetails } from "../../lib/marketplace-api.mjs";

const EMPTY_FILTERS = { query: "", department: "all", subcategory: "all", brand: "all", availability: "all", priceRange: "all", deals: false, sort: "brand" };
// The catalog runs to thousands of products, so the grid renders a page at a
// time; mounting every card at once would create thousands of DOM nodes and
// image requests on first paint.
const PAGE_SIZE = 48;

export default function MarketplaceStorefront({ route, navigate, quoteCount, isQuoted, onAddQuote, onOpenQuote, onAsk }) {
  const [products, setProducts] = useState([]);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [state, setState] = useState("loading");
  const routeInfo = useMemo(() => resolveMarketplaceRoute(route.path, products), [route.path, products]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setState("loading");
      fetchMarketplaceCatalog(filters.query).then((records) => {
        if (!active) return;
        setProducts(records);
        setState("ready");
      }).catch(() => {
        if (!active) return;
        setProducts([]);
        setState("unavailable");
      });
    }, filters.query ? 250 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [filters.query]);

  useEffect(() => {
    if (routeInfo.kind === "marketplace_department") setFilters((current) => ({ ...current, department: routeInfo.department.slug }));
    else if (routeInfo.kind === "marketplace_home") setFilters((current) => ({ ...current, department: "all" }));
  }, [routeInfo.kind, routeInfo.department?.slug]);

  useEffect(() => {
    applyStorefrontMetadata(marketplaceMetadata(routeInfo, products.length));
    let robots = document.querySelector('meta[name="robots"]');
    if (!robots) {
      robots = document.createElement("meta");
      robots.name = "robots";
      document.head.append(robots);
    }
    robots.content = products.length ? "index,follow" : "noindex,follow";
  }, [routeInfo, products.length]);

  // Scope the subcategory and brand pickers to the active department: the full
  // catalog carries far too many of each for one flat dropdown to be usable.
  const inDepartment = useMemo(() => (
    filters.department === "all" || filters.department === "deals"
      ? products
      : products.filter((product) => product.department_slug === filters.department)
  ), [products, filters.department]);
  const subcategories = useMemo(() => [...new Set(inDepartment.map((product) => product.subcategory).filter(Boolean))].sort(), [inDepartment]);
  const brands = useMemo(() => [...new Set(inDepartment.map((product) => product.brand).filter(Boolean))].sort(), [inDepartment]);
  // Search is executed inside the security-definer RPC so an internal
  // supplier-SKU match can find an approved product without returning that SKU.
  const filtered = useMemo(() => filterMarketplaceProducts(products, { ...filters, query: "" }), [products, filters]);
  const setFilter = (name, value) => setFilters((current) => ({ ...current, [name]: value }));
  const reset = () => { setFilters(EMPTY_FILTERS); navigate("/shop"); };

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  // Any change to the result set starts the grid back at the first page.
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [filters, products.length]);
  // A subcategory or brand chosen in one department usually does not exist in the
  // next one, which would otherwise leave the grid empty with no obvious cause.
  useEffect(() => {
    setFilters((current) => {
      const next = { ...current };
      if (next.subcategory !== "all" && !subcategories.includes(next.subcategory)) next.subcategory = "all";
      if (next.brand !== "all" && !brands.includes(next.brand)) next.brand = "all";
      return next.subcategory === current.subcategory && next.brand === current.brand ? current : next;
    });
  }, [subcategories, brands]);
  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);

  if (routeInfo.kind === "marketplace_product" && routeInfo.product) {
    return <>
      <MarketplaceHeader query={filters.query} setQuery={(value) => setFilter("query", value)} quoteCount={quoteCount} navigate={navigate} onQuote={onOpenQuote} />
      <MarketplaceNav active={routeInfo.product.department_slug} navigate={navigate} />
      <MarketplaceProductDetail product={routeInfo.product} navigate={navigate} quoted={isQuoted(routeInfo.product)} onAddQuote={onAddQuote} onAsk={onAsk} />
      <MarketplaceFooter navigate={navigate} />
    </>;
  }

  if (routeInfo.kind === "marketplace_not_found" || (routeInfo.kind === "marketplace_product" && !routeInfo.product && state === "ready")) {
    return <>
      <MarketplaceHeader query={filters.query} setQuery={(value) => setFilter("query", value)} quoteCount={quoteCount} navigate={navigate} onQuote={onOpenQuote} />
      <section className="mp-empty-route"><h1>Marketplace page not found</h1><p>This product or department is not currently published.</p><button type="button" onClick={() => navigate("/shop")}>Return to marketplace</button></section>
      <MarketplaceFooter navigate={navigate} />
    </>;
  }

  const heading = routeInfo.kind === "marketplace_department" ? routeInfo.department.name : "Telecom Store Marketplace";
  return <>
    <MarketplaceHeader query={filters.query} setQuery={(value) => setFilter("query", value)} quoteCount={quoteCount} navigate={navigate} onQuote={onOpenQuote} />
    <MarketplaceNav active={filters.department} navigate={navigate} />
    <section className="mp-intro"><div className="ts-wrap"><div><p className="ts-eyebrow">Telecom Store Marketplace</p><h1>{heading}</h1><p>Shop the Whole Internet</p></div><span>{products.length}<small>approved products</small></span></div></section>
    <section className="mp-catalog"><div className="ts-wrap">
      <MarketplaceFilters filters={filters} setFilter={setFilter} subcategories={subcategories} brands={brands} onReset={reset} />
      <div className="mp-results"><div><strong>{filtered.length}</strong> products{filtered.length > visible.length ? <> &nbsp;&bull;&nbsp; showing {visible.length}</> : null}</div>{filters.deals || filters.department === "deals" ? <span>Deals only</span> : null}</div>
      {state === "loading" ? <MarketplaceEmpty title="Loading marketplace" body="Checking the approved public catalog." /> : null}
      {state === "unavailable" ? <MarketplaceEmpty title="Marketplace release is being prepared" body="No marketplace products have been published. The telecom catalog remains available from the main store." /> : null}
      {state === "ready" && products.length === 0 ? <MarketplaceEmpty title="Marketplace release is awaiting final approval" body="Products will appear here only after inventory, restriction, identity, pricing, and image reviews are complete." /> : null}
      {state === "ready" && products.length > 0 && filtered.length === 0 ? <MarketplaceEmpty title="No approved products match those filters" body="Reset the filters or ask us about the exact item you need." /> : null}
      <div className="mp-grid">{visible.map((product) => <MarketplaceCard key={product.id || product.sku} product={product} quoted={isQuoted(product)} navigate={navigate} onAddQuote={onAddQuote} onAsk={onAsk} />)}</div>
      {filtered.length > visible.length ? (
        <div className="mp-more">
          <button type="button" onClick={() => setVisibleCount((current) => current + PAGE_SIZE)}>
            Show more products ({filtered.length - visible.length} remaining)
          </button>
        </div>
      ) : null}
    </div></section>
    <MarketplaceFooter navigate={navigate} />
  </>;
}

function MarketplaceHeader({ query, setQuery, quoteCount, navigate, onQuote }) {
  return <header className="mp-header"><div className="ts-wrap"><a href="/shop" className="mp-brand" onClick={(event) => { event.preventDefault(); navigate("/shop"); }}><span className="ts-mark">TS</span><span><strong>Telecom Store Marketplace</strong><small>Shop the Whole Internet</small></span></a><form role="search" onSubmit={(event) => event.preventDefault()}><Search size={18} /><input aria-label="Search marketplace" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search product, brand, MPN, GTIN, or keyword" />{query ? <button type="button" aria-label="Clear marketplace search" onClick={() => setQuery("")}><X size={17} /></button> : null}</form><div className="mp-header-actions"><button type="button" onClick={onQuote}><ShoppingBag size={17} /> Quote List <span>{quoteCount}</span></button><button type="button" onClick={() => navigate("/login")}><Lock size={15} /> Admin</button></div></div></header>;
}

function MarketplaceNav({ active, navigate }) {
  return <nav className="mp-nav" aria-label="Marketplace departments"><div className="ts-wrap"><a className={active === "all" ? "on" : ""} href="/shop" onClick={(event) => { event.preventDefault(); navigate("/shop"); }}>All</a>{MARKETPLACE_DEPARTMENTS.map((department) => <a key={department.slug} className={active === department.slug ? "on" : ""} href={marketplaceDepartmentPath(department)} onClick={(event) => { event.preventDefault(); navigate(marketplaceDepartmentPath(department)); }}>{department.name}</a>)}<a href="/" onClick={(event) => { event.preventDefault(); navigate("/"); }}>Telecom catalog</a></div></nav>;
}

function MarketplaceFilters({ filters, setFilter, subcategories, brands, onReset }) {
  return <div className="mp-filters" aria-label="Marketplace filters"><label><span>Department</span><select value={filters.department} onChange={(event) => setFilter("department", event.target.value)}><option value="all">All departments</option>{MARKETPLACE_DEPARTMENTS.map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select></label><label><span>Subcategory</span><select value={filters.subcategory} onChange={(event) => setFilter("subcategory", event.target.value)}><option value="all">All subcategories</option>{subcategories.map((item) => <option key={item}>{item}</option>)}</select></label><label><span>Brand</span><select value={filters.brand} onChange={(event) => setFilter("brand", event.target.value)}><option value="all">All brands</option>{brands.map((item) => <option key={item}>{item}</option>)}</select></label><label><span>Price</span><select value={filters.priceRange} onChange={(event) => setFilter("priceRange", event.target.value)}><option value="all">All prices</option><option value="under-25">Under $25</option><option value="25-100">$25–$100</option><option value="100-500">$100–$500</option><option value="over-500">Over $500</option><option value="request-price">Request price</option></select></label><label><span>Availability</span><select value={filters.availability} onChange={(event) => setFilter("availability", event.target.value)}><option value="all">All approved listings</option><option value="priced">Published price</option><option value="quote">Request price</option></select></label><label><span>Sort</span><select value={filters.sort} onChange={(event) => setFilter("sort", event.target.value)}><option value="brand">Brand A–Z</option><option value="name">Name A–Z</option><option value="price-low">Price low–high</option><option value="price-high">Price high–low</option><option value="newest">Newest</option></select></label><label className="mp-deals"><input type="checkbox" checked={filters.deals} onChange={(event) => setFilter("deals", event.target.checked)} /> Deals only</label><button type="button" onClick={onReset}>Reset</button></div>;
}

function MarketplaceCard({ product, quoted, navigate, onAddQuote, onAsk }) {
  return <article className="mp-card"><a href={marketplaceProductPath(product)} onClick={(event) => { event.preventDefault(); navigate(marketplaceProductPath(product)); }}><MarketplaceImage product={product} /></a><div className="mp-card-body">{product.clearance ? <span className="mp-deal-badge">Limited quantity</span> : null}<p>{product.brand}</p><h2><a href={marketplaceProductPath(product)} onClick={(event) => { event.preventDefault(); navigate(marketplaceProductPath(product)); }}>{product.title}</a></h2><dl><div><dt>MPN</dt><dd>{product.manufacturer_mpn}</dd></div>{product.gtin ? <div><dt>GTIN</dt><dd>{product.gtin}</dd></div> : null}</dl><small>{product.availability_text}</small><strong>{product.public_price === null ? "Request Price" : `$${product.public_price.toFixed(2)}`}</strong><div><button type="button" onClick={() => onAddQuote(product, 1)}>{quoted ? "Update Quote List" : "Add to Quote"}</button><button type="button" onClick={() => onAsk(product)}>Ask</button></div></div></article>;
}

function MarketplaceImage({ product }) {
  return <div className="mp-image">{product.image_url ? <img src={product.image_url} alt={product.image_alt || `${product.brand} ${product.manufacturer_mpn}`} loading="lazy" /> : <span><PackageSearch size={40} /><b>{product.brand}</b><small>Approved image pending</small></span>}</div>;
}

function MarketplaceProductDetail({ product, navigate, quoted, onAddQuote, onAsk }) {
  // Spec bullets are not in the list payload, so fetch them for this product.
  // `specs` falls back to whatever the catalog source already supplied, which is
  // how the RPC path (which does return long_description) keeps working.
  const [specs, setSpecs] = useState(product.long_description || "");
  useEffect(() => {
    let active = true;
    setSpecs(product.long_description || "");
    if (product.long_description) return undefined;
    fetchMarketplaceProductDetails(product.slug).then((text) => { if (active) setSpecs(text); });
    return () => { active = false; };
  }, [product.slug, product.long_description]);

  const bullets = specs.split("\n").map((line) => line.trim()).filter(Boolean);
  return <section className="mp-detail"><div className="ts-wrap"><button type="button" onClick={() => navigate(`/shop/${product.department_slug}`)}>← {product.department_name}</button><div className="mp-detail-grid"><MarketplaceImage product={product} /><div><p className="ts-eyebrow">{product.brand}</p><h1>{product.title}</h1>{product.clearance ? <span className="mp-deal-badge">Limited quantity—no restock expected</span> : null}<dl><div><dt>Manufacturer MPN</dt><dd>{product.manufacturer_mpn}</dd></div>{product.gtin ? <div><dt>GTIN</dt><dd>{product.gtin}</dd></div> : null}<div><dt>Condition</dt><dd>{product.condition === "refurbished" ? "Refurbished" : "New"}</dd></div><div><dt>Department</dt><dd>{product.product_type || product.department_name}</dd></div><div><dt>Availability</dt><dd>{product.availability_text}</dd></div></dl><p>{product.short_description}</p>{bullets.length ? <ul className="mp-specs">{bullets.map((line, index) => <li key={index}>{line}</li>)}</ul> : null}<strong className="mp-detail-price">{product.public_price === null ? "Request Price" : `$${product.public_price.toFixed(2)}`}</strong><p>Shipping and tax are confirmed separately before payment.</p><div className="mp-detail-actions"><button type="button" onClick={() => onAddQuote(product, 1)}>{quoted ? "Update Quote List" : "Add to Quote"}</button><button type="button" onClick={() => onAsk(product)}>Ask about this item</button></div></div></div></div></section>;
}

function MarketplaceEmpty({ title, body }) {
  return <div className="mp-empty"><PackageSearch size={34} /><strong>{title}</strong><span>{body}</span></div>;
}

function MarketplaceFooter({ navigate }) {
  return <footer className="mp-footer"><div className="ts-wrap"><div><strong>Telecom Store Marketplace</strong><span>Shop the Whole Internet</span></div><nav><a href="/shop" onClick={(event) => { event.preventDefault(); navigate("/shop"); }}>Marketplace</a><a href="/" onClick={(event) => { event.preventDefault(); navigate("/"); }}>Telecom catalog</a></nav><p>Availability, merchandise price, shipping, and tax are confirmed before payment.</p></div></footer>;
}

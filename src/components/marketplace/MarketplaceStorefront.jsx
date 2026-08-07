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
import { fetchMarketplaceCatalog } from "../../lib/marketplace-api.mjs";

const EMPTY_FILTERS = { query: "", department: "all", subcategory: "all", brand: "all", availability: "all", priceRange: "all", deals: false, sort: "brand" };

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

  const subcategories = useMemo(() => [...new Set(products.map((product) => product.subcategory).filter(Boolean))].sort(), [products]);
  const brands = useMemo(() => [...new Set(products.map((product) => product.brand).filter(Boolean))].sort(), [products]);
  // Search is executed inside the security-definer RPC so an internal
  // supplier-SKU match can find an approved product without returning that SKU.
  const filtered = useMemo(() => filterMarketplaceProducts(products, { ...filters, query: "" }), [products, filters]);
  const setFilter = (name, value) => setFilters((current) => ({ ...current, [name]: value }));
  const reset = () => { setFilters(EMPTY_FILTERS); navigate("/shop"); };

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
      <div className="mp-results"><div><strong>{filtered.length}</strong> products</div>{filters.deals ? <span>Deals only</span> : null}</div>
      {state === "loading" ? <MarketplaceEmpty title="Loading marketplace" body="Checking the approved public catalog." /> : null}
      {state === "unavailable" ? <MarketplaceEmpty title="Marketplace release is being prepared" body="No marketplace products have been published. The telecom catalog remains available from the main store." /> : null}
      {state === "ready" && products.length === 0 ? <MarketplaceEmpty title="Marketplace release is awaiting final approval" body="Products will appear here only after inventory, restriction, identity, pricing, and image reviews are complete." /> : null}
      {state === "ready" && products.length > 0 && filtered.length === 0 ? <MarketplaceEmpty title="No approved products match those filters" body="Reset the filters or ask us about the exact item you need." /> : null}
      <div className="mp-grid">{filtered.map((product) => <MarketplaceCard key={product.id || product.sku} product={product} quoted={isQuoted(product)} navigate={navigate} onAddQuote={onAddQuote} onAsk={onAsk} />)}</div>
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
  return <section className="mp-detail"><div className="ts-wrap"><button type="button" onClick={() => navigate(`/shop/${product.department_slug}`)}>← {product.department_name}</button><div className="mp-detail-grid"><MarketplaceImage product={product} /><div><p className="ts-eyebrow">{product.brand}</p><h1>{product.title}</h1>{product.clearance ? <span className="mp-deal-badge">Limited quantity—no restock expected</span> : null}<dl><div><dt>Manufacturer MPN</dt><dd>{product.manufacturer_mpn}</dd></div>{product.gtin ? <div><dt>GTIN</dt><dd>{product.gtin}</dd></div> : null}<div><dt>Department</dt><dd>{product.department_name}</dd></div><div><dt>Availability</dt><dd>{product.availability_text}</dd></div></dl><p>{product.long_description || product.short_description}</p><strong className="mp-detail-price">{product.public_price === null ? "Request Price" : `$${product.public_price.toFixed(2)}`}</strong><p>Shipping and tax are confirmed separately before payment.</p><div className="mp-detail-actions"><button type="button" onClick={() => onAddQuote(product, 1)}>{quoted ? "Update Quote List" : "Add to Quote"}</button><button type="button" onClick={() => onAsk(product)}>Ask about this item</button></div></div></div></div></section>;
}

function MarketplaceEmpty({ title, body }) {
  return <div className="mp-empty"><PackageSearch size={34} /><strong>{title}</strong><span>{body}</span></div>;
}

function MarketplaceFooter({ navigate }) {
  return <footer className="mp-footer"><div className="ts-wrap"><div><strong>Telecom Store Marketplace</strong><span>Shop the Whole Internet</span></div><nav><a href="/shop" onClick={(event) => { event.preventDefault(); navigate("/shop"); }}>Marketplace</a><a href="/" onClick={(event) => { event.preventDefault(); navigate("/"); }}>Telecom catalog</a></nav><p>Availability, merchandise price, shipping, and tax are confirmed before payment.</p></div></footer>;
}

import React, { useEffect, useMemo, useState } from "react";
import { ChevronRight, FileImage, Lock, Search, ShieldCheck, ShoppingBag, Upload, X } from "lucide-react";
import { applyStorefrontMetadata } from "../../lib/storefront-catalog.mjs";
import { validateArtworkFile } from "../../lib/artwork-validation.mjs";
import {
  CUSTOMIZATION_METHODS,
  LOGO_PLACEMENTS,
  WORKWEAR_PRODUCTS,
  WORKWEAR_SUBCATEGORIES,
  resolveWorkwearRoute,
  searchWorkwearProducts,
  startingPriceLabel,
  workwearMetadata,
  workwearProductPath,
  workwearQuoteItem
} from "../../lib/custom-workwear.mjs";
import "./custom-workwear.css";

export default function CustomWorkwearStorefront({ route, navigate, quoteCount, onOpenQuote, onAddQuote }) {
  const routeInfo = useMemo(() => resolveWorkwearRoute(route.path), [route.path]);
  const initialQuery = useMemo(() => new URLSearchParams(route.search || "").get("search") || "", [route.search]);
  const [query, setQuery] = useState(initialQuery);
  const [subcategory, setSubcategory] = useState("All");
  const products = useMemo(() => searchWorkwearProducts(query, subcategory), [query, subcategory]);

  useEffect(() => applyStorefrontMetadata(workwearMetadata(routeInfo)), [routeInfo]);
  useEffect(() => setQuery(initialQuery), [initialQuery]);

  const submitSearch = (event) => {
    event.preventDefault();
    navigate(`/custom-workwear${query.trim() ? `?search=${encodeURIComponent(query.trim())}` : ""}`);
  };

  return <>
    <WorkwearHeader query={query} setQuery={setQuery} submitSearch={submitSearch} quoteCount={quoteCount} navigate={navigate} onOpenQuote={onOpenQuote} />
    <WorkwearNav subcategory={subcategory} setSubcategory={(value) => { setSubcategory(value); if (routeInfo.kind !== "department") navigate("/custom-workwear"); }} navigate={navigate} />
    {routeInfo.kind === "product" && routeInfo.product
      ? <WorkwearProductDetail product={routeInfo.product} navigate={navigate} onAddQuote={onAddQuote} />
      : routeInfo.kind === "not_found" || (routeInfo.kind === "product" && !routeInfo.product)
        ? <section className="ww-empty"><h1>Product not found</h1><p>This custom product is not in the current collection.</p><button type="button" onClick={() => navigate("/custom-workwear")}>Browse custom workwear</button></section>
        : <WorkwearDepartment products={products} query={query} navigate={navigate} />}
    <WorkwearFooter navigate={navigate} />
  </>;
}

export function WorkwearHomepageShelf({ navigate }) {
  return <section className="ww-home-shelf" aria-labelledby="custom-workwear-heading"><div className="ts-wrap">
    <div className="ww-home-head"><div><span>NEW SELLABLE DEPARTMENT</span><h1 id="custom-workwear-heading">Custom workwear for the whole crew</h1><p>Company apparel, hard hats, reflective shirts, jackets, and safety vests—all ready for your logo.</p></div><button type="button" onClick={() => navigate("/custom-workwear")}>Shop all custom workwear <ChevronRight size={18} /></button></div>
    <div className="ww-home-grid">{WORKWEAR_PRODUCTS.map((product) => <WorkwearCard key={product.sku} product={product} navigate={navigate} compact />)}</div>
  </div></section>;
}

function WorkwearHeader({ query, setQuery, submitSearch, quoteCount, navigate, onOpenQuote }) {
  return <header className="ww-header"><div className="ww-utility"><div className="ts-wrap"><span>Custom crew apparel & safety gear</span><button type="button" onClick={() => navigate("/")}>Telecom catalog</button><button type="button" onClick={() => navigate("/login")}>Admin</button></div></div><div className="ww-main ts-wrap">
    <a className="ww-brand" href="/" onClick={(event) => { event.preventDefault(); navigate("/"); }}><span>TS</span><strong>Telecom Store<small>WORKWEAR & SAFETY</small></strong></a>
    <form role="search" onSubmit={submitSearch}><Search size={19} /><input aria-label="Search custom workwear" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search shirts, hard hats, jackets, safety vests..." />{query ? <button type="button" aria-label="Clear search" onClick={() => setQuery("")}><X size={17} /></button> : null}<button type="submit">Search</button></form>
    <button className="ww-quote" type="button" onClick={onOpenQuote}><ShoppingBag size={19} /> Quote List <b>{quoteCount}</b></button>
  </div></header>;
}

function WorkwearNav({ subcategory, setSubcategory, navigate }) {
  return <nav className="ww-nav" aria-label="Custom workwear departments"><div className="ts-wrap"><button className={subcategory === "All" ? "on" : ""} type="button" onClick={() => setSubcategory("All")}>All Custom Workwear</button>{WORKWEAR_SUBCATEGORIES.map((item) => <button className={subcategory === item ? "on" : ""} type="button" key={item} onClick={() => setSubcategory(item)}>{item}</button>)}<button type="button" onClick={() => navigate("/shop")}>Marketplace</button></div></nav>;
}

function WorkwearDepartment({ products, query, navigate }) {
  return <main className="ww-department"><section className="ww-dept-banner"><div className="ts-wrap"><div><span>LOGO-READY GEAR FOR WORKING CREWS</span><h1>Custom Workwear & Safety Gear</h1><p>Choose your garment, colors, sizes, and logo placement. We review artwork and confirm the fully configured price before production.</p><div><a href="#workwear-products">Shop products</a><b>Volume discounts available.</b></div></div><div className="ww-feature-stack">{WORKWEAR_PRODUCTS.slice(0, 3).map((product) => <button key={product.sku} type="button" onClick={() => navigate(workwearProductPath(product))}><img src={product.image} alt="" /><span>{product.name}<b>{startingPriceLabel(product)}</b></span></button>)}</div></div></section>
    <section className="ww-benefits"><div className="ts-wrap"><div><ShieldCheck /><span><b>Artwork reviewed</b><small>Before production begins</small></span></div><div><FileImage /><span><b>Your company logo</b><small>Kept private and secure</small></span></div><div><ShoppingBag /><span><b>Crew-size ordering</b><small>Sizes and quantities by item</small></span></div><div><Lock /><span><b>Price confirmed</b><small>No guessed customization fees</small></span></div></div></section>
    <section className="ww-products ts-wrap" id="workwear-products"><div className="ww-section-head"><div><span>SHOP THE DEPARTMENT</span><h2>{query ? `Results for “${query}”` : "Popular custom products"}</h2></div><b>{products.length} products</b></div>{products.length ? <div className="ww-grid">{products.map((product) => <WorkwearCard key={product.sku} product={product} navigate={navigate} />)}</div> : <div className="ww-no-results"><h2>No custom products match that search.</h2><button type="button" onClick={() => navigate("/custom-workwear")}>View all custom workwear</button></div>}</section>
  </main>;
}

function WorkwearCard({ product, navigate, compact = false }) {
  const path = workwearProductPath(product);
  return <article className={`ww-card${compact ? " compact" : ""}`}><a href={path} onClick={(event) => { event.preventDefault(); navigate(path); }}><div className="ww-card-image"><img src={product.image} alt={product.image_alt || `${product.name} in available colors with generic YOUR LOGO placement`} loading={compact ? "eager" : "lazy"} /></div><div className="ww-card-body"><small>{product.collection}</small><h2>{product.name}</h2><strong>{startingPriceLabel(product)}</strong>{compact ? null : <><p>{product.description}</p><div className="ww-swatches" aria-label={`Colors: ${product.colors.join(", ")}`}>{product.colors.map((color) => <i key={color} title={color} style={{ "--swatch": swatchColor(color) }} />)}</div></>}<span className="ww-view">View options <ChevronRight size={17} /></span></div></a></article>;
}

function WorkwearProductDetail({ product, navigate, onAddQuote }) {
  const customizable = product.customizable !== false;
  const placements = product.logo_placements || LOGO_PLACEMENTS;
  const methods = product.customization_methods || CUSTOMIZATION_METHODS;
  const initial = { color: product.colors[0] || "", size: product.sizes[0] || "", style: product.styles[0] || "", quantity: 1, logo_placement: customizable ? placements[0] : "Front Design", customization_method: customizable ? methods[0] : "Printed Design", company_name: "", customer_notes: "", artwork_reference: "", artwork_filename: "" };
  const [config, setConfig] = useState(initial);
  const [uploadState, setUploadState] = useState({ kind: "idle", message: "" });
  const set = (name, value) => setConfig((current) => ({ ...current, [name]: value }));

  async function uploadArtwork(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadState({ kind: "checking", message: "Checking artwork…" });
    const validation = await validateArtworkFile(file);
    if (!validation.ok) { setUploadState({ kind: "error", message: validation.error }); event.target.value = ""; return; }
    setUploadState({ kind: "uploading", message: "Uploading securely…" });
    try {
      const body = new FormData(); body.append("artwork", file);
      const response = await fetch("/api/workwear-artwork", { method: "POST", body });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) throw new Error(result?.error || "Artwork upload is temporarily unavailable.");
      setConfig((current) => ({ ...current, artwork_reference: result.artwork_reference, artwork_filename: file.name }));
      setUploadState({ kind: "success", message: `${file.name} uploaded securely.` });
    } catch (error) {
      setUploadState({ kind: "error", message: error.message });
    }
  }

  function addConfiguredQuote() {
    onAddQuote(workwearQuoteItem(product, config));
  }

  return <main className="ww-detail"><div className="ts-wrap"><button className="ww-back" type="button" onClick={() => navigate("/custom-workwear")}>← Custom Workwear & Safety Gear</button><div className="ww-detail-grid"><div className="ww-detail-media"><img src={product.image} alt={product.image_alt || `${product.name} with generic YOUR LOGO placement`} /><div><ShieldCheck size={18} /><span>{customizable ? "Original Telecom Store-generated product mockup." : "Customer-supplied product artwork."} Final product details are confirmed before production.</span></div></div><section className="ww-config"><p>{product.collection}</p><h1>{product.name}</h1><strong className="ww-starting">{startingPriceLabel(product)}</strong><p>{product.description}</p><p className="ww-price-note">{Number(product.base_price) > 0 ? "Base price represents the least-expensive qualifying configuration. " : "No customer-facing price has been approved yet. "}Selected garment, size, color, and style may cost more.{customizable ? " Logo placement and customization may also affect the final price." : ""}</p>
    <OptionButtons label="Color" values={product.colors} selected={config.color} onSelect={(value) => set("color", value)} swatches />
    {product.sizes.length ? <OptionButtons label="Size" values={product.sizes} selected={config.size} onSelect={(value) => set("size", value)} /> : null}
    {product.styles.length > 1 ? <OptionButtons label="Style" values={product.styles} selected={config.style} onSelect={(value) => set("style", value)} /> : null}
    {customizable ? <><OptionButtons label="Logo Placement" values={placements} selected={config.logo_placement} onSelect={(value) => set("logo_placement", value)} /><OptionButtons label="Customization Method" values={methods} selected={config.customization_method} onSelect={(value) => set("customization_method", value)} /></> : null}
    <div className="ww-fields"><label><span>Quantity</span><input type="number" min="1" max="10000" value={config.quantity} onChange={(event) => set("quantity", Math.max(1, Number(event.target.value) || 1))} /></label>{customizable ? <label><span>Company Name</span><input value={config.company_name} maxLength="120" onChange={(event) => set("company_name", event.target.value)} placeholder="Your company name" /></label> : null}</div>
    {customizable ? <label className="ww-upload"><span><Upload size={20} /><b>Upload Company Logo</b></span><small>Upload your company logo and we&apos;ll customize this item for your crew.</small><input type="file" accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml" onChange={uploadArtwork} /><em>PNG, JPG/JPEG, or safe SVG · 4 MB maximum · private storage</em>{uploadState.message ? <b className={uploadState.kind}>{uploadState.message}</b> : null}</label> : null}
    <label className="ww-notes"><span>Order Notes</span><textarea rows="3" maxLength="1000" value={config.customer_notes} onChange={(event) => set("customer_notes", event.target.value)} placeholder="Crew sizes, job timing, artwork instructions, or product questions" /></label>
    <div className="ww-config-price"><span>Configured Price</span><strong>Request Quote</strong><small>Unapproved option upcharges are never guessed. We&apos;ll confirm the exact configuration before payment.</small></div>
    <button className="ww-primary" type="button" onClick={addConfiguredQuote}>Add selected item to Quote List</button>{customizable ? <p className="ww-art-review">Artwork subject to review before production.</p> : null}<p className="ww-volume">Volume discounts available.</p><p className="ww-safety">{product.safety_note}</p>
  </section></div></div></main>;
}

function OptionButtons({ label, values, selected, onSelect, swatches = false }) {
  return <fieldset className="ww-options"><legend>{label}: <b>{selected}</b></legend><div>{values.map((value) => <button className={selected === value ? "on" : ""} type="button" key={value} onClick={() => onSelect(value)}>{swatches ? <i style={{ "--swatch": swatchColor(value) }} /> : null}{value}</button>)}</div></fieldset>;
}

function WorkwearFooter({ navigate }) {
  return <footer className="ww-footer"><div className="ts-wrap"><div><strong>Telecom Store</strong><span>Custom Workwear & Safety Gear</span></div><nav><button type="button" onClick={() => navigate("/custom-workwear")}>Custom workwear</button><button type="button" onClick={() => navigate("/")}>Telecom catalog</button><button type="button" onClick={() => navigate("/shop")}>Marketplace</button></nav><p>Artwork, final configuration, availability, shipping, tax, and selling price are confirmed before payment.</p></div></footer>;
}

function swatchColor(value) {
  return ({ Gray: "#777b80", Black: "#181a1c", White: "#fff", Navy: "#172a4d", Charcoal: "#41464b", Khaki: "#b7a27e", Olive: "#66704a", Brown: "#684b3a", Yellow: "#f2d21b", "Safety Yellow": "#e9f40b", "Safety Yellow/Lime": "#d8ef12", "Safety Orange": "#ff6a00" })[value] || "#ccd2d5";
}

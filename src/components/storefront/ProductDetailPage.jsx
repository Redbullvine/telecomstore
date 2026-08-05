import React, { useState } from "react";
import { ChevronRight } from "lucide-react";
import ProductPlaceholder from "./ProductPlaceholder.jsx";
import { categoryConfig, manufacturerConfig } from "../../config/catalog.mjs";
import { categoryPath, manufacturerPath, productPath } from "../../lib/storefront-catalog.mjs";

function RouteLink({ href, navigate, children }) {
  return <a href={href} onClick={(event) => { event.preventDefault(); navigate(href); }}>{children}</a>;
}

export default function ProductDetailPage({ product, related, navigate, added, onAdd, onAsk }) {
  const [quantity, setQuantity] = useState(1);
  const category = categoryConfig(product.category);
  const manufacturer = manufacturerConfig(product.brand);
  const fixedPrice = product.price_mode === "fixed" && product.pricing_approved === true && Number(product.public_price) > 0;
  const specifications = Object.entries(product.specifications || {});
  return (
    <div className="ts-detail-page">
      <div className="ts-wrap">
        <nav className="ts-breadcrumbs" aria-label="Breadcrumb">
          <RouteLink href="/" navigate={navigate}>Home</RouteLink><ChevronRight size={14} />
          <RouteLink href={categoryPath(category)} navigate={navigate}>{category.name}</RouteLink><ChevronRight size={14} />
          <span aria-current="page">{product.manufacturer_mpn}</span>
        </nav>
        <section className="ts-product-detail">
          <div><ProductPlaceholder product={product} large /></div>
          <div className="ts-product-copy">
            <RouteLink href={manufacturerPath(manufacturer)} navigate={navigate}>{product.brand}</RouteLink>
            <h1>{product.title}</h1>
            <p className="ts-detail-lead">{product.long_description}</p>
            <dl className="ts-detail-identity">
              <div><dt>Manufacturer MPN</dt><dd>{product.manufacturer_mpn}</dd></div>
              <div><dt>GTIN / UPC</dt><dd>{product.gtin}</dd></div>
              <div><dt>Category</dt><dd><RouteLink href={categoryPath(category)} navigate={navigate}>{product.category}</RouteLink></dd></div>
              <div><dt>Availability</dt><dd>{product.availability_text}</dd></div>
            </dl>
            <div className="ts-detail-price">
              <strong>{fixedPrice ? `$${Number(product.public_price).toFixed(2)}` : "Request quote"}</strong>
              <span>{fixedPrice ? "Approved public price. Checkout is not yet available; shipping, destination, and tax must be confirmed." : "Pricing, availability, and shipping are confirmed before payment."}</span>
            </div>
            <div className="ts-detail-actions">
              <label><span>Quantity</span><input type="number" min="1" max="99999" value={quantity} onChange={(event) => setQuantity(Math.max(1, Number.parseInt(event.target.value, 10) || 1))} /></label>
              <button className="ts-btn-pri" type="button" onClick={() => onAdd(quantity)}>{added ? "Update Quote List" : "Add to Quote"}</button>
              <button className="ts-btn-ghost" type="button" onClick={onAsk}>Ask about this item</button>
            </div>
          </div>
        </section>

        <section className="ts-detail-info">
          <div><p className="ts-eyebrow">Product details</p><h2>Verified catalog identity</h2><p>{product.short_description}</p><p>Compatibility, specifications beyond those shown, condition, current quantity, and fulfillment details are confirmed during quote review.</p></div>
          <div><h2>Specifications</h2><dl>{specifications.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></div>
        </section>

        {related.length ? <section className="ts-related"><p className="ts-eyebrow">Keep exploring</p><h2>Related catalog products</h2><div>{related.map((item) => <RouteLink key={item.sku} href={productPath(item)} navigate={navigate}><span>{item.brand}</span><strong>{item.title}</strong><small>MPN {item.manufacturer_mpn}</small></RouteLink>)}</div></section> : null}
      </div>
    </div>
  );
}

import React from "react";
import { storefrontBadgeLabel } from "../../lib/storefront-product.mjs";
import { isPurchasable } from "../../lib/commerce.mjs";
import { productPath } from "../../lib/storefront-catalog.mjs";
import ProductPlaceholder from "./ProductPlaceholder.jsx";

export default function ProductCard({ product, added, onNavigate, onAdd, onAsk }) {
  const fixedPrice = product.price_mode === "fixed" && product.pricing_approved === true && Number(product.public_price) > 0;
  return (
    <article className="ts-card">
      <a className="ts-card-link" href={productPath(product)} onClick={(event) => { event.preventDefault(); onNavigate(product); }} aria-label={`View ${product.title}`}>
        <div className="ts-thumb-wrap">
          <span className="ts-cond">{storefrontBadgeLabel(product)}</span>
          <ProductPlaceholder product={product} />
        </div>
      </a>
      <div className="ts-cbody">
        <p className="ts-cbrand">{product.brand}</p>
        <h3 className="ts-cname"><a href={productPath(product)} title={product.title} onClick={(event) => { event.preventDefault(); onNavigate(product); }}>{product.title}</a></h3>
        <dl className="ts-card-identity">
          <div><dt>MPN</dt><dd>{product.manufacturer_mpn}</dd></div>
          <div><dt>GTIN</dt><dd>{product.gtin}</dd></div>
        </dl>
        <div className="ts-card-status">
          <span>{product.availability_text || "Availability by quote"}</span>
          <strong>{fixedPrice ? `$${Number(product.public_price).toFixed(2)}` : "Request a quote"}</strong>
        </div>
        {fixedPrice && !isPurchasable(product) ? <p className="ts-checkout-note">Approved price; checkout is not yet available.</p> : null}
        <div className="ts-cact">
          <a className="ts-det" href={productPath(product)} onClick={(event) => { event.preventDefault(); onNavigate(product); }}>View details <span aria-hidden="true">→</span></a>
          <div className="ts-card-secondary">
            <button className={added ? "ts-add in" : "ts-add"} type="button" onClick={onAdd}>{added ? "In quote list" : "Add to quote"}</button>
            <button className="ts-ask" type="button" onClick={onAsk}>Ask a question</button>
          </div>
        </div>
      </div>
    </article>
  );
}

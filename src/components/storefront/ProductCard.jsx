import React, { useState } from "react";
import { storefrontBadgeLabel } from "../../lib/storefront-product.mjs";
import { isPurchasable } from "../../lib/commerce.mjs";
import { productPath } from "../../lib/storefront-catalog.mjs";
import ProductPlaceholder from "./ProductPlaceholder.jsx";

export default function ProductCard({ product, added, onNavigate, onAdd, onAsk }) {
  const [quantity, setQuantity] = useState(1);
  const listedPrice = ["fixed", "listed_price_shipping_quote"].includes(product.price_mode) && product.pricing_approved === true && Number(product.public_price) > 0;
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
          <strong>{listedPrice ? `Merchandise price · $${Number(product.public_price).toFixed(2)}` : "Request a quote"}</strong>
        </div>
        {listedPrice && !isPurchasable(product) ? <p className="ts-checkout-note">Request Shipping Quote. Tax and shipping are confirmed before payment.</p> : null}
        <div className="ts-cact">
          <a className="ts-det" href={productPath(product)} onClick={(event) => { event.preventDefault(); onNavigate(product); }}>View details <span aria-hidden="true">→</span></a>
          <label className="ts-card-quantity"><span>Quantity</span><input aria-label={`Quantity for ${product.manufacturer_mpn}`} type="number" min="1" max="99999" value={quantity} onChange={(event) => setQuantity(Math.max(1, Number.parseInt(event.target.value, 10) || 1))} /></label>
          <div className="ts-card-secondary">
            <button className={added ? "ts-add in" : "ts-add"} type="button" onClick={() => onAdd(quantity)}>{added ? "Update quote list" : "Add to quote"}</button>
            <button className="ts-ask" type="button" onClick={onAsk}>Ask a question</button>
          </div>
        </div>
      </div>
    </article>
  );
}

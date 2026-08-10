import React, { useState } from "react";
import { categoryConfig } from "../../config/catalog.mjs";
import { storefrontImageAlt, storefrontImageSource } from "../../lib/storefront-product.mjs";

export function CategoryIcon({ category, size = 54 }) {
  const color = categoryConfig(category).color;
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };
  const paths = {
    "Network Cabling & Connectors": <><path d="M5 7h6v10H5zM13 9h6v6h-6z" /><path d="M11 12h2M7 4v3m2-3v3m6 8v3m2-3v3" /></>,
    "Network Equipment": <><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M6 10h7M6 14h4" /><circle cx="17" cy="10" r="1" /><circle cx="17" cy="14" r="1" /></>,
    "Telephone Equipment": <path d="M7 3h4l2 5-3 2c1 2 2 3 4 4l2-3 5 2v4c0 2-2 4-4 4C9 20 4 15 3 7c0-2 2-4 4-4z" />,
    "Antennas & RF": <><path d="M12 14v7M8 21h8M12 14a2 2 0 100-4 2 2 0 000 4z" /><path d="M7 7a7 7 0 000 10M17 7a7 7 0 010 10M4 4a11 11 0 000 16M20 4a11 11 0 010 16" opacity=".55" /></>,
    "Terminals, Jacks & Wall Plates": <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6v7H9zM10 18h4" /></>,
    "Telecom Tools": <path d="M14 7a3 3 0 00-4 4l-6 6 2 2 6-6a3 3 0 004-4l-2 2-2-2z" />,
    "Cable Management": <><path d="M7 5a7 7 0 100 14h10a4 4 0 000-8H9a2 2 0 100 4h7" /><path d="M7 5h5" /></>,
    // General Merchandise Shop departments.
    "General Merchandise Shop": <><path d="M4 7h16l-1.4 12.2a2 2 0 01-2 1.8H7.4a2 2 0 01-2-1.8z" /><path d="M9 7V5a3 3 0 016 0v2" /></>,
    "Electronics": <><rect x="3" y="5" width="18" height="12" rx="2" /><path d="M8 21h8M12 17v4" /><path d="M7 9h5" opacity=".55" /></>,
    "Home & Kitchen": <><path d="M4 11l8-6 8 6" /><path d="M6 11v9h12v-9" /><path d="M10 20v-5h4v5" opacity=".6" /></>,
    "Tools & Home Improvement": <><path d="M14 7a3 3 0 00-4 4l-6 6 2 2 6-6a3 3 0 004-4l-2 2-2-2z" /><path d="M16 14l4 4-2 2-4-4" opacity=".6" /></>,
    "Automotive & Marine": <><path d="M3 14l2-5a2 2 0 012-1.3h10A2 2 0 0119 9l2 5" /><path d="M3 14h18v4H3z" /><circle cx="7.5" cy="18.5" r="1.4" /><circle cx="16.5" cy="18.5" r="1.4" /></>,
    "Outdoor & Fitness": <><path d="M4 12h2M18 12h2" /><rect x="6" y="8.5" width="2.6" height="7" rx="1" /><rect x="15.4" y="8.5" width="2.6" height="7" rx="1" /><path d="M8.6 12h6.8" /></>,
    "Health & Beauty": <><path d="M12 20s-7-4.4-7-9.4A4 4 0 0112 8a4 4 0 017 2.6c0 5-7 9.4-7 9.4z" /></>,
    "Appliance Parts": <><circle cx="12" cy="12" r="3.2" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2" /></>,
    "Deals": <><path d="M20.5 12.5l-8 8a2 2 0 01-2.8 0l-6.2-6.2a2 2 0 01-.6-1.4V5a1 1 0 011-1h7.9a2 2 0 011.4.6l7.3 7.3a1 1 0 010 1.4z" /><circle cx="8" cy="8" r="1.3" /></>
  };
  // "General Merchandise" is the short label used in some navigation contexts.
  paths["General Merchandise"] = paths["General Merchandise Shop"];
  return <svg {...common}>{paths[category] || <rect x="4" y="5" width="16" height="14" rx="2" />}</svg>;
}

export default function ProductPlaceholder({ product, large = false }) {
  const [failed, setFailed] = useState(false);
  const src = storefrontImageSource(product);
  const config = categoryConfig(product.category);
  if (src && !failed) {
    return <div className={`ts-product-visual${large ? " is-large" : ""}`}><img src={src} alt={storefrontImageAlt(product)} loading={large ? "eager" : "lazy"} decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} /></div>;
  }
  const label = `Catalog placeholder for ${product.brand || "manufacturer"} ${product.manufacturer_mpn || product.sku} in ${product.category}; product image pending approval.`;
  const initials = String(product.brand || "TS").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  return (
    <div className={`ts-product-visual ts-product-placeholder${large ? " is-large" : ""}`} role="img" aria-label={label} style={{ "--cat-color": config.color }}>
      <span className="ts-placeholder-mark">{initials}</span>
      <span className="ts-placeholder-icon"><CategoryIcon category={product.category} size={large ? 86 : 54} /></span>
      <span className="ts-placeholder-copy"><strong>{product.brand}</strong><small>{product.manufacturer_mpn || product.sku}</small></span>
      <span className="ts-placeholder-caption">Image pending</span>
    </div>
  );
}

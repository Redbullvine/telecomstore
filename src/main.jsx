import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ClipboardList,
  Eye,
  ListFilter,
  Mail,
  PackageCheck,
  Phone,
  Search,
  ShieldCheck,
  Truck,
  Warehouse,
  X
} from "lucide-react";
import products from "./data/products.json";
import "./styles.css";

const CATEGORIES = ["All", ...Array.from(new Set(products.map((product) => product.category)))];

const INITIAL_QUOTE_FORM = {
  name: "",
  company: "",
  email: "",
  phone: "",
  sku: "",
  quantity: "",
  projectLocation: "",
  needBy: "",
  notes: ""
};

function buildMailto(subject, bodyLines) {
  return `mailto:sales@telecomstore.net?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyLines.join("\n"))}`;
}

function ProductImage({ product, large = false }) {
  const [imageFailed, setImageFailed] = useState(false);
  const imageSrc = product.images?.find(Boolean);
  const showImage = imageSrc && !imageFailed;

  return (
    <div className={large ? "product-image product-image-large" : "product-image"}>
      {showImage ? (
        <img
          src={imageSrc}
          alt={`${product.brand} ${product.title}`}
          loading={large ? "eager" : "lazy"}
          onError={() => setImageFailed(true)}
        />
      ) : null}
      <span className="image-placeholder" aria-hidden={showImage ? "true" : undefined}>
        {product.brand}
        <br />
        {product.sku}
      </span>
    </div>
  );
}

function App() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [quoteForm, setQuoteForm] = useState(INITIAL_QUOTE_FORM);

  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase();

    return products.filter((product) => {
      const matchesCategory = category === "All" || product.category === category;
      const haystack = [
        product.sku,
        product.brand,
        product.title,
        product.category,
        product.condition,
        product.quantityAvailable,
        product.pairCapacity,
        product.shortDescription,
        ...(product.details || [])
      ]
        .join(" ")
        .toLowerCase();

      return matchesCategory && (!q || haystack.includes(q));
    });
  }, [query, category]);

  const generalQuoteLink = buildMailto("Telecom Store quote request", [
    "Please send pricing and availability for:",
    "",
    "SKU or product:",
    "Quantity needed:",
    "Project location:",
    "Need-by date:"
  ]);

  function updateQuoteField(event) {
    const { name, value } = event.target;
    setQuoteForm((current) => ({ ...current, [name]: value }));
  }

  function startQuote(product) {
    setQuoteForm((current) => ({
      ...current,
      sku: product.sku,
      notes: current.notes || `${product.brand} ${product.title}`
    }));
    setSelectedProduct(null);
    window.requestAnimationFrame(() => {
      document.getElementById("quote")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function submitQuote(event) {
    event.preventDefault();

    const subject = quoteForm.sku
      ? `Telecom Store quote request: ${quoteForm.sku}`
      : "Telecom Store quote request";

    const mailto = buildMailto(subject, [
      "Please send pricing and availability for:",
      "",
      `SKU or product: ${quoteForm.sku}`,
      `Quantity needed: ${quoteForm.quantity}`,
      "",
      `Name: ${quoteForm.name}`,
      `Company: ${quoteForm.company}`,
      `Email: ${quoteForm.email}`,
      `Phone: ${quoteForm.phone}`,
      `Project location: ${quoteForm.projectLocation}`,
      `Need-by date: ${quoteForm.needBy}`,
      "",
      "Notes:",
      quoteForm.notes
    ]);

    window.location.href = mailto;
  }

  return (
    <main>
      <section className="hero">
        <nav className="nav">
          <a className="brand" href="#top" aria-label="Telecom Store home">
            <span className="brand-mark">TS</span>
            <span>Telecom Store</span>
          </a>
          <div className="nav-links">
            <a href="#inventory">Inventory</a>
            <a href="#how-it-works">Intake</a>
            <a href="#quote">Request quote</a>
          </div>
        </nav>

        <div className="hero-grid" id="top">
          <div>
            <p className="eyebrow">Warehouse-stock telecom material</p>
            <h1>SKU-first telecom material sourcing for field crews.</h1>
            <p className="hero-copy">
              Browse copper, fiber, closures, modules, terminals, and jobsite materials from warehouse inventory.
              Search by SKU, brand, category, or label note, then request a quote for verified pricing and quantity.
            </p>
            <div className="hero-actions">
              <a className="button primary" href="#inventory">
                <Search size={18} />
                Browse inventory
              </a>
              <a className="button secondary" href={generalQuoteLink}>
                <Mail size={18} />
                Request a quote
              </a>
            </div>
          </div>

          <div className="hero-card">
            <Warehouse size={42} />
            <h2>Warehouse-ready catalog intake</h2>
            <p>Organize product photos, box labels, counts, SKUs, and categories into a contractor-grade storefront.</p>
            <div className="stat-row">
              <span><strong>OSP</strong> material</span>
              <span><strong>Copper</strong> splicing</span>
              <span><strong>Fiber</strong> stock</span>
            </div>
          </div>
        </div>
      </section>

      <section className="trust-strip">
        <div><PackageCheck /> New surplus / warehouse stock</div>
        <div><ShieldCheck /> SKU-first verification</div>
        <div><Truck /> Contractor quote flow</div>
      </section>

      <section className="section" id="inventory">
        <div className="section-heading">
          <p className="eyebrow">Inventory</p>
          <h2>Search telecom materials</h2>
          <p>Sample listings are placeholders and should be replaced with real warehouse photos and verified counts.</p>
        </div>

        <div className="filters">
          <label className="search-box">
            <Search size={18} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search SKU, 3M, Corning, closure, module..."
            />
          </label>

          <label className="category-box">
            <ListFilter size={18} />
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              {CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        </div>

        {filteredProducts.length > 0 ? (
          <div className="product-grid">
            {filteredProducts.map((product) => (
              <article className="product-card" key={product.id}>
                <ProductImage product={product} />
                <div className="product-body">
                  <p className="sku">{product.sku}</p>
                  <h3>{product.title}</h3>
                  <p className="muted">{product.shortDescription}</p>
                  <dl>
                    <div><dt>Brand</dt><dd>{product.brand}</dd></div>
                    <div><dt>Category</dt><dd>{product.category}</dd></div>
                    <div><dt>Listed count</dt><dd>{product.quantityAvailable || "Verify"}</dd></div>
                    <div><dt>Capacity</dt><dd>{product.pairCapacity || "Verify from label"}</dd></div>
                  </dl>
                  <div className="product-actions">
                    <button className="button secondary small" type="button" onClick={() => setSelectedProduct(product)}>
                      <Eye size={16} />
                      View details
                    </button>
                    <button className="button primary small" type="button" onClick={() => startQuote(product)}>
                      <Mail size={16} />
                      Request quote
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-state">No matching products. Try another SKU, brand, or category.</p>
        )}
      </section>

      <section className="section split" id="how-it-works">
        <div>
          <p className="eyebrow">Inventory intake</p>
          <h2>Turn warehouse photos into quote-ready listings.</h2>
        </div>
        <div className="steps">
          <div><strong>1.</strong> Photograph the full box or pallet, label, and quantity.</div>
          <div><strong>2.</strong> Name files by SKU using the photo naming guide.</div>
          <div><strong>3.</strong> Add rows to the intake CSV, then convert them into products.json.</div>
          <div><strong>4.</strong> Verify SKU, brand, count, condition, and compatibility notes before publishing.</div>
        </div>
      </section>

      <section className="section quote-section" id="quote">
        <div>
          <p className="eyebrow">Request quote</p>
          <h2>Request verified pricing and quantity.</h2>
          <p>
            Send the SKU, quantity, project location, and need-by date so Telecom Store can confirm availability,
            compatibility, and freight details before quoting.
          </p>
          <div className="contact-card">
            <a href="mailto:sales@telecomstore.net"><Mail /> sales@telecomstore.net</a>
            <a href="tel:+16065854423"><Phone /> Call for availability</a>
          </div>
        </div>

        <form className="quote-form" onSubmit={submitQuote}>
          <div className="form-heading">
            <ClipboardList size={24} />
            <h3>Quote request</h3>
          </div>

          <div className="field-grid">
            <label>
              <span>Name</span>
              <input name="name" value={quoteForm.name} onChange={updateQuoteField} autoComplete="name" />
            </label>
            <label>
              <span>Company</span>
              <input name="company" value={quoteForm.company} onChange={updateQuoteField} autoComplete="organization" />
            </label>
            <label>
              <span>Email</span>
              <input name="email" type="email" value={quoteForm.email} onChange={updateQuoteField} autoComplete="email" />
            </label>
            <label>
              <span>Phone</span>
              <input name="phone" type="tel" value={quoteForm.phone} onChange={updateQuoteField} autoComplete="tel" />
            </label>
            <label>
              <span>SKU or product</span>
              <input name="sku" value={quoteForm.sku} onChange={updateQuoteField} required />
            </label>
            <label>
              <span>Quantity needed</span>
              <input name="quantity" value={quoteForm.quantity} onChange={updateQuoteField} required />
            </label>
            <label>
              <span>Project location</span>
              <input name="projectLocation" value={quoteForm.projectLocation} onChange={updateQuoteField} />
            </label>
            <label>
              <span>Need-by date</span>
              <input name="needBy" type="date" value={quoteForm.needBy} onChange={updateQuoteField} />
            </label>
          </div>

          <label>
            <span>Notes</span>
            <textarea name="notes" value={quoteForm.notes} onChange={updateQuoteField} rows="4" />
          </label>

          <button className="button primary form-submit" type="submit">
            <Mail size={18} />
            Create email request
          </button>
        </form>
      </section>

      {selectedProduct ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setSelectedProduct(null)}>
          <section
            className="product-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="icon-button close-button"
              type="button"
              aria-label="Close product details"
              onClick={() => setSelectedProduct(null)}
            >
              <X size={22} />
            </button>

            <ProductImage product={selectedProduct} large />

            <div className="modal-copy">
              <p className="sku">{selectedProduct.sku}</p>
              <h2 id="product-modal-title">{selectedProduct.title}</h2>
              <p className="muted">{selectedProduct.shortDescription}</p>

              <dl className="spec-list">
                <div><dt>Brand</dt><dd>{selectedProduct.brand}</dd></div>
                <div><dt>Category</dt><dd>{selectedProduct.category}</dd></div>
                <div><dt>Condition</dt><dd>{selectedProduct.condition}</dd></div>
                <div><dt>Listed count</dt><dd>{selectedProduct.quantityAvailable || "Verify"}</dd></div>
                <div><dt>Unit</dt><dd>{selectedProduct.unit || "Verify"}</dd></div>
                <div><dt>Capacity</dt><dd>{selectedProduct.pairCapacity || "Verify from label"}</dd></div>
                <div><dt>Status</dt><dd>{selectedProduct.status === "quote" ? "Request quote" : selectedProduct.status}</dd></div>
              </dl>

              <div className="detail-list">
                {(selectedProduct.details || []).map((detail) => <p key={detail}>{detail}</p>)}
              </div>

              <button className="button primary modal-cta" type="button" onClick={() => startQuote(selectedProduct)}>
                <Mail size={18} />
                Request quote for {selectedProduct.sku}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);

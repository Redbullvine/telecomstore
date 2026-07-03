import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Archive,
  BarChart3,
  Boxes,
  Camera,
  CheckCircle2,
  ClipboardList,
  Copy,
  Edit3,
  Eye,
  FileSpreadsheet,
  Filter,
  Home,
  ImageUp,
  Layers3,
  ListChecks,
  Loader2,
  Lock,
  LogOut,
  Mail,
  MapPin,
  PackagePlus,
  PackageSearch,
  PauseCircle,
  Plus,
  QrCode,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  Upload,
  Warehouse,
  X
} from "lucide-react";
import {
  EMPTY_PRODUCT,
  IMAGE_TYPES,
  IMPORT_COLUMNS,
  PRODUCT_STATUSES,
  addProductImages,
  assignPhotoSlots,
  createCategory,
  createStorageLocation,
  deleteCategory,
  deleteStorageLocation,
  duplicateProduct,
  fetchActivity,
  fetchAdminProducts,
  fetchCategories,
  fetchProductById,
  fetchPublicProducts,
  fetchStorageLocations,
  filterProducts,
  findProductByScan,
  getProductCategories,
  hardDeleteProduct,
  importProducts,
  logActivity,
  normalizeProduct,
  saveProduct,
  updateProductStatus,
  uploadIntakeImage,
  uploadProductImage
} from "./lib/inventory";
import { detectBarcodeFromImage } from "./lib/barcode";
import { applyColumnMapping, autoMapColumns, findDuplicateRows, parseInventoryFile } from "./lib/importers";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
import "./styles.css";

const ADMIN_ROLES = ["admin", "inventory"];
const QUOTE_FORM = {
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

function App() {
  const route = useRoute();
  const auth = useAuth();

  if (route.path === "/login") {
    return <LoginPage auth={auth} navigate={route.navigate} />;
  }

  if (route.path.startsWith("/admin")) {
    return <ProtectedAdmin route={route} auth={auth} />;
  }

  return (
    <>
      <AmbientCursor />
      <PublicStorefront navigate={route.navigate} />
    </>
  );
}

function useRoute() {
  const [location, setLocation] = useState(() => ({
    path: window.location.pathname,
    search: window.location.search
  }));

  useEffect(() => {
    const handlePop = () => setLocation({ path: window.location.pathname, search: window.location.search });
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, []);

  const navigate = useCallback((to) => {
    window.history.pushState({}, "", to);
    setLocation({ path: window.location.pathname, search: window.location.search });
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  return {
    ...location,
    params: new URLSearchParams(location.search),
    navigate
  };
}

function useAuth() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);

  const loadProfile = useCallback(async (user) => {
    if (!isSupabaseConfigured || !user) {
      setProfile(null);
      return null;
    }

    const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();

    if (error) throw error;

    const resolvedProfile =
      data ||
      {
        id: user.id,
        email: user.email,
        full_name: user.user_metadata?.full_name || "",
        role: "viewer",
        approved: false
      };

    setProfile(resolvedProfile);
    return resolvedProfile;
  }, []);

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return null;
    }

    setLoading(true);
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;

    setSession(data.session);
    const resolvedProfile = data.session?.user ? await loadProfile(data.session.user) : null;
    setLoading(false);
    return resolvedProfile;
  }, [loadProfile]);

  useEffect(() => {
    let mounted = true;

    refresh().catch((error) => {
      if (mounted) {
        console.error(error);
        setLoading(false);
      }
    });

    if (!isSupabaseConfigured) return undefined;

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession?.user) {
        loadProfile(nextSession.user).catch(console.error);
      } else {
        setProfile(null);
      }
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, [loadProfile, refresh]);

  const signOut = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
  }, []);

  return { session, profile, loading, refresh, signOut };
}

function useScrollReveal(deps) {
  useEffect(() => {
    const els = document.querySelectorAll('.reveal:not(.visible)');
    if (!els.length) return;
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      }),
      { threshold: 0.08, rootMargin: '0px 0px -32px 0px' }
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

function AmbientCursor() {
  const haloRef = useRef(null);
  const targetRef = useRef({ x: -80, y: -80 });
  const currentRef = useRef({ x: -80, y: -80 });
  const rafRef = useRef(null);

  useEffect(() => {
    const finePointer = window.matchMedia("(pointer: fine)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    if (!finePointer.matches || reducedMotion.matches) return undefined;

    const move = ({ clientX: x, clientY: y }) => {
      targetRef.current = { x, y };
    };

    const over = ({ target }) => {
      const isInteractive = target instanceof Element && Boolean(target.closest("button, a, input, select, textarea, label, [role='button']"));
      haloRef.current?.classList.toggle("cursor-halo-active", isInteractive);
    };

    const tick = () => {
      const current = currentRef.current;
      const target = targetRef.current;
      current.x += (target.x - current.x) * 0.16;
      current.y += (target.y - current.y) * 0.16;

      if (haloRef.current) {
        haloRef.current.style.transform = `translate3d(${current.x}px, ${current.y}px, 0) translate(-50%, -50%)`;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    window.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerover", over);
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("pointermove", move);
      document.removeEventListener("pointerover", over);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return <div ref={haloRef} className="cursor-halo" aria-hidden="true" />;
}

const STORE_CAT_META = {
  "Fiber": "#0d5e9c",
  "Closures": "#7a4ed6",
  "Terminals": "#147d4a",
  "Copper Splicing": "#b86e11",
  "Cable Hardware": "#5b6472",
  "Pedestals / Cabinets": "#0f766e",
  "Tools": "#c4470f",
  "Test Equipment": "#9c2bad",
  "Misc Telecom Material": "#74807a"
};
const STORE_CAT_ORDER = ["Fiber", "Closures", "Terminals", "Copper Splicing", "Cable Hardware", "Pedestals / Cabinets", "Tools", "Test Equipment", "Misc Telecom Material"];

function catColor(cat) { return STORE_CAT_META[cat] || "#74807a"; }
function hexToRgba(hex, a) {
  const n = (hex || "#74807a").replace("#", "");
  const r = parseInt(n.substr(0, 2), 16), g = parseInt(n.substr(2, 2), 16), b = parseInt(n.substr(4, 2), 16);
  return `rgba(${r},${g},${b},${a})`;
}
function CatGlyph({ category, size = 54 }) {
  const col = catColor(category);
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: col, strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" };
  const paths = {
    "Fiber": <><path d="M3 12c4-6 14 6 18 0" /><path d="M3 17c4-6 14 6 18 0" opacity=".5" /></>,
    "Closures": <><rect x="5" y="3" width="14" height="18" rx="7" /><path d="M5 12h14" /></>,
    "Terminals": <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M9 4v16M15 4v16M4 9h16M4 15h16" opacity=".55" /></>,
    "Copper Splicing": <><path d="M4 12h6M14 12h6" /><circle cx="12" cy="12" r="3" /><path d="M12 4v3M12 17v3" opacity=".5" /></>,
    "Cable Hardware": <><path d="M8 8a4 4 0 010 8h-1M16 16a4 4 0 010-8h1" /><path d="M9 12h6" /></>,
    "Pedestals / Cabinets": <><rect x="6" y="3" width="12" height="18" rx="1.5" /><path d="M9 7h6M9 11h6" opacity=".5" /><circle cx="15" cy="15" r="1" /></>,
    "Tools": <path d="M14 7a3 3 0 00-4 4l-6 6 2 2 6-6a3 3 0 004-4l-2 2-2-2z" />,
    "Test Equipment": <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 15l3-5 2 3 2-4 3 6" opacity=".7" /></>
  };
  return <svg {...common}>{paths[category] || <><rect x="4" y="5" width="16" height="14" rx="1.5" /><path d="M4 9h16" opacity=".5" /></>}</svg>;
}

function StoreImage({ product, large = false }) {
  const [failed, setFailed] = useState(false);
  const src = product.photo_main || product.photo_label || product.photo_extra_1 || product.photo_extra_2;
  if (src && !failed) {
    return <div className="ts-thumb"><img src={src} alt={`${product.brand} ${product.title}`} loading={large ? "eager" : "lazy"} onError={() => setFailed(true)} /></div>;
  }
  return (
    <div className="ts-thumb">
      <div className="ts-glyph" style={{ background: `linear-gradient(140deg, ${hexToRgba(catColor(product.category), 0.06)}, ${hexToRgba(catColor(product.category), 0.13)})` }}>
        <CatGlyph category={product.category} size={large ? 72 : 54} />
        <span className="ts-gb">{product.brand || ""}</span>
      </div>
    </div>
  );
}

function priceLabel(product) {
  if (product.price) return `$${Number(product.price).toLocaleString()}`;
  return product.price_note || "Request quote";
}

function PublicStorefront({ navigate }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [sort, setSort] = useState("brand");
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [cart, setCart] = useState([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [quoteForm, setQuoteForm] = useState(QUOTE_FORM);

  useEffect(() => {
    fetchPublicProducts().then(setProducts).finally(() => setLoading(false));
  }, []);

  const cats = useMemo(() => getProductCategories(products), [products]);
  const orderedCats = useMemo(() => {
    const present = new Set(cats);
    const ordered = STORE_CAT_ORDER.filter((c) => present.has(c));
    cats.forEach((c) => { if (!ordered.includes(c)) ordered.push(c); });
    return ordered;
  }, [cats]);
  const counts = useMemo(() => {
    const map = { All: products.length };
    products.forEach((p) => { map[p.category] = (map[p.category] || 0) + 1; });
    return map;
  }, [products]);

  const filtered = useMemo(() => {
    let list = filterProducts(products, { query, category, status: "available" });
    list = [...list].sort((a, b) => {
      if (sort === "qtyd") return (b.quantity_available || 0) - (a.quantity_available || 0);
      if (sort === "name") return (a.short_description || a.title || "").localeCompare(b.short_description || b.title || "");
      return `${a.brand}${a.sku}`.localeCompare(`${b.brand}${b.sku}`);
    });
    return list;
  }, [products, query, category, sort]);

  const inCart = useCallback((sku) => cart.find((i) => i.sku === sku), [cart]);

  function addToCart(product, qty = 1) {
    setCart((cur) => {
      const existing = cur.find((i) => i.sku === product.sku);
      if (existing) return cur.map((i) => i.sku === product.sku ? { ...i, qty } : i);
      return [...cur, { sku: product.sku || product.barcode, brand: product.brand, title: product.short_description || product.title, category: product.category, qty }];
    });
  }
  function removeFromCart(sku) { setCart((cur) => cur.filter((i) => i.sku !== sku)); }
  function openDrawer() { setDrawerOpen(true); }

  function selectCategory(cat) {
    setCategory(cat);
    window.requestAnimationFrame(() => document.getElementById("catalog")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function submitQuote(event) {
    event.preventDefault();
    const lines = ["Please send pricing and availability for the following parts:", ""];
    cart.forEach((i) => lines.push(`- ${i.qty} x  ${i.brand || ""} ${i.sku}  (${i.title || ""})`));
    lines.push("", `Name: ${quoteForm.name}`, `Company: ${quoteForm.company}`, `Email: ${quoteForm.email}`, `Phone: ${quoteForm.phone}`, `Project location: ${quoteForm.projectLocation}`, `Need-by date: ${quoteForm.needBy}`, "", "Notes:", quoteForm.notes);
    window.location.href = buildMailto(`Telecom Store quote request (${cart.length} part${cart.length === 1 ? "" : "s"})`, lines);
  }

  return (
    <main className="storefront">
      <div className="ts-ubar">
        <div className="ts-wrap">
          <nav className="ts-ulinks">
            <a href="/" onClick={(e) => { e.preventDefault(); selectCategory("All"); }}>Home</a>
            <a href="#catalog">Catalog</a>
            <a href="#" onClick={(e) => { e.preventDefault(); openDrawer(); }}>Request a Quote</a>
            <a href="#contact">Contact</a>
          </nav>
          <div className="ts-ubadges">
            <span><ShieldCheck size={13} /> New Surplus Stock</span>
            <span><QrCode size={13} /> Fast SKU Quotes</span>
            <span><ClipboardList size={13} /> Genuine OSP Brands</span>
          </div>
        </div>
      </div>

      <header className="ts-head">
        <div className="ts-wrap">
          <a className="ts-brand" href="/" onClick={(e) => { e.preventDefault(); selectCategory("All"); }}>
            <span className="ts-mark">TS</span>
            <span className="ts-brandtxt"><strong>Telecom Store</strong><small>New Surplus Telecom Materials</small></span>
          </a>
          <form className="ts-search" onSubmit={(e) => { e.preventDefault(); document.getElementById("catalog")?.scrollIntoView({ behavior: "smooth" }); }}>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by part number, brand, or keyword&hellip;" />
            <button type="submit"><Search size={16} /> Search</button>
          </form>
          <button className="ts-quotebtn" type="button" onClick={openDrawer}>
            <ShoppingBag size={17} /> Quote <span className="ts-cnt">{cart.length}</span>
          </button>
          <button className="ts-adminbtn" type="button" onClick={() => navigate("/login")} title="Warehouse Admin">
            <Lock size={14} /> Admin
          </button>
        </div>
      </header>

      <nav className="ts-catnav">
        <div className="ts-wrap">
          <button className={category === "All" ? "on" : ""} onClick={() => selectCategory("All")}>All Products <span>{counts.All || 0}</span></button>
          {orderedCats.map((c) => (
            <button key={c} className={category === c ? "on" : ""} onClick={() => selectCategory(c)}>{c} <span>{counts[c] || 0}</span></button>
          ))}
        </div>
      </nav>

      <section className="ts-hero">
        <div className="ts-wrap ts-hero-grid">
          <div>
            <p className="ts-eyebrow">Outside Plant &bull; Copper &bull; Fiber</p>
            <h1>Warehouse-stock telecom materials,<br /><em>priced by the SKU.</em></h1>
            <p className="ts-herocopy">New surplus closures, terminals, splice cases, strand hardware, and fiber components from the brands field crews trust. Find your part number and request a quote in minutes.</p>
            <div className="ts-herocta">
              <a className="ts-btn-pri" href="#catalog">Browse the catalog</a>
              <button className="ts-btn-ghost" type="button" onClick={openDrawer}>Request a quote</button>
            </div>
          </div>
          <div className="ts-herostats">
            <div className="ts-hstat"><strong>{products.length}</strong><span>available SKUs,<br />ready to quote</span></div>
            <div className="ts-hstat"><strong>{orderedCats.length}</strong><span>material categories<br />in stock</span></div>
          </div>
        </div>
      </section>

      <section className="ts-trust">
        <div className="ts-wrap">
          <div className="ts-titem"><span className="ts-tic"><Boxes size={19} /></span><div><b>New Surplus</b><small>Unused warehouse stock</small></div></div>
          <div className="ts-titem"><span className="ts-tic"><Mail size={19} /></span><div><b>Same-day quotes</b><small>Reply by SKU or photo</small></div></div>
          <div className="ts-titem"><span className="ts-tic"><ShieldCheck size={19} /></span><div><b>Genuine brands</b><small>3M, Corning, PLP, Tyco</small></div></div>
          <div className="ts-titem"><span className="ts-tic"><PackageSearch size={19} /></span><div><b>Nationwide shipping</b><small>Pallet &amp; freight ready</small></div></div>
        </div>
      </section>

      <section className="ts-catalog" id="catalog">
        <div className="ts-wrap">
          <div className="ts-cathead">
            <div>
              <h2>{category === "All" ? "All Products" : category}</h2>
              <p><strong>{filtered.length}</strong> items &nbsp;&bull;&nbsp; request a quote on any part</p>
            </div>
            <select className="ts-sort" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="brand">Sort: Brand A&ndash;Z</option>
              <option value="name">Sort: Name A&ndash;Z</option>
              <option value="qtyd">Sort: Qty (high &rarr; low)</option>
            </select>
          </div>

          {loading ? <LoadingState label="Loading inventory" /> : null}
          {!loading && filtered.length === 0 ? (
            <div className="ts-empty"><b>No parts match that search.</b>Try a part number, a brand like 3M or Corning, or browse a category above.</div>
          ) : null}

          <div className="ts-grid">
            {filtered.map((product) => (
              <StoreProductCard key={product.id || product.sku} product={product} added={Boolean(inCart(product.sku))}
                onDetails={() => setSelectedProduct(product)} onAdd={() => { addToCart(product, 1); }} />
            ))}
          </div>
        </div>
      </section>

      <footer className="ts-foot" id="contact">
        <div className="ts-wrap ts-foot-grid">
          <div>
            <div className="ts-fbrand">Telecom Store</div>
            <p>New surplus, warehouse-stock telecom materials for outside plant, copper, and fiber networks.</p>
            <p>Quotes: <a href="mailto:sales@telecomstore.net">sales@telecomstore.net</a></p>
          </div>
          <div>
            <h5>Shop</h5>
            {orderedCats.map((c) => <a key={c} href="#catalog" onClick={(e) => { e.preventDefault(); selectCategory(c); }}>{c}</a>)}
          </div>
          <div>
            <h5>Service</h5>
            <a href="#" onClick={(e) => { e.preventDefault(); openDrawer(); }}>Request a Quote</a>
            <a href="mailto:sales@telecomstore.net">Contact Us</a>
            <a href="/login" onClick={(e) => handleNavClick(e, navigate, "/login")}>Admin Login</a>
          </div>
          <p className="ts-legal">Telecom Store is operated by <strong>Fatanett, LLC</strong>. Inventory is new surplus / warehouse stock; quantities limited and sold as-is per quote. Brand names are the property of their respective owners.</p>
        </div>
      </footer>

      {selectedProduct ? (
        <StoreProductModal product={selectedProduct} added={Boolean(inCart(selectedProduct.sku))}
          onClose={() => setSelectedProduct(null)}
          onAdd={(qty) => { addToCart(selectedProduct, qty); setSelectedProduct(null); openDrawer(); }} />
      ) : null}

      <QuoteTray open={drawerOpen} cart={cart} onClose={() => setDrawerOpen(false)} onRemove={removeFromCart}
        quoteForm={quoteForm} setQuoteForm={setQuoteForm} onSubmit={submitQuote} clearCart={() => setCart([])} />
    </main>
  );
}

function StoreProductCard({ product, added, onDetails, onAdd }) {
  return (
    <article className="ts-card">
      <div className="ts-thumb-wrap">
        <span className="ts-cond">New Surplus</span>
        <StoreImage product={product} />
      </div>
      <div className="ts-cbody">
        <p className="ts-cbrand">{product.brand || "Telecom Store"}</p>
        <h3 className="ts-cname">{product.short_description || product.title}</h3>
        <p className="ts-csku">{product.sku || product.barcode}</p>
        <p className="ts-cqty">Qty available: <b>{product.quantity_available || "—"}</b> &nbsp;&bull;&nbsp; {priceLabel(product)}</p>
        <div className="ts-cact">
          <button className={added ? "ts-add in" : "ts-add"} type="button" onClick={onAdd}>{added ? "Added \u2713" : "Add to Quote"}</button>
          <button className="ts-det" type="button" onClick={onDetails}>Details</button>
        </div>
      </div>
    </article>
  );
}

function StoreProductModal({ product, added, onClose, onAdd }) {
  const [qty, setQty] = useState(1);
  return (
    <div className="ts-backdrop" role="presentation" onClick={onClose}>
      <section className="ts-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="ts-mimg">
          <button className="ts-mclose" type="button" aria-label="Close" onClick={onClose}><X size={19} /></button>
          <StoreImage product={product} large />
        </div>
        <div className="ts-mbody">
          <p className="ts-cbrand">{product.brand || "Telecom Store"}</p>
          <h2>{product.short_description || product.title}</h2>
          <div className="ts-kv"><span>Part No.</span><b className="ts-mono">{product.sku || product.barcode}</b></div>
          <div className="ts-kv"><span>Category</span><b>{product.category || "Uncategorized"}</b></div>
          <div className="ts-kv"><span>Condition</span><b style={{ color: "#147d4a" }}>{product.condition || "New Surplus"}</b></div>
          <div className="ts-kv"><span>Available</span><b>{product.quantity_available || "Verify"}</b></div>
          <div className="ts-kv"><span>Price</span><b>{priceLabel(product)}</b></div>
          <p className="ts-mdesc">{product.long_description || product.title}</p>
          <div className="ts-qrow">
            <div className="ts-stepper">
              <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))}>&minus;</button>
              <input value={qty} onChange={(e) => setQty(Math.max(1, parseInt(e.target.value) || 1))} />
              <button type="button" onClick={() => setQty((q) => q + 1)}>+</button>
            </div>
            <span className="ts-quotenote">Pricing provided by quote</span>
          </div>
          <button className="ts-addbtn" type="button" onClick={() => onAdd(qty)}>{added ? "Update Quote Request" : "Add to Quote Request"}</button>
        </div>
      </section>
    </div>
  );
}

function QuoteTray({ open, cart, onClose, onRemove, quoteForm, setQuoteForm, onSubmit, clearCart }) {
  const [stage, setStage] = useState("list");
  useEffect(() => { if (open) setStage("list"); }, [open]);
  function updateField(e) { const { name, value } = e.target; setQuoteForm((cur) => ({ ...cur, [name]: value })); }

  return (
    <>
      <div className={open ? "ts-scrim on" : "ts-scrim"} onClick={onClose} />
      <aside className={open ? "ts-drawer on" : "ts-drawer"}>
        <div className="ts-dhead"><h4>Quote Request</h4><button type="button" onClick={onClose}><X size={20} /></button></div>

        {cart.length === 0 ? (
          <div className="ts-dempty">Your quote request is empty.<br /><br />Add parts from the catalog and send them over — we’ll reply with pricing and availability.</div>
        ) : stage === "list" ? (
          <>
            <div className="ts-ditems">
              {cart.map((i) => (
                <div className="ts-qitem" key={i.sku}>
                  <span className="ts-qg" style={{ background: hexToRgba(catColor(i.category), 0.1) }}><CatGlyph category={i.category} size={24} /></span>
                  <div className="ts-qn"><b>{i.title}</b><span className="ts-mono">{i.sku}</span></div>
                  <span className="ts-qq">x{i.qty}</span>
                  <button className="ts-rm" type="button" onClick={() => onRemove(i.sku)}>Remove</button>
                </div>
              ))}
            </div>
            <div className="ts-dfoot">
              <p className="ts-dnote">No payment is taken here. Send your list and we’ll reply with pricing, availability, and freight.</p>
              <button className="ts-req" type="button" onClick={() => setStage("form")}>Continue ({cart.length})</button>
            </div>
          </>
        ) : (
          <form className="ts-dform" onSubmit={onSubmit}>
            <p className="ts-formcount">{cart.length} part{cart.length === 1 ? "" : "s"} on this request.</p>
            <label>Name</label><input name="name" value={quoteForm.name} onChange={updateField} autoComplete="name" />
            <label>Company</label><input name="company" value={quoteForm.company} onChange={updateField} autoComplete="organization" />
            <label>Email</label><input name="email" type="email" value={quoteForm.email} onChange={updateField} autoComplete="email" />
            <label>Phone</label><input name="phone" type="tel" value={quoteForm.phone} onChange={updateField} autoComplete="tel" />
            <label>Project location</label><input name="projectLocation" value={quoteForm.projectLocation} onChange={updateField} />
            <label>Notes</label><textarea name="notes" rows="3" value={quoteForm.notes} onChange={updateField} />
            <button className="ts-req" type="submit"><Mail size={16} /> Send Quote Request</button>
            <button className="ts-back" type="button" onClick={() => setStage("list")}>&larr; Back to list</button>
          </form>
        )}
      </aside>
    </>
  );
}


function LoginPage({ auth, navigate }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ email: "", password: "", fullName: "" });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const canEnterAdmin = Boolean(auth.profile?.approved && ADMIN_ROLES.includes(auth.profile?.role));

  useEffect(() => {
    if (canEnterAdmin) navigate("/admin");
  }, [canEnterAdmin, navigate]);

  async function submit(event) {
    event.preventDefault();
    if (!isSupabaseConfigured) return;

    setBusy(true);
    setMessage("");

    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email: form.email,
          password: form.password,
          options: { data: { full_name: form.fullName } }
        });
        if (error) throw error;
        setMessage("Access request created. Ask an admin to approve your profile.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: form.email, password: form.password });
        if (error) throw error;
        const profile = await auth.refresh();
        if (!profile?.approved || !ADMIN_ROLES.includes(profile.role)) {
          setMessage("Access pending approval.");
        }
      }
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  if (!isSupabaseConfigured) {
    return (
      <CenteredPanel icon={<Lock size={32} />} title="Supabase not configured">
        <p>Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Netlify and local `.env` before admin login can work.</p>
        <button className="button secondary" type="button" onClick={() => navigate("/")}>Back to storefront</button>
      </CenteredPanel>
    );
  }

  if (auth.session && !canEnterAdmin) {
    return (
      <CenteredPanel icon={<ShieldAlert size={32} />} title="Access pending approval">
        <p>Your account exists, but an admin must set `approved = true` and role `admin` or `inventory` in the `profiles` table.</p>
        <button className="button secondary" type="button" onClick={auth.signOut}><LogOut size={18} /> Sign out</button>
      </CenteredPanel>
    );
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <a className="brand auth-brand" href="/" onClick={(event) => handleNavClick(event, navigate, "/")}>
          <span className="brand-mark">TS</span>
          <span>Telecom Store</span>
        </a>
        <h1>{mode === "login" ? "Admin login" : "Request access"}</h1>
        <p>Approved admin and inventory users can manage warehouse material.</p>

        <div className="segmented">
          <button className={mode === "login" ? "active" : ""} type="button" onClick={() => setMode("login")}>Login</button>
          <button className={mode === "signup" ? "active" : ""} type="button" onClick={() => setMode("signup")}>Request access</button>
        </div>

        <form className="stack-form" onSubmit={submit}>
          {mode === "signup" ? (
            <TextField label="Full name" name="fullName" value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} />
          ) : null}
          <TextField label="Email" name="email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required />
          <TextField label="Password" name="password" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required />
          {message ? <p className="notice">{message}</p> : null}
          <button className="button primary" type="submit" disabled={busy}>{busy ? <Loader2 className="spin" size={18} /> : <Lock size={18} />} {mode === "login" ? "Log in" : "Create access request"}</button>
        </form>
      </section>
    </main>
  );
}

function ProtectedAdmin({ route, auth }) {
  if (!isSupabaseConfigured) {
    return (
      <CenteredPanel icon={<Lock size={32} />} title="Supabase required">
        <p>The private warehouse app needs Supabase Auth, database, and storage configured.</p>
        <button className="button secondary" type="button" onClick={() => route.navigate("/")}>Back to storefront</button>
      </CenteredPanel>
    );
  }

  if (auth.loading) return <LoadingState label="Checking access" fullPage />;

  const allowed = Boolean(auth.session && auth.profile?.approved && ADMIN_ROLES.includes(auth.profile?.role));
  if (!auth.session) {
    return <Navigate to="/login" navigate={route.navigate} />;
  }

  if (!allowed) {
    return (
      <CenteredPanel icon={<ShieldAlert size={32} />} title="Access pending approval">
        <p>Your profile needs approval and an `admin` or `inventory` role before you can use the warehouse system.</p>
        <button className="button secondary" type="button" onClick={auth.signOut}><LogOut size={18} /> Sign out</button>
      </CenteredPanel>
    );
  }

  return <AdminApp route={route} auth={auth} />;
}

function AdminApp({ route, auth }) {
  const [products, setProducts] = useState([]);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadAdminData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextProducts, nextActivity] = await Promise.all([fetchAdminProducts(), fetchActivity(50)]);
      setProducts(nextProducts);
      setActivity(nextActivity);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAdminData();
  }, [loadAdminData]);

  const commonProps = { route, auth, products, activity, reload: loadAdminData, loading };
  let page = <DashboardPage {...commonProps} />;

  if (route.path === "/admin/inventory") page = <InventoryPage {...commonProps} />;
  if (route.path === "/admin/inventory/new") page = <ProductFormPage {...commonProps} mode="new" />;
  if (route.path.match(/^\/admin\/inventory\/[^/]+\/edit$/)) page = <ProductFormPage {...commonProps} mode="edit" />;
  if (route.path === "/admin/photo-intake") page = <PhotoIntakePage {...commonProps} />;
  if (route.path === "/admin/scan") page = <ScanPage {...commonProps} />;
  if (route.path === "/admin/import") page = <ImportPage {...commonProps} />;
  if (route.path === "/admin/categories") page = <CategoriesPage {...commonProps} />;
  if (route.path === "/admin/locations") page = <StorageLocationsPage {...commonProps} />;
  if (route.path === "/admin/activity") page = <ActivityLogPage {...commonProps} />;

  return (
    <main className="admin-shell">
      <aside className="sidebar">
        <a className="brand sidebar-brand" href="/" onClick={(event) => handleNavClick(event, route.navigate, "/")}>
          <span className="brand-mark">TS</span>
          <span>Telecom Store</span>
        </a>
        <SidebarLink icon={<BarChart3 size={18} />} label="Dashboard" to="/admin" route={route} />
        <SidebarLink icon={<Boxes size={18} />} label="Inventory" to="/admin/inventory" route={route} />
        <SidebarLink icon={<PackagePlus size={18} />} label="Add Item" to="/admin/inventory/new" route={route} />
        <SidebarLink icon={<Camera size={18} />} label="Photo Intake" to="/admin/photo-intake" route={route} />
        <SidebarLink icon={<QrCode size={18} />} label="Scan Item" to="/admin/scan" route={route} />
        <SidebarLink icon={<FileSpreadsheet size={18} />} label="Bulk Import" to="/admin/import" route={route} />
        <SidebarLink icon={<Layers3 size={18} />} label="Categories" to="/admin/categories" route={route} />
        <SidebarLink icon={<MapPin size={18} />} label="Storage Locations" to="/admin/locations" route={route} />
        <SidebarLink icon={<ListChecks size={18} />} label="Activity Log" to="/admin/activity" route={route} />
      </aside>
      <section className="admin-main">
        <header className="admin-header">
          <div>
            <p className="eyebrow">Warehouse inventory system</p>
            <h1>{adminTitle(route.path)}</h1>
          </div>
          <div className="user-chip">
            <span>{auth.profile?.email || auth.session?.user?.email}</span>
            <strong>{auth.profile?.role}</strong>
            <button className="icon-button" type="button" aria-label="Sign out" onClick={auth.signOut}><LogOut size={18} /></button>
          </div>
        </header>
        {error ? <p className="error-banner">{error}</p> : null}
        {page}
      </section>
    </main>
  );
}

function SidebarLink({ icon, label, to, route }) {
  const active = route.path === to || (to !== "/admin" && route.path.startsWith(to));
  return (
    <a className={active ? "sidebar-link active" : "sidebar-link"} href={to} onClick={(event) => handleNavClick(event, route.navigate, to)}>
      {icon}
      <span>{label}</span>
    </a>
  );
}

function DashboardPage({ products, activity, loading, route }) {
  const counts = countByStatus(products);
  const cards = [
    { label: "Inventory count", value: products.length, icon: <Boxes />, to: "/admin/inventory" },
    { label: "Available", value: counts.available, icon: <CheckCircle2 />, to: "/admin/inventory?status=available" },
    { label: "Hold", value: counts.hold, icon: <PauseCircle />, to: "/admin/inventory?status=hold" },
    { label: "Sold", value: counts.sold, icon: <ShoppingBag />, to: "/admin/inventory?status=sold" },
    { label: "Draft", value: counts.draft, icon: <ClipboardList />, to: "/admin/inventory?status=draft" }
  ];

  if (loading) return <LoadingState label="Loading dashboard" />;

  return (
    <div className="admin-page">
      <div className="dashboard-grid">
        {cards.map((card) => (
          <button className="metric-card" type="button" key={card.label} onClick={() => route.navigate(card.to)}>
            {React.cloneElement(card.icon, { size: 24 })}
            <span>{card.label}</span>
            <strong>{card.value}</strong>
          </button>
        ))}
      </div>
      <section
        className="admin-panel intake-cta clickable"
        role="button"
        tabIndex={0}
        onClick={() => route.navigate("/admin/photo-intake")}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") route.navigate("/admin/photo-intake"); }}
      >
        <div>
          <h2>Add Inventory From Photos</h2>
          <p>Snap label, barcode, or item photos from your phone and save a draft in seconds - no typing required.</p>
        </div>
        <button className="button primary big" type="button" onClick={(event) => { event.stopPropagation(); route.navigate("/admin/photo-intake"); }}>
          <Camera size={20} /> Add Inventory From Photos
        </button>
      </section>
      <section className="admin-panel">
        <div className="panel-heading">
          <h2>Recent inventory activity</h2>
        </div>
        <ActivityList activity={activity.slice(0, 8)} />
      </section>
    </div>
  );
}

function InventoryPage({ products, route, auth, reload, loading }) {
  const statusParam = route.params.get("status");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [status, setStatus] = useState(PRODUCT_STATUSES.includes(statusParam) ? statusParam : "All");
  const [busyId, setBusyId] = useState("");

  const categories = useMemo(() => ["All", ...getProductCategories(products)], [products]);
  const filtered = useMemo(() => filterProducts(products, { query, category, status }), [products, query, category, status]);
  const isAdmin = auth.profile?.role === "admin";

  async function runAction(product, action) {
    setBusyId(product.id);
    try {
      await action();
      await reload();
    } finally {
      setBusyId("");
    }
  }

  if (loading) return <LoadingState label="Loading inventory" />;

  return (
    <div className="admin-page">
      <div className="panel-toolbar">
        <div className="filter-bar compact">
          <label className="search-box"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search SKU, barcode, brand, title..." /></label>
          <label className="select-box"><Filter size={18} /><select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="select-box"><ListChecks size={18} /><select value={status} onChange={(event) => setStatus(event.target.value)}><option>All</option>{PRODUCT_STATUSES.map((item) => <option key={item}>{item}</option>)}</select></label>
        </div>
        <button className="button primary" type="button" onClick={() => route.navigate("/admin/inventory/new")}><Plus size={18} /> Add item</button>
      </div>

      <div className="table-wrap">
        <table className="inventory-table">
          <thead>
            <tr>
              <th>Photo</th>
              <th>SKU / Barcode</th>
              <th>Title</th>
              <th>Category</th>
              <th>Status</th>
              <th>Qty</th>
              <th>Location</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((product) => {
              const thumb = product.photo_main || product.photo_label || product.photo_extra_1 || product.photo_extra_2;
              return (
              <tr key={product.id}>
                <td>{thumb ? <img className="inv-thumb" src={thumb} alt="" loading="lazy" /> : <span className="inv-thumb-empty"><ImageUp size={16} /></span>}</td>
                <td><strong>{product.sku || "No SKU"}</strong><span>{product.barcode || "No barcode"}</span></td>
                <td>{product.title}<span>{product.brand}</span></td>
                <td>{product.category || "Uncategorized"}</td>
                <td><StatusBadge status={product.status} /></td>
                <td>{product.quantity_available || "0"} {product.unit}</td>
                <td>{formatLocation(product) || "Not set"}</td>
                <td>
                  <div className="row-actions">
                    <button className="icon-button" type="button" title="Edit item" onClick={() => route.navigate(`/admin/inventory/${product.id}/edit`)}><Edit3 size={16} /></button>
                    <button className="icon-button" type="button" title="Duplicate item" onClick={() => runAction(product, () => duplicateProduct(product, auth.session.user.id))}><Copy size={16} /></button>
                    <button className="text-action" type="button" disabled={busyId === product.id} onClick={() => runAction(product, () => updateProductStatus(product, "available", auth.session.user.id))}>Available</button>
                    <button className="text-action" type="button" disabled={busyId === product.id} onClick={() => runAction(product, () => updateProductStatus(product, "hold", auth.session.user.id))}>Hold</button>
                    <button className="text-action" type="button" disabled={busyId === product.id} onClick={() => runAction(product, () => updateProductStatus(product, "sold", auth.session.user.id))}>Sold</button>
                    <button className="icon-button" type="button" title="Archive item" onClick={() => runAction(product, () => updateProductStatus(product, "archived", auth.session.user.id))}><Archive size={16} /></button>
                    {isAdmin ? (
                      <button
                        className="icon-button danger"
                        type="button"
                        title="Hard delete"
                        onClick={() => {
                          if (window.confirm("Hard delete this product? Prefer archive unless this record is truly wrong.")) {
                            runAction(product, () => hardDeleteProduct(product.id));
                          }
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProductFormPage({ route, auth, reload, mode }) {
  const productId = mode === "edit" ? route.path.split("/")[3] : null;
  const scanValue = route.params.get("scan") || "";
  const duplicateWarning = route.params.get("duplicate") === "1";
  const createdFromScan = route.params.get("created") === "1";
  const [form, setForm] = useState(() => ({
    ...EMPTY_PRODUCT,
    sku: scanValue,
    barcode: scanValue
  }));
  const [files, setFiles] = useState({});
  const [previews, setPreviews] = useState({});
  const [loading, setLoading] = useState(mode === "edit");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [showIntake, setShowIntake] = useState(false);

  const handleBarcodeDetected = useCallback((value) => {
    setForm((current) => (current.barcode ? current : { ...current, barcode: value }));
    setMessage(`Barcode detected: ${value}. Review or edit it before saving.`);
  }, []);

  const intake = useIntakePhotos({ onBarcodeDetected: handleBarcodeDetected });

  useEffect(() => {
    if (mode !== "edit") return;

    setLoading(true);
    fetchProductById(productId)
      .then((product) => setForm(product))
      .catch((error) => setMessage(error.message))
      .finally(() => setLoading(false));
  }, [mode, productId]);

  useEffect(() => {
    return () => Object.values(previews).forEach((url) => URL.revokeObjectURL(url));
  }, [previews]);

  function updateField(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  function updateFile(field, file) {
    setFiles((current) => ({ ...current, [field]: file }));
    if (file) {
      setPreviews((current) => ({ ...current, [field]: URL.createObjectURL(file) }));
    }
  }

  async function submit(nextStatus) {
    setSaving(true);
    setMessage("");

    try {
      let payload = { ...form, status: nextStatus || form.status };

      for (const field of ["photo_main", "photo_label", "photo_extra_1", "photo_extra_2"]) {
        if (files[field]) {
          payload[field] = await uploadProductImage(files[field], payload, field);
        }
      }

      const uploadedIntake = await uploadIntakePhotos(intake.photos, payload.sku || payload.barcode || "add-item");
      payload = assignPhotoSlots(payload, uploadedIntake);

      const saved = await saveProduct(payload, auth.session.user.id);
      if (uploadedIntake.length) {
        await addProductImages(saved.id, uploadedIntake, auth.session.user.id);
        intake.resetPhotos();
      }
      await reload();
      setMessage("Item saved.");
      route.navigate(`/admin/inventory/${saved.id}/edit`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingState label="Loading item" />;

  return (
    <div className="admin-page">
      {duplicateWarning ? <p className="warning-banner">Duplicate found. This is the existing item for the scanned SKU or barcode.</p> : null}
      {createdFromScan ? <p className="notice">New draft created from scan. Add photos and complete the product details.</p> : null}
      {message ? <p className={message.includes("saved") ? "notice" : "error-banner"}>{message}</p> : null}

      <section className="admin-panel">
        <div className="panel-heading">
          <h2>{mode === "edit" ? "Edit inventory item" : "Add inventory item"}</h2>
          <StatusBadge status={form.status} />
        </div>

        <div className="form-grid">
          <TextField label="SKU / part number" name="sku" value={form.sku} onChange={updateField} />
          <TextField label="Barcode / UPC / label number" name="barcode" value={form.barcode} onChange={updateField} />
          <TextField label="Brand" name="brand" value={form.brand} onChange={updateField} />
          <TextField label="Title" name="title" value={form.title} onChange={updateField} required />
          <TextField label="Category" name="category" value={form.category} onChange={updateField} />
          <TextField label="Condition" name="condition" value={form.condition} onChange={updateField} />
          <TextField label="Quantity available" name="quantity_available" type="number" value={form.quantity_available} onChange={updateField} />
          <TextField label="Unit" name="unit" value={form.unit} onChange={updateField} />
          <TextField label="Price" name="price" type="number" value={form.price} onChange={updateField} />
          <TextField label="Price note" name="price_note" value={form.price_note} onChange={updateField} />
          <TextField label="Warehouse location" name="warehouse_location" value={form.warehouse_location} onChange={updateField} />
          <TextField label="Aisle" name="aisle" value={form.aisle} onChange={updateField} />
          <TextField label="Rack" name="rack" value={form.rack} onChange={updateField} />
          <TextField label="Shelf" name="shelf" value={form.shelf} onChange={updateField} />
          <TextField label="Pallet" name="pallet" value={form.pallet} onChange={updateField} />
          {mode === "edit" ? (
            <label>
              <span>Status</span>
              <select name="status" value={form.status} onChange={updateField}>
                {PRODUCT_STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
          ) : null}
        </div>

        <label className="full-field">
          <span>Short description</span>
          <textarea name="short_description" value={form.short_description} onChange={updateField} rows="3" />
        </label>
        <label className="full-field">
          <span>Long description</span>
          <textarea name="long_description" value={form.long_description} onChange={updateField} rows="6" />
        </label>
        <label className="full-field">
          <span>Label text / notes</span>
          <textarea name="label_text" value={form.label_text} onChange={updateField} rows="3" placeholder="Type or paste text from the label here..." />
        </label>

        <div className="intake-section">
          <button className="button secondary intake-btn" type="button" onClick={() => setShowIntake((current) => !current)}>
            <Camera size={18} /> Add photos / scan label {showIntake ? <X size={16} /> : null}
          </button>
          {showIntake ? <IntakePhotoBoard intake={intake} disabled={saving} /> : null}
          {showIntake && intake.detectMessage ? <p className="warning-banner">{intake.detectMessage}</p> : null}
        </div>

        <div className="photo-grid">
          <PhotoField label="Main photo" field="photo_main" form={form} preview={previews.photo_main} onFile={updateFile} />
          <PhotoField label="Label photo" field="photo_label" form={form} preview={previews.photo_label} onFile={updateFile} />
          <PhotoField label="Extra photo 1" field="photo_extra_1" form={form} preview={previews.photo_extra_1} onFile={updateFile} />
          <PhotoField label="Extra photo 2" field="photo_extra_2" form={form} preview={previews.photo_extra_2} onFile={updateFile} />
        </div>

        <div className="form-actions">
          <button className="button secondary" type="button" onClick={() => route.navigate("/admin/inventory")}>Cancel</button>
          {mode === "edit" ? (
            <>
              <button className="button secondary" type="button" disabled={saving} onClick={() => submit("draft")}><ClipboardList size={18} /> Save draft</button>
              <button className="button primary" type="button" disabled={saving} onClick={() => submit("available")}><CheckCircle2 size={18} /> Publish available</button>
            </>
          ) : (
            <button className="button primary" type="button" disabled={saving} onClick={() => submit("draft")}><ClipboardList size={18} /> Save Item (draft)</button>
          )}
        </div>
      </section>
    </div>
  );
}

function PhotoField({ label, field, form, preview, onFile }) {
  const image = preview || form[field];

  return (
    <label className="photo-field">
      <span>{label}</span>
      <div className="photo-preview">
        {image ? <img src={image} alt={label} /> : <ImageUp size={30} />}
      </div>
      <input type="file" accept="image/*" onChange={(event) => onFile(field, event.target.files?.[0])} />
    </label>
  );
}

let intakePhotoKey = 0;

function useIntakePhotos({ onBarcodeDetected } = {}) {
  const [photos, setPhotos] = useState([]);
  const [detectMessage, setDetectMessage] = useState("");
  const photosRef = useRef([]);

  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  useEffect(() => {
    return () => photosRef.current.forEach((photo) => URL.revokeObjectURL(photo.url));
  }, []);

  const addPhotos = useCallback(
    async (files, type) => {
      const next = files.map((file) => ({
        key: `intake-${++intakePhotoKey}`,
        file,
        url: URL.createObjectURL(file),
        type,
        detecting: true
      }));
      setPhotos((current) => [...current, ...next]);

      let found = "";
      for (const photo of next) {
        const value = found ? null : await detectBarcodeFromImage(photo.file);
        setPhotos((current) => current.map((item) => (item.key === photo.key ? { ...item, detecting: false } : item)));
        if (value && !found) {
          found = value;
          onBarcodeDetected?.(value);
        }
      }

      if (found) {
        setDetectMessage("");
      } else if (type === "label_barcode") {
        setDetectMessage("No barcode detected. You can type it manually or save as draft.");
      }
    },
    [onBarcodeDetected]
  );

  const retagPhoto = useCallback((key, type) => {
    setPhotos((current) => current.map((photo) => (photo.key === key ? { ...photo, type } : photo)));
  }, []);

  const removePhoto = useCallback((key) => {
    setPhotos((current) => {
      const target = current.find((photo) => photo.key === key);
      if (target) URL.revokeObjectURL(target.url);
      return current.filter((photo) => photo.key !== key);
    });
  }, []);

  const resetPhotos = useCallback(() => {
    setPhotos((current) => {
      current.forEach((photo) => URL.revokeObjectURL(photo.url));
      return [];
    });
    setDetectMessage("");
  }, []);

  return { photos, addPhotos, retagPhoto, removePhoto, resetPhotos, detectMessage, setDetectMessage };
}

async function uploadIntakePhotos(photos, keyHint) {
  const uploaded = [];
  for (const photo of photos) {
    const stored = await uploadIntakeImage(photo.file, keyHint);
    uploaded.push({ ...stored, type: photo.type });
  }
  return uploaded;
}

function IntakePhotoBoard({ intake, disabled }) {
  const labelInputRef = useRef(null);
  const barcodeInputRef = useRef(null);
  const itemInputRef = useRef(null);
  const uploadInputRef = useRef(null);

  function handleFiles(event, type) {
    const files = Array.from(event.target.files || []);
    if (files.length) intake.addPhotos(files, type);
    event.target.value = "";
  }

  return (
    <div className="intake-board">
      <div className="intake-buttons">
        <button className="button primary intake-btn" type="button" disabled={disabled} onClick={() => labelInputRef.current?.click()}>
          <Camera size={20} /> Take Label Photo
        </button>
        <button className="button primary intake-btn" type="button" disabled={disabled} onClick={() => barcodeInputRef.current?.click()}>
          <QrCode size={20} /> Take Barcode Photo
        </button>
        <button className="button primary intake-btn" type="button" disabled={disabled} onClick={() => itemInputRef.current?.click()}>
          <Camera size={20} /> Take Item Photo
        </button>
        <button className="button secondary intake-btn" type="button" disabled={disabled} onClick={() => uploadInputRef.current?.click()}>
          <Upload size={20} /> Upload Saved Photos
        </button>
      </div>
      <input ref={labelInputRef} className="intake-hidden-input" type="file" accept="image/*" capture="environment" onChange={(event) => handleFiles(event, "label_barcode")} />
      <input ref={barcodeInputRef} className="intake-hidden-input" type="file" accept="image/*" capture="environment" onChange={(event) => handleFiles(event, "label_barcode")} />
      <input ref={itemInputRef} className="intake-hidden-input" type="file" accept="image/*" capture="environment" onChange={(event) => handleFiles(event, "item")} />
      <input ref={uploadInputRef} className="intake-hidden-input" type="file" accept="image/*" multiple onChange={(event) => handleFiles(event, "item")} />

      {intake.photos.length > 0 ? (
        <div className="intake-thumbs">
          {intake.photos.map((photo) => (
            <div className="intake-thumb" key={photo.key}>
              <img src={photo.url} alt="Intake" />
              {photo.detecting ? <span className="tag">Scanning for barcode&hellip;</span> : null}
              <select value={photo.type} aria-label="Photo type" onChange={(event) => intake.retagPhoto(photo.key, event.target.value)}>
                {IMAGE_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
              <button className="remove-photo" type="button" onClick={() => intake.removePhoto(photo.key)}>
                <Trash2 size={15} /> Remove
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-state">No photos yet. Take a photo with the camera or upload saved photos from your device.</p>
      )}
    </div>
  );
}

const PHOTO_INTAKE_FORM = { title: "", sku: "", barcode: "", label_text: "", quantity_available: "1" };

function PhotoIntakePage({ auth, route, reload }) {
  const [form, setForm] = useState(PHOTO_INTAKE_FORM);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState("notice");
  const [savedItem, setSavedItem] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const handleBarcodeDetected = useCallback((value) => {
    setForm((current) => (current.barcode ? current : { ...current, barcode: value }));
    setMessage(`Barcode detected: ${value}. Review or edit it before saving.`);
    setMessageTone("notice");
  }, []);

  const intake = useIntakePhotos({ onBarcodeDetected: handleBarcodeDetected });

  function updateField(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function save() {
    const nextStatus = "draft";
    if (!intake.photos.length && !form.barcode.trim() && !form.sku.trim() && !form.title.trim()) {
      setMessage("Add at least one photo, or enter a barcode, SKU, or title, before saving.");
      setMessageTone("warning");
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const userId = auth.session.user.id;
      const uploaded = await uploadIntakePhotos(intake.photos, form.sku.trim() || form.barcode.trim() || "photo-intake");

      let payload = {
        ...EMPTY_PRODUCT,
        title: form.title.trim() || "Photo intake item",
        sku: form.sku.trim(),
        barcode: form.barcode.trim(),
        label_text: form.label_text,
        quantity_available: form.quantity_available === "" ? "1" : form.quantity_available,
        status: nextStatus
      };
      payload = assignPhotoSlots(payload, uploaded);

      const saved = await saveProduct(payload, userId);
      if (uploaded.length) await addProductImages(saved.id, uploaded, userId);
      try {
        await logActivity("photo-intake", saved, userId);
      } catch (logError) {
        console.warn("photo-intake activity log failed", logError);
      }

      await reload();
      intake.resetPhotos();
      setForm(PHOTO_INTAKE_FORM);
      setShowDetails(false);
      setSavedItem(saved);
      setMessage(`Draft saved: ${saved.title}. Ready for the next item.`);
      setMessageTone("notice");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setMessage(error.message);
      setMessageTone("error");
    } finally {
      setSaving(false);
    }
  }

  const messageClass = messageTone === "notice" ? "notice" : messageTone === "warning" ? "warning-banner" : "error-banner";

  return (
    <div className="admin-page">
      {message ? <p className={messageClass}>{message}</p> : null}
      {intake.detectMessage ? <p className="warning-banner">{intake.detectMessage}</p> : null}
      {savedItem ? (
        <div className="intake-saved">
          <span>Last saved: <strong>{savedItem.title}</strong> ({savedItem.status})</span>
          <button className="button small secondary" type="button" onClick={() => route.navigate(`/admin/inventory/${savedItem.id}/edit`)}>Open item</button>
        </div>
      ) : null}

      <section className="admin-panel">
        <div className="panel-heading">
          <div>
            <h2>Add inventory from photos</h2>
            <p>Take photos, hit save, move to the next item. Everything saves as a draft - review and publish later from the office.</p>
          </div>
          <Camera size={32} />
        </div>
        <IntakePhotoBoard intake={intake} disabled={saving} />
        <button className="button primary intake-btn intake-save" type="button" disabled={saving} onClick={save}>
          {saving ? <Loader2 className="spin" size={20} /> : <ClipboardList size={20} />} {saving ? "Saving..." : "Save Draft - Next Item"}
        </button>
        <button className="button secondary" type="button" onClick={() => setShowDetails((current) => !current)}>
          {showDetails ? "Hide details" : "Add details (optional)"}
        </button>
      </section>

      {showDetails ? (
        <section className="admin-panel">
          <div className="panel-heading">
            <div>
              <h2>Item details (all optional)</h2>
              <p>Fill in anything you know now. Drafts can be completed later from the Inventory page.</p>
            </div>
          </div>
          <div className="form-grid">
            <TextField label="Barcode / UPC" name="barcode" value={form.barcode} onChange={updateField} />
            <TextField label="Suggested part number / SKU" name="sku" value={form.sku} onChange={updateField} />
            <TextField label="Title / name" name="title" value={form.title} onChange={updateField} />
            <TextField label="Quantity" name="quantity_available" type="number" value={form.quantity_available} onChange={updateField} />
          </div>
          <label className="full-field">
            <span>Label text / notes</span>
            <textarea name="label_text" rows="4" value={form.label_text} onChange={updateField} placeholder="Type or paste text from the label here..." />
          </label>
          <div className="form-actions">
            <button className="button primary intake-btn" type="button" disabled={saving} onClick={save}>
              {saving ? <Loader2 className="spin" size={18} /> : <ClipboardList size={18} />} Save Draft - Next Item
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ScanPage({ auth, route, products, reload }) {
  const [scanValue, setScanValue] = useState("");
  const [message, setMessage] = useState("");
  const [cameraMessage, setCameraMessage] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const [pendingPhoto, setPendingPhoto] = useState(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const inputRef = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const controlsRef = useRef(null);
  const rafRef = useRef(null);
  const handlingRef = useRef(false);
  const pendingPhotoRef = useRef(null);
  const photoTakeRef = useRef(null);
  const photoUploadRef = useRef(null);

  useEffect(() => {
    pendingPhotoRef.current = pendingPhoto;
  }, [pendingPhoto]);

  useEffect(() => {
    inputRef.current?.focus();
    return () => {
      stopCamera();
      if (pendingPhotoRef.current) URL.revokeObjectURL(pendingPhotoRef.current.url);
    };
  }, []);

  function clearPendingPhoto() {
    setPendingPhoto((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
  }

  async function attachBarcodePhoto(product, file) {
    const uploaded = await uploadIntakeImage(file, product.sku || product.barcode || "scan");
    await addProductImages(product.id, [{ ...uploaded, type: "label_barcode" }], auth.session.user.id);
    if (!product.photo_label) {
      await saveProduct({ ...product, photo_label: uploaded.url }, auth.session.user.id);
    }
  }

  async function handleScan(value, photoFile) {
    const scanned = value.trim();
    if (!scanned || handlingRef.current) return;

    handlingRef.current = true;
    setMessage(`Scanned ${scanned}. Searching inventory...`);

    try {
      const matches = await findProductByScan(scanned);
      if (matches.length > 0) {
        if (photoFile) {
          setMessage("Duplicate found. Attaching barcode photo to the existing item...");
          await attachBarcodePhoto(matches[0], photoFile);
          clearPendingPhoto();
        }
        setMessage("Duplicate found. Opening the existing item.");
        route.navigate(`/admin/inventory/${matches[0].id}/edit?duplicate=1`);
        return;
      }

      const draft = await saveProduct(
        {
          ...EMPTY_PRODUCT,
          sku: scanned,
          barcode: scanned,
          title: `Scanned material ${scanned}`,
          status: "draft"
        },
        auth.session.user.id
      );

      if (photoFile) {
        await attachBarcodePhoto(draft, photoFile);
        clearPendingPhoto();
      }

      await reload();
      route.navigate(`/admin/inventory/${draft.id}/edit?created=1`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      handlingRef.current = false;
      stopCamera();
    }
  }

  async function handleBarcodePhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setPhotoBusy(true);
    setMessage("Checking the photo for a barcode...");
    setPendingPhoto((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return { file, url: URL.createObjectURL(file) };
    });

    const value = await detectBarcodeFromImage(file);
    setPhotoBusy(false);

    if (value) {
      setScanValue(value);
      handleScan(value, file);
    } else {
      setMessage("No barcode detected. You can type it manually or save as draft. The photo will be attached when you search or create the item.");
    }
  }

  async function startCamera() {
    setCameraMessage("");
    setCameraActive(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();

      if ("BarcodeDetector" in window) {
        const detector = new window.BarcodeDetector({ formats: ["code_128", "code_39", "ean_13", "ean_8", "upc_a", "upc_e", "qr_code"] });
        const tick = async () => {
          if (!videoRef.current || handlingRef.current) return;
          const codes = await detector.detect(videoRef.current);
          if (codes.length > 0) {
            handleScan(codes[0].rawValue);
            return;
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();
        return;
      }

      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatReader();
      controlsRef.current = await reader.decodeFromVideoElement(videoRef.current, (result) => {
        if (result) handleScan(result.getText());
      });
    } catch (error) {
      setCameraActive(false);
      setCameraMessage(`Camera unavailable. Use manual entry or scanner input. ${error.message}`);
      stopCamera();
    }
  }

  function stopCamera() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    controlsRef.current?.stop?.();
    streamRef.current?.getTracks?.().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraActive(false);
  }

  return (
    <div className="admin-page">
      <section className="admin-panel scan-panel">
        <div className="panel-heading">
          <div>
            <h2>Scan SKU or barcode</h2>
            <p>USB and Bluetooth scanners type into the focused input and press Enter.</p>
          </div>
          <QrCode size={32} />
        </div>

        <form
          className="scan-form"
          onSubmit={(event) => {
            event.preventDefault();
            handleScan(scanValue, pendingPhoto?.file);
          }}
        >
          <label>
            <span>Scanner / manual entry</span>
            <input ref={inputRef} value={scanValue} onChange={(event) => setScanValue(event.target.value)} placeholder="Scan or type SKU/barcode and press Enter" />
          </label>
          <button className="button primary" type="submit"><Search size={18} /> Search or create draft</button>
        </form>

        <div className="camera-box">
          <video ref={videoRef} muted playsInline />
          <div className="camera-actions">
            <button className="button secondary" type="button" onClick={cameraActive ? stopCamera : startCamera}><Camera size={18} /> {cameraActive ? "Stop camera" : "Scan Barcode (live camera)"}</button>
          </div>
        </div>

        <div className="intake-buttons">
          <button className="button primary intake-btn" type="button" disabled={photoBusy} onClick={() => photoTakeRef.current?.click()}>
            <Camera size={20} /> Take Barcode Photo
          </button>
          <button className="button secondary intake-btn" type="button" disabled={photoBusy} onClick={() => photoUploadRef.current?.click()}>
            <Upload size={20} /> Upload Barcode Photo
          </button>
        </div>
        <input ref={photoTakeRef} className="intake-hidden-input" type="file" accept="image/*" capture="environment" onChange={handleBarcodePhoto} />
        <input ref={photoUploadRef} className="intake-hidden-input" type="file" accept="image/*" onChange={handleBarcodePhoto} />

        {pendingPhoto ? (
          <div className="scan-pending">
            <img src={pendingPhoto.url} alt="Barcode" />
            <span>Photo ready. It will be attached to the item found or created next.</span>
            <button className="remove-photo" type="button" onClick={clearPendingPhoto}><Trash2 size={15} /> Remove</button>
          </div>
        ) : null}

        {message ? <p className="notice">{message}</p> : null}
        {cameraMessage ? <p className="warning-banner">{cameraMessage}</p> : null}
        <p className="muted">Current inventory loaded for reference: {products.length} items.</p>
      </section>
    </div>
  );
}

function ImportPage({ products, auth, reload }) {
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [duplicateMode, setDuplicateMode] = useState("skip");
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const mappedRows = useMemo(() => applyColumnMapping(rows, mapping), [rows, mapping]);
  const rowChecks = useMemo(() => findDuplicateRows(mappedRows, products), [mappedRows, products]);
  const duplicateCount = rowChecks.filter((row) => row.duplicate).length;
  const errorCount = rowChecks.filter((row) => row.errors.length).length;

  async function uploadFile(file) {
    setMessage("");
    setResult(null);
    try {
      const parsed = await parseInventoryFile(file);
      setHeaders(parsed.headers);
      setRows(parsed.rows);
      setMapping(autoMapColumns(parsed.headers));
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function runImport() {
    setBusy(true);
    setMessage("");
    setResult(null);

    try {
      const validRows = mappedRows.filter((row, index) => rowChecks[index]?.errors.length === 0);
      const importResult = await importProducts(validRows, duplicateMode, products, auth.session.user.id);
      setResult(importResult);
      await reload();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-page">
      <section className="admin-panel">
        <div className="panel-heading">
          <div>
            <h2>Bulk import inventory</h2>
            <p>Upload CSV or XLSX, preview rows, map columns, catch duplicates, then import.</p>
          </div>
          <Upload size={32} />
        </div>

        <label className="upload-drop">
          <FileSpreadsheet size={28} />
          <span>Upload CSV, XLSX, or XLS</span>
          <input type="file" accept=".csv,.xlsx,.xls" onChange={(event) => event.target.files?.[0] && uploadFile(event.target.files[0])} />
        </label>

        {message ? <p className="error-banner">{message}</p> : null}

        {rows.length > 0 ? (
          <>
            <div className="import-summary">
              <span>{rows.length} rows</span>
              <span>{duplicateCount} duplicate warnings</span>
              <span>{errorCount} validation errors</span>
            </div>
            <div className="mapping-grid">
              {IMPORT_COLUMNS.map((field) => (
                <label key={field}>
                  <span>{field}</span>
                  <select value={mapping[field] || ""} onChange={(event) => setMapping({ ...mapping, [field]: event.target.value })}>
                    <option value="">Not mapped</option>
                    {headers.map((header) => <option key={header} value={header}>{header}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <div className="inline-options">
              <label>
                <span>Duplicate handling</span>
                <select value={duplicateMode} onChange={(event) => setDuplicateMode(event.target.value)}>
                  <option value="skip">Skip duplicates</option>
                  <option value="update">Update existing</option>
                  <option value="draft">Create new drafts</option>
                </select>
              </label>
              <button className="button primary" type="button" disabled={busy || rows.length === 0} onClick={runImport}><Upload size={18} /> Import rows</button>
            </div>
            <ImportPreview rows={mappedRows} checks={rowChecks} />
          </>
        ) : null}

        {result ? (
          <div className="result-grid">
            <span>Created <strong>{result.created}</strong></span>
            <span>Updated <strong>{result.updated}</strong></span>
            <span>Skipped <strong>{result.skipped}</strong></span>
            <span>Errors <strong>{result.errors}</strong></span>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function ImportPreview({ rows, checks }) {
  return (
    <div className="table-wrap">
      <table className="inventory-table">
        <thead>
          <tr>
            <th>Row</th>
            <th>SKU</th>
            <th>Barcode</th>
            <th>Title</th>
            <th>Status</th>
            <th>Warnings</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 25).map((row, index) => (
            <tr key={`${row.sku}-${index}`}>
              <td>{index + 1}</td>
              <td>{row.sku}</td>
              <td>{row.barcode}</td>
              <td>{row.title}</td>
              <td>{row.status || "draft"}</td>
              <td>
                {checks[index]?.duplicate ? <span className="tag warn">duplicate</span> : null}
                {checks[index]?.errors.map((error) => <span className="tag danger" key={error}>{error}</span>)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CategoriesPage() {
  const [categories, setCategories] = useState([]);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(() => fetchCategories().then(setCategories).catch((error) => setMessage(error.message)), []);
  useEffect(() => { load(); }, [load]);

  async function addCategory(event) {
    event.preventDefault();
    if (!name.trim()) return;
    await createCategory(name);
    setName("");
    load();
  }

  return (
    <SimpleManager
      title="Categories"
      message={message}
      form={
        <form className="inline-form" onSubmit={addCategory}>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Category name" />
          <button className="button primary" type="submit"><Plus size={18} /> Add category</button>
        </form>
      }
      rows={categories.map((category) => ({
        id: category.id,
        title: category.name,
        detail: "Inventory category",
        onDelete: async () => {
          await deleteCategory(category.id);
          load();
        }
      }))}
    />
  );
}

function StorageLocationsPage() {
  const [locations, setLocations] = useState([]);
  const [form, setForm] = useState({ name: "", aisle: "", rack: "", shelf: "", pallet: "", notes: "" });
  const [message, setMessage] = useState("");

  const load = useCallback(() => fetchStorageLocations().then(setLocations).catch((error) => setMessage(error.message)), []);
  useEffect(() => { load(); }, [load]);

  async function addLocation(event) {
    event.preventDefault();
    await createStorageLocation(form);
    setForm({ name: "", aisle: "", rack: "", shelf: "", pallet: "", notes: "" });
    load();
  }

  return (
    <SimpleManager
      title="Storage locations"
      message={message}
      form={
        <form className="form-grid" onSubmit={addLocation}>
          {["name", "aisle", "rack", "shelf", "pallet", "notes"].map((field) => (
            <TextField key={field} label={labelize(field)} name={field} value={form[field]} onChange={(event) => setForm({ ...form, [field]: event.target.value })} />
          ))}
          <button className="button primary" type="submit"><Plus size={18} /> Add location</button>
        </form>
      }
      rows={locations.map((location) => ({
        id: location.id,
        title: location.name || formatLocation(location) || "Storage location",
        detail: location.notes || formatLocation(location),
        onDelete: async () => {
          await deleteStorageLocation(location.id);
          load();
        }
      }))}
    />
  );
}

function SimpleManager({ title, message, form, rows }) {
  return (
    <div className="admin-page">
      <section className="admin-panel">
        <div className="panel-heading"><h2>{title}</h2></div>
        {message ? <p className="error-banner">{message}</p> : null}
        {form}
        <div className="manager-list">
          {rows.map((row) => (
            <article className="manager-row" key={row.id}>
              <div><strong>{row.title}</strong><span>{row.detail}</span></div>
              <button className="icon-button danger" type="button" onClick={row.onDelete}><Trash2 size={16} /></button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function ActivityLogPage({ activity, loading }) {
  if (loading) return <LoadingState label="Loading activity" />;

  return (
    <div className="admin-page">
      <section className="admin-panel">
        <div className="panel-heading"><h2>Activity log</h2></div>
        <ActivityList activity={activity} />
      </section>
    </div>
  );
}

function ActivityList({ activity }) {
  if (!activity.length) return <p className="empty-state">No activity yet.</p>;

  return (
    <div className="activity-list">
      {activity.map((item) => {
        const after = item.after_data || {};
        const before = item.before_data || {};
        const product = after.title || before.title || "Inventory item";
        const sku = after.sku || before.sku || after.barcode || before.barcode || "No SKU";

        return (
          <article className="activity-row" key={item.id}>
            <span className="status-dot" />
            <div>
              <strong>{item.action} - {product}</strong>
              <span>{sku} - {new Date(item.created_at).toLocaleString()}</span>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function TextField({ label, name, value, onChange, type = "text", required = false, autoComplete }) {
  return (
    <label>
      <span>{label}</span>
      <input name={name} type={type} value={value || ""} onChange={onChange} required={required} autoComplete={autoComplete} />
    </label>
  );
}

function StatusBadge({ status }) {
  return <span className={`status-badge ${status}`}>{status}</span>;
}

function LoadingState({ label, fullPage = false }) {
  return (
    <div className={fullPage ? "loading-state full" : "loading-state"}>
      <Loader2 className="spin" size={22} />
      <span>{label}</span>
    </div>
  );
}

function CenteredPanel({ icon, title, children }) {
  return (
    <main className="centered-page">
      <section className="centered-panel">
        {icon}
        <h1>{title}</h1>
        {children}
      </section>
    </main>
  );
}

function Navigate({ to, navigate }) {
  useEffect(() => {
    navigate(to);
  }, [navigate, to]);

  return null;
}

function buildMailto(subject, bodyLines) {
  return `mailto:sales@telecomstore.net?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyLines.join("\n"))}`;
}

function handleNavClick(event, navigate, to) {
  event.preventDefault();
  navigate(to);
}

function countByStatus(products) {
  return PRODUCT_STATUSES.reduce((counts, status) => {
    counts[status] = products.filter((product) => product.status === status).length;
    return counts;
  }, {});
}

function formatLocation(product) {
  return [product.warehouse_location, product.aisle && `Aisle ${product.aisle}`, product.rack && `Rack ${product.rack}`, product.shelf && `Shelf ${product.shelf}`, product.pallet && `Pallet ${product.pallet}`]
    .filter(Boolean)
    .join(" / ");
}

function adminTitle(path) {
  if (path === "/admin") return "Dashboard";
  if (path === "/admin/inventory") return "Inventory";
  if (path === "/admin/inventory/new") return "Add Item";
  if (path === "/admin/photo-intake") return "Photo Intake";
  if (path.includes("/edit")) return "Edit Item";
  if (path === "/admin/scan") return "Scan Item";
  if (path === "/admin/import") return "Bulk Import";
  if (path === "/admin/categories") return "Categories";
  if (path === "/admin/locations") return "Storage Locations";
  if (path === "/admin/activity") return "Activity Log";
  return "Admin";
}

function labelize(value) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

createRoot(document.getElementById("root")).render(<App />);

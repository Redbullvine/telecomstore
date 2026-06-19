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
  IMPORT_COLUMNS,
  PRODUCT_STATUSES,
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
  normalizeProduct,
  saveProduct,
  updateProductStatus,
  uploadProductImage
} from "./lib/inventory";
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

function PublicStorefront({ navigate }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [status, setStatus] = useState("available");
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [quoteForm, setQuoteForm] = useState(QUOTE_FORM);

  useEffect(() => {
    fetchPublicProducts()
      .then(setProducts)
      .finally(() => setLoading(false));
  }, []);

  const categories = useMemo(() => ["All", ...getProductCategories(products)], [products]);
  const filtered = useMemo(
    () => filterProducts(products, { query, category, status }),
    [products, query, category, status]
  );
  const featuredProducts = useMemo(() => products.slice(0, 3), [products]);
  useScrollReveal([filtered]);

  function startQuote(product) {
    setQuoteForm((current) => ({
      ...current,
      sku: product.sku || product.barcode,
      notes: current.notes || `${product.brand} ${product.title}`.trim()
    }));
    setSelectedProduct(null);
    window.requestAnimationFrame(() => {
      document.getElementById("quote")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function submitQuote(event) {
    event.preventDefault();
    window.location.href = buildMailto(
      quoteForm.sku ? `Telecom Store quote request: ${quoteForm.sku}` : "Telecom Store quote request",
      [
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
      ]
    );
  }

  return (
    <main>
      <section className="store-hero">
        <nav className="top-nav">
          <a className="brand" href="/" onClick={(event) => handleNavClick(event, navigate, "/")}>
            <span className="brand-mark">TS</span>
            <span>Telecom Store</span>
          </a>
          <div className="nav-links">
            <a href="#inventory">Inventory</a>
            <a href="#quote">Request quote</a>
            <a href="/login" onClick={(event) => handleNavClick(event, navigate, "/login")}>Admin login</a>
          </div>
        </nav>

        <div className="store-hero-grid">
          <div>
            <p className="eyebrow">Telecom warehouse inventory</p>
            <h1>Available telecom material, organized by SKU.</h1>
            <p className="hero-copy">
              Browse verified available material, search by SKU or barcode, inspect product photos, and request a quote.
              Pricing and counts are confirmed before sale.
            </p>
            <div className="hero-actions">
              <a className="button primary" href="#inventory"><PackageSearch size={18} /> Browse inventory</a>
              <a className="button secondary on-dark" href="#quote"><Mail size={18} /> Request quote</a>
            </div>
          </div>
          <div className="hero-panel warehouse-board">
            <div className="board-kicker">
              <Warehouse size={28} />
              <span>Warehouse desk</span>
            </div>
            <div className="rack-preview" aria-label="Featured available SKUs">
              {[0, 1, 2].map((slot) => {
                const item = featuredProducts[slot];
                return (
                  <div className="rack-bin" key={item?.id || item?.sku || slot}>
                    <span>{item?.category || "Available material"}</span>
                    <strong>{item?.sku || item?.barcode || "SKU pending"}</strong>
                  </div>
                );
              })}
            </div>
            <h2>Ready for quote review</h2>
            <p>Available listings stay easy to scan while exact count, condition, and shipping are confirmed before sale.</p>
            <div className="metric-strip">
              <span><strong>{products.length}</strong> available listings</span>
              <span><strong>{categories.length - 1}</strong> categories</span>
            </div>
          </div>
        </div>
      </section>

      <section className="trust-strip">
        <div><ShieldCheck /> Available listings only</div>
        <div><QrCode /> SKU and barcode search</div>
        <div><ClipboardList /> Request quote workflow</div>
      </section>

      <section className="section inventory-section" id="inventory">
        <div className="inventory-heading-row">
          <div className="section-heading reveal">
            <p className="eyebrow">Public storefront</p>
            <h2>Browse available inventory</h2>
            <p>Only products marked available are shown here. Draft, hold, sold, and archived items stay internal.</p>
          </div>
          <div className="inventory-count-card reveal" style={{ '--reveal-delay': '110ms' }}>
            <PackageSearch size={22} />
            <span>Available now</span>
            <strong>{filtered.length}</strong>
          </div>
        </div>

        <div className="filter-bar">
          <label className="search-box">
            <Search size={18} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search SKU, barcode, brand, title, category..." />
          </label>
          <label className="select-box">
            <Filter size={18} />
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              {categories.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="select-box">
            <ListChecks size={18} />
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="available">Available</option>
            </select>
          </label>
        </div>

        {loading ? <LoadingState label="Loading inventory" /> : null}

        {!loading && filtered.length === 0 ? (
          <p className="empty-state">No available products match that search.</p>
        ) : null}

        <div className="product-grid">
          {filtered.map((product, index) => (
            <ProductCard key={product.id || product.sku} product={product} onDetails={setSelectedProduct} onQuote={startQuote} index={index} />
          ))}
        </div>
      </section>

      <section className="section quote-section" id="quote">
        <div className="reveal">
          <p className="eyebrow">Request quote</p>
          <h2>Send SKU, quantity, and job details.</h2>
          <p>Telecom Store will verify count, condition, compatibility, and shipping before quoting.</p>
          <div className="contact-card">
            <a href="mailto:sales@telecomstore.net"><Mail /> sales@telecomstore.net</a>
          </div>
        </div>
        <div className="reveal" style={{ '--reveal-delay': '150ms' }}>
          <QuoteForm quoteForm={quoteForm} setQuoteForm={setQuoteForm} onSubmit={submitQuote} />
        </div>
      </section>

      {selectedProduct ? (
        <ProductModal product={selectedProduct} onClose={() => setSelectedProduct(null)} onQuote={startQuote} />
      ) : null}
    </main>
  );
}

function ProductCard({ product, onDetails, onQuote, index = 0 }) {
  return (
    <article className="product-card reveal" style={{ '--reveal-delay': `${Math.min(index, 8) * 60}ms` }}>
      <ProductImage product={product} preferMainOnly />
      <div className="product-body">
        <p className="sku">{product.sku || product.barcode}</p>
        <h3>{product.title}</h3>
        <p className="muted">{product.short_description}</p>
        <dl>
          <div><dt>Brand</dt><dd>{product.brand || "Verify"}</dd></div>
          <div><dt>Category</dt><dd>{product.category || "Uncategorized"}</dd></div>
          <div><dt>Quantity</dt><dd>{product.quantity_available || "Verify"}</dd></div>
          <div><dt>Price</dt><dd>{product.price ? `$${product.price}` : product.price_note || "Request quote"}</dd></div>
        </dl>
        <div className="product-actions">
          <button className="button secondary small" type="button" onClick={() => onDetails(product)}><Eye size={16} /> Details</button>
          <button className="button primary small" type="button" onClick={() => onQuote(product)}><Mail size={16} /> Request quote</button>
        </div>
      </div>
    </article>
  );
}

function ProductModal({ product, onClose, onQuote }) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="product-modal" role="dialog" aria-modal="true" aria-labelledby="product-modal-title" onClick={(event) => event.stopPropagation()}>
        <button className="icon-button close-button" type="button" aria-label="Close product details" onClick={onClose}><X size={22} /></button>
        <ProductImage product={product} large />
        <div className="modal-copy">
          <p className="sku">{product.sku || product.barcode}</p>
          <h2 id="product-modal-title">{product.title}</h2>
          <p className="muted">{product.short_description}</p>
          <dl className="spec-list">
            <div><dt>Brand</dt><dd>{product.brand || "Verify"}</dd></div>
            <div><dt>Barcode</dt><dd>{product.barcode || "None listed"}</dd></div>
            <div><dt>Category</dt><dd>{product.category || "Uncategorized"}</dd></div>
            <div><dt>Condition</dt><dd>{product.condition || "Verify"}</dd></div>
            <div><dt>Quantity</dt><dd>{product.quantity_available || "Verify"}</dd></div>
            <div><dt>Location</dt><dd>{formatLocation(product) || "Internal only"}</dd></div>
            <div><dt>Status</dt><dd>Request quote</dd></div>
          </dl>
          <div className="detail-list">
            {(product.long_description || "Request current photos, count, and compatibility confirmation before purchase.")
              .split("\n")
              .filter(Boolean)
              .map((detail) => <p key={detail}>{detail}</p>)}
          </div>
          <button className="button primary modal-cta" type="button" onClick={() => onQuote(product)}><Mail size={18} /> Request quote</button>
        </div>
      </section>
    </div>
  );
}

function ProductImage({ product, large = false, preferMainOnly = false }) {
  const [imageFailed, setImageFailed] = useState(false);
  const imageSrc = product.photo_main || (preferMainOnly ? "" : product.photo_label || product.photo_extra_1 || product.photo_extra_2);
  const showImage = imageSrc && !imageFailed;

  return (
    <div className={large ? "product-image product-image-large" : "product-image"}>
      {showImage ? (
        <img src={imageSrc} alt={`${product.brand} ${product.title}`} loading={large ? "eager" : "lazy"} onError={() => setImageFailed(true)} />
      ) : null}
      <span className="image-placeholder" aria-hidden={showImage ? "true" : undefined}>
        {product.brand || "Telecom Store"}
        <br />
        {product.sku || product.barcode || "Photo pending"}
      </span>
    </div>
  );
}

function QuoteForm({ quoteForm, setQuoteForm, onSubmit }) {
  function updateField(event) {
    const { name, value } = event.target;
    setQuoteForm((current) => ({ ...current, [name]: value }));
  }

  return (
    <form className="quote-form" onSubmit={onSubmit}>
      <div className="form-heading"><ClipboardList size={24} /><h3>Quote request</h3></div>
      <div className="field-grid">
        <TextField label="Name" name="name" value={quoteForm.name} onChange={updateField} autoComplete="name" />
        <TextField label="Company" name="company" value={quoteForm.company} onChange={updateField} autoComplete="organization" />
        <TextField label="Email" name="email" type="email" value={quoteForm.email} onChange={updateField} autoComplete="email" />
        <TextField label="Phone" name="phone" type="tel" value={quoteForm.phone} onChange={updateField} autoComplete="tel" />
        <TextField label="SKU or product" name="sku" value={quoteForm.sku} onChange={updateField} required />
        <TextField label="Quantity needed" name="quantity" value={quoteForm.quantity} onChange={updateField} required />
        <TextField label="Project location" name="projectLocation" value={quoteForm.projectLocation} onChange={updateField} />
        <TextField label="Need-by date" name="needBy" type="date" value={quoteForm.needBy} onChange={updateField} />
      </div>
      <label>
        <span>Notes</span>
        <textarea name="notes" value={quoteForm.notes} onChange={updateField} rows="4" />
      </label>
      <button className="button primary form-submit" type="submit"><Mail size={18} /> Create email request</button>
    </form>
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

function DashboardPage({ products, activity, loading }) {
  const counts = countByStatus(products);
  const cards = [
    { label: "Inventory count", value: products.length, icon: <Boxes /> },
    { label: "Available", value: counts.available, icon: <CheckCircle2 /> },
    { label: "Hold", value: counts.hold, icon: <PauseCircle /> },
    { label: "Sold", value: counts.sold, icon: <ShoppingBag /> },
    { label: "Draft", value: counts.draft, icon: <ClipboardList /> }
  ];

  if (loading) return <LoadingState label="Loading dashboard" />;

  return (
    <div className="admin-page">
      <div className="dashboard-grid">
        {cards.map((card) => (
          <article className="metric-card" key={card.label}>
            {React.cloneElement(card.icon, { size: 24 })}
            <span>{card.label}</span>
            <strong>{card.value}</strong>
          </article>
        ))}
      </div>
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
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [status, setStatus] = useState("All");
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
            {filtered.map((product) => (
              <tr key={product.id}>
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
            ))}
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

      const saved = await saveProduct(payload, auth.session.user.id);
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
          <label>
            <span>Status</span>
            <select name="status" value={form.status} onChange={updateField}>
              {PRODUCT_STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        </div>

        <label className="full-field">
          <span>Short description</span>
          <textarea name="short_description" value={form.short_description} onChange={updateField} rows="3" />
        </label>
        <label className="full-field">
          <span>Long description</span>
          <textarea name="long_description" value={form.long_description} onChange={updateField} rows="6" />
        </label>

        <div className="photo-grid">
          <PhotoField label="Main photo" field="photo_main" form={form} preview={previews.photo_main} onFile={updateFile} />
          <PhotoField label="Label photo" field="photo_label" form={form} preview={previews.photo_label} onFile={updateFile} />
          <PhotoField label="Extra photo 1" field="photo_extra_1" form={form} preview={previews.photo_extra_1} onFile={updateFile} />
          <PhotoField label="Extra photo 2" field="photo_extra_2" form={form} preview={previews.photo_extra_2} onFile={updateFile} />
        </div>

        <div className="form-actions">
          <button className="button secondary" type="button" onClick={() => route.navigate("/admin/inventory")}>Cancel</button>
          <button className="button secondary" type="button" disabled={saving} onClick={() => submit("draft")}><ClipboardList size={18} /> Save draft</button>
          <button className="button primary" type="button" disabled={saving} onClick={() => submit("available")}><CheckCircle2 size={18} /> Publish available</button>
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

function ScanPage({ auth, route, products, reload }) {
  const [scanValue, setScanValue] = useState("");
  const [message, setMessage] = useState("");
  const [cameraMessage, setCameraMessage] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const inputRef = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const controlsRef = useRef(null);
  const rafRef = useRef(null);
  const handlingRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    return () => stopCamera();
  }, []);

  async function handleScan(value) {
    const scanned = value.trim();
    if (!scanned || handlingRef.current) return;

    handlingRef.current = true;
    setMessage(`Scanned ${scanned}. Searching inventory...`);

    try {
      const matches = await findProductByScan(scanned);
      if (matches.length > 0) {
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

      await reload();
      route.navigate(`/admin/inventory/${draft.id}/edit?created=1`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      handlingRef.current = false;
      stopCamera();
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
            handleScan(scanValue);
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
            <button className="button secondary" type="button" onClick={cameraActive ? stopCamera : startCamera}><Camera size={18} /> {cameraActive ? "Stop camera" : "Start camera scan"}</button>
          </div>
        </div>

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

const GA_ID_PATTERN = /^G-[A-Z0-9]+$/i;
const MAX_TEXT_LENGTH = 100;

let initializedMeasurementId = "";
let linkTrackingInstalled = false;

function currentRoute() {
  if (typeof window === "undefined") return "";
  return `${window.location.pathname}${window.location.search}`;
}

function cleanText(value, maxLength = MAX_TEXT_LENGTH) {
  return String(value || "").trim().slice(0, maxLength);
}

function hasDataLayerCommand(dataLayer, command, measurementId = "") {
  return dataLayer.some((entry) => {
    const values = Array.from(entry || []);
    return values[0] === command && (!measurementId || values[1] === measurementId);
  });
}

export function sanitizeSearchTerm(value) {
  const term = cleanText(value);
  if (!term) return "";

  const containsEmail = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/.test(term);
  const digits = term.replace(/\D/g, "");
  const containsPhone = digits.length >= 10;
  return containsEmail || containsPhone ? "[redacted]" : term;
}

export function productAnalyticsParams(product = {}) {
  return {
    product_id: cleanText(product.id || product.sku || product.barcode),
    product_name: cleanText(product.short_description || product.title || product.sku),
    category: cleanText(product.category)
  };
}

export function initAnalytics(measurementId, options = {}) {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  const id = cleanText(measurementId, 32).toUpperCase();
  if (!GA_ID_PATTERN.test(id)) return false;
  if (initializedMeasurementId === id) return true;

  window.dataLayer = window.dataLayer || [];
  const wasBootstrapped = hasDataLayerCommand(window.dataLayer, "js");
  const wasConfigured = hasDataLayerCommand(window.dataLayer, "config", id);
  window.gtag = window.gtag || function gtag() {
    window.dataLayer.push(arguments);
  };

  const selector = `script[src*="googletagmanager.com/gtag/js?id=${id}"]`;
  if (!document.querySelector(selector)) {
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
    script.dataset.telecomstoreAnalytics = id;
    document.head.appendChild(script);
  }

  if (!window.__telecomstoreGtagBootstrapped && !wasBootstrapped) {
    window.gtag("js", new Date());
  }
  window.__telecomstoreGtagBootstrapped = true;

  if (!wasConfigured) {
    window.gtag("config", id, {
      send_page_view: false,
      ...(options.debug ? { debug_mode: true } : {})
    });
  }
  initializedMeasurementId = id;
  return true;
}

export function trackEvent(eventName, parameters = {}) {
  if (typeof window === "undefined" || !initializedMeasurementId || typeof window.gtag !== "function") return false;
  window.gtag("event", eventName, {
    page_route: currentRoute(),
    ...parameters
  });
  return true;
}

export function trackPageView(path = currentRoute()) {
  if (typeof window === "undefined") return false;
  return trackEvent("page_view", {
    page_location: window.location.href,
    page_path: path,
    page_title: document.title
  });
}

export function trackCheckoutStart(items = [], parameters = {}) {
  return trackEvent("checkout_start", {
    item_count: Array.isArray(items) ? items.length : 0,
    ...parameters
  });
}

export function trackConfirmedPurchase(purchase = {}) {
  const transactionId = cleanText(purchase.transaction_id, 128);
  if (purchase.confirmed !== true || !transactionId) return false;

  const { confirmed: _confirmed, ...parameters } = purchase;
  return trackEvent("purchase", { ...parameters, transaction_id: transactionId });
}

export function installLinkTracking() {
  if (typeof document === "undefined" || linkTrackingInstalled) return;

  document.addEventListener("click", (event) => {
    const anchor = event.target.closest?.("a[href]");
    if (!anchor) return;

    const href = anchor.getAttribute("href") || "";
    if (/^(mailto|tel):/i.test(href)) {
      trackEvent("contact_click", {
        contact_method: href.split(":", 1)[0].toLowerCase(),
        source: cleanText(anchor.dataset.analyticsSource || (anchor.closest("footer") ? "footer" : "page"))
      });
      return;
    }

    let destination;
    try {
      destination = new URL(anchor.href, window.location.href);
    } catch {
      return;
    }

    if (/^https?:$/.test(destination.protocol) && destination.hostname !== window.location.hostname) {
      trackEvent("outbound_vendor_click", {
        destination_vendor: cleanText(anchor.dataset.vendor || destination.hostname),
        product_id: cleanText(anchor.dataset.productId),
        product_name: cleanText(anchor.dataset.productName),
        category: cleanText(anchor.dataset.category)
      });
    }
  });
  linkTrackingInstalled = true;
}

export function resetAnalyticsForTests() {
  initializedMeasurementId = "";
  linkTrackingInstalled = false;
}

import test from "node:test";
import assert from "node:assert/strict";
import {
  initAnalytics,
  productAnalyticsParams,
  resetAnalyticsForTests,
  sanitizeSearchTerm,
  trackConfirmedPurchase,
  trackEvent,
  trackPageView
} from "../src/lib/analytics.mjs";

function installBrowserFixture() {
  const scripts = [];
  globalThis.window = {
    location: {
      pathname: "/admin/inventory",
      search: "?status=available",
      href: "https://telecomstore.net/admin/inventory?status=available",
      hostname: "telecomstore.net"
    },
    dataLayer: []
  };
  globalThis.document = {
    title: "Inventory | Telecom Store",
    querySelector(selector) {
      return scripts.find((script) => selector.includes(script.src?.split("id=")[1])) || null;
    },
    createElement() {
      return { dataset: {} };
    },
    head: {
      appendChild(script) {
        scripts.push(script);
      }
    }
  };
  return scripts;
}

test.beforeEach(() => {
  resetAnalyticsForTests();
  delete globalThis.window;
  delete globalThis.document;
});

test.afterEach(() => {
  delete globalThis.window;
  delete globalThis.document;
});

test("GA4 initializes once with automatic page views disabled", () => {
  const scripts = installBrowserFixture();

  assert.equal(initAnalytics("G-TEST1234"), true);
  assert.equal(initAnalytics("G-TEST1234"), true);
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, "https://www.googletagmanager.com/gtag/js?id=G-TEST1234");

  const calls = window.dataLayer.map((entry) => Array.from(entry));
  assert.equal(calls.filter(([command]) => command === "config").length, 1);
  assert.deepEqual(calls.find(([command]) => command === "config").slice(0, 2), ["config", "G-TEST1234"]);
  assert.equal(calls.find(([command]) => command === "config")[2].send_page_view, false);
});

test("an existing loader and property configuration are not duplicated", () => {
  const scripts = installBrowserFixture();
  scripts.push({ src: "https://www.googletagmanager.com/gtag/js?id=G-TEST1234" });
  window.dataLayer.push(["js", new Date()], ["config", "G-TEST1234", { send_page_view: false }]);

  assert.equal(initAnalytics("G-TEST1234"), true);
  assert.equal(scripts.length, 1);
  assert.equal(window.dataLayer.filter((entry) => Array.from(entry)[0] === "js").length, 1);
  assert.equal(window.dataLayer.filter((entry) => Array.from(entry)[0] === "config").length, 1);
});

test("events include the current route and SPA page views are explicit", () => {
  installBrowserFixture();
  initAnalytics("G-TEST1234");

  assert.equal(trackEvent("category_view", { category: "Fiber" }), true);
  assert.equal(trackPageView("/admin/inventory?status=available"), true);

  const eventCalls = window.dataLayer.map((entry) => Array.from(entry)).filter(([command]) => command === "event");
  assert.equal(eventCalls[0][1], "category_view");
  assert.equal(eventCalls[0][2].page_route, "/admin/inventory?status=available");
  assert.equal(eventCalls[1][1], "page_view");
  assert.equal(eventCalls[1][2].page_path, "/admin/inventory?status=available");
});

test("purchase requires explicit confirmation and a transaction ID", () => {
  installBrowserFixture();
  initAnalytics("G-TEST1234");

  assert.equal(trackConfirmedPurchase({ transaction_id: "ORDER-1" }), false);
  assert.equal(trackConfirmedPurchase({ confirmed: true }), false);
  assert.equal(trackConfirmedPurchase({ confirmed: true, transaction_id: "ORDER-1", value: 125 }), true);

  const purchases = window.dataLayer
    .map((entry) => Array.from(entry))
    .filter(([, eventName]) => eventName === "purchase");
  assert.equal(purchases.length, 1);
  assert.equal(purchases[0][2].transaction_id, "ORDER-1");
});

test("analytics parameters avoid obvious contact data", () => {
  assert.equal(sanitizeSearchTerm("  3M closure 2178  "), "3M closure 2178");
  assert.equal(sanitizeSearchTerm("person@example.com"), "[redacted]");
  assert.equal(sanitizeSearchTerm("312-555-0199"), "[redacted]");
  assert.deepEqual(productAnalyticsParams({ id: "42", title: "Fiber closure", category: "Fiber" }), {
    product_id: "42",
    product_name: "Fiber closure",
    category: "Fiber"
  });
});

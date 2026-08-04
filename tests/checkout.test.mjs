import test from "node:test";
import assert from "node:assert/strict";
import { createCheckoutHandler } from "../netlify/functions/_shared/checkout-core.mjs";

const ready = { public_sku: "PUBLIC-1", title: "Cable", public_price: 25.5, price_mode: "fixed", pricing_approved: true, checkout_active: true, shipping_class: "parcel", taxable: true, automatic_tax: true, allowed_countries: ["US"], stripe_shipping_rate_id: "shr_test", stripe_price_id: null };
const quote = { ...ready, public_sku: "PUBLIC-2", public_price: null, price_mode: "request_quote", pricing_approved: false, checkout_active: false };
const request = (body, method = "POST") => new Request("http://local/api", { method, headers: { "content-type": "application/json" }, body: method === "POST" ? JSON.stringify(body) : undefined });
const run = async (body, pricing = [ready, quote], createSession = async (params) => ({ id: "cs_test", url: "https://checkout.stripe.com/c/pay/test", params })) => {
  let params;
  const handler = createCheckoutHandler({ pricing, siteUrl: "https://telecomstore.net", createSession: async (p) => { params = p; return createSession(p); } });
  const response = await handler(request(body));
  return { response, json: await response.json(), params };
};

test("creates server-authoritative checkout and ignores no client prices because they are rejected", async () => {
  const { response, json, params } = await run({ items: [{ sku: "PUBLIC-1", quantity: 2 }] });
  assert.equal(response.status, 200); assert.match(json.url, /^https:\/\/checkout\.stripe\.com/);
  assert.equal(params.line_items[0].price_data.unit_amount, 2550);
  assert.equal(params.billing_address_collection, "required");
  assert.deepEqual(params.shipping_address_collection.allowed_countries, ["US"]);
  assert.equal(params.automatic_tax.enabled, true);
});
test("rejects client authority, empty, unknown, quote-only, invalid quantity, and zero price", async () => {
  for (const body of [{ items: [] }, { items: [{ sku: "NOPE", quantity: 1 }] }, { items: [{ sku: "PSG100", quantity: 1 }] }, { items: [{ sku: "PUBLIC-2", quantity: 1 }] }, { items: [{ sku: "PUBLIC-1", quantity: 0 }] }, { items: [{ sku: "PUBLIC-1", quantity: -1 }] }, { items: [{ sku: "PUBLIC-1", quantity: 1.5 }] }, { items: [{ sku: "PUBLIC-1", quantity: 100 }] }, { items: [{ sku: "PUBLIC-1", quantity: 1, price: 1 }] }]) {
    assert.ok((await run(body)).response.status >= 400);
  }
  assert.ok((await run({ items: [{ sku: "PUBLIC-1", quantity: 1 }] }, [{ ...ready, public_price: 0 }])).response.status >= 400);
  assert.ok((await run({ items: [{ sku: "PUBLIC-1", quantity: 1 }] }, [{ ...ready, public_price: null }])).response.status >= 400);
  assert.ok((await run({ items: [{ sku: "PUBLIC-1", quantity: 1 }] }, [{ ...ready, checkout_active: false }])).response.status >= 400);
  assert.ok((await run({ items: [{ sku: "PUBLIC-1", quantity: 1 }] }, [{ ...ready, pricing_approved: false }])).response.status >= 400);
});
test("rejects GET and malformed JSON", async () => {
  const handler = createCheckoutHandler({ pricing: [ready], siteUrl: "https://telecomstore.net", createSession: async () => ({ url: "https://checkout.stripe.com/test" }) });
  assert.equal((await handler(request(null, "GET"))).status, 405);
  assert.equal((await handler(new Request("http://local/api", { method: "POST", body: "{" }))).status, 400);
});
test("rejects absent shipping, incomplete tax, incompatible shipping, and unsafe return URL", async () => {
  assert.equal((await run({ items: [{ sku: "PUBLIC-1", quantity: 1 }] }, [{ ...ready, stripe_shipping_rate_id: null }])).response.status, 409);
  assert.equal((await run({ items: [{ sku: "PUBLIC-1", quantity: 1 }] }, [{ ...ready, automatic_tax: false }])).response.status, 409);
  const second = { ...ready, public_sku: "PUBLIC-3", stripe_shipping_rate_id: "shr_other" };
  assert.equal((await run({ items: [{ sku: "PUBLIC-1", quantity: 1 }, { sku: "PUBLIC-3", quantity: 1 }] }, [ready, second])).response.status, 409);
  assert.equal((await run({ items: [{ sku: "PUBLIC-1", quantity: 1 }] }, [ready], async () => ({ url: "https://evil.example/" }))).response.status, 502);
});

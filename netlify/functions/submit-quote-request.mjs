// POST /api/quote-requests — the approved path for anonymous customers to
// create a quote request.
//
// The browser supplies only: contact details, shipping address, notes, and
// (public_sku, quantity) pairs. Product identity — title, price mode, and the
// public price when one exists — is snapshotted server-side from the same
// approved pricing bundle the checkout function uses. Unknown SKUs are
// rejected. Rate limiting applies per email and IP. The stored snapshot never
// contains supplier identity or supplier cost (the bundle has none).

import { getServiceClient } from "../lib/supabase-admin.mjs";
import { validateQuoteSubmission } from "../lib/validation.mjs";
import { generateReferenceCode, hashIp, isRateLimited } from "../lib/quotes.mjs";
import { json, publicError, methodNotAllowed, readJsonBody, logServerError, GENERIC_ERROR } from "../lib/http.mjs";
import pricing from "./_shared/opening-pricing.json" with { type: "json" };

const catalogBySku = new Map(pricing.map((row) => [row.public_sku, row]));

export function buildQuoteItemSnapshot(row, quantity) {
  const hasPublicPrice = ["fixed", "listed_price_shipping_quote"].includes(row?.price_mode) && Number(row?.public_price) > 0;
  return {
    product_id: null,
    product_title: row.title,
    product_sku: row.public_sku,
    price_mode: hasPublicPrice ? row.price_mode : "request_quote",
    public_unit_price: hasPublicPrice ? Number(row.public_price).toFixed(2) : null,
    quantity
  };
}

export default async function handler(req, context) {
  if (req.method !== "POST") return methodNotAllowed();

  const service = getServiceClient();
  if (!service) {
    logServerError("submit-quote", "service client not configured", {});
    return publicError(503, "Quote requests are temporarily unavailable. Please email us instead.");
  }

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return publicError(400, "Please check the form and try again.");

  const validation = validateQuoteSubmission(parsed.body);
  if (!validation.ok) {
    // Honeypot hits get a fake success so bots learn nothing.
    if (validation.silent) return json(200, { ok: true });
    return publicError(400, validation.error);
  }
  const submission = validation.submission;

  try {
    const ipHash = hashIp(context?.ip || req.headers.get("x-nf-client-connection-ip") || null);
    if (await isRateLimited(service, { email: submission.customer_email, ipHash })) {
      return publicError(429, "Too many requests. Please try again later or email us.");
    }

    // Server-side catalog lookup against the approved public pricing bundle.
    const itemRows = [];
    for (const item of submission.items) {
      const row = catalogBySku.get(item.public_sku);
      if (!row) {
        return publicError(400, "One or more items are no longer available. Please refresh and try again.");
      }
      itemRows.push(buildQuoteItemSnapshot(row, item.quantity));
    }

    const referenceCode = generateReferenceCode();
    const { data: quoteRequest, error: insertError } = await service
      .from("quote_requests")
      .insert({
        reference_code: referenceCode,
        status: "new",
        customer_name: submission.customer_name,
        customer_email: submission.customer_email,
        customer_phone: submission.customer_phone,
        customer_company: submission.customer_company,
        shipping_address: submission.shipping_address,
        project_notes: submission.project_notes,
        source: "storefront",
        request_ip_hash: ipHash,
        // Which deployed catalog the snapshot came from (Netlify commit ref).
        catalog_version: (process.env.COMMIT_REF || "").slice(0, 40) || null
      })
      .select("id, reference_code")
      .single();
    if (insertError) throw new Error(`quote insert failed: ${insertError.message}`);

    const { error: itemsError } = await service
      .from("quote_request_items")
      .insert(itemRows.map((row) => ({ ...row, quote_request_id: quoteRequest.id })));
    if (itemsError) {
      // Keep the pipeline consistent: a request without items is useless, so
      // roll the header row back and fail the submission.
      await service.from("quote_requests").delete().eq("id", quoteRequest.id);
      throw new Error(`quote items insert failed: ${itemsError.message}`);
    }

    return json(201, { ok: true, reference_code: quoteRequest.reference_code });
  } catch (error) {
    logServerError("submit-quote", error, {});
    return publicError(500, GENERIC_ERROR);
  }
}

export const config = { path: "/api/quote-requests" };

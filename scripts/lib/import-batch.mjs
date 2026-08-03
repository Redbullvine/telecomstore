// ============================================================================
// import-batch.mjs -- pure pre-transaction validation & partitioning.
//
// The loader validates the COMPLETE candidate set before opening a
// transaction, dividing it into approved / rejected / duplicate /
// manual_review. A defective or duplicate record is never imported.
// No I/O, no DB, deterministic.
// ============================================================================

import { mpnKey, looksNonTelecom } from "./petra-transform.mjs";

// Required public fields for an approvable opening product.
function rejectionReason(pub) {
  if (!pub) return "missing_public_block";
  if (!pub.manufacturer_mpn) return "missing_mpn";
  if (!pub.sku) return "missing_public_sku";
  if (!pub.title || !pub.title.trim()) return "missing_title";
  if (!pub.brand || !pub.brand.trim()) return "missing_brand";
  if (!pub.category || !pub.category.trim()) return "missing_category";
  if (pub.public_price !== null) return "public_price_not_null";
  if (pub.price_mode !== "request_quote") return "price_mode_not_quote";
  return null;
}

// Returns { approved, rejected, duplicate, manualReview, counts }.
// Each bucket item is { candidate, reason }.
export function validateBatch(candidates) {
  const approved = [];
  const rejected = [];
  const duplicate = [];
  const manualReview = [];
  const seenPublic = new Set();
  const seenSupplier = new Set();

  for (const c of candidates) {
    const pub = c.public || {};
    const priv = c.private || {};

    const rej = rejectionReason(pub);
    if (rej) {
      rejected.push({ candidate: c, reason: rej });
      continue;
    }

    // Final telecom-relevance gate. Anything carrying a clear non-telecom signal
    // is rejected here, never silently published, even if it reached this file.
    if (looksNonTelecom(`${pub.title} ${pub.category}`)) {
      rejected.push({ candidate: c, reason: "not_clearly_telecom" });
      continue;
    }

    // Public SKU must be the manufacturer MPN and must stay distinct from the
    // private supplier SKU. If they collide, a human must assign a SKU.
    const pk = mpnKey(pub.sku);
    const sk = mpnKey(priv.supplier_sku);
    if (mpnKey(pub.sku) !== mpnKey(pub.manufacturer_mpn)) {
      manualReview.push({ candidate: c, reason: "public_sku_not_mpn" });
      continue;
    }
    if (pk && sk && pk === sk) {
      manualReview.push({ candidate: c, reason: "public_sku_equals_supplier_sku" });
      continue;
    }
    if ((c.review_flags || []).includes("public_sku_review")) {
      manualReview.push({ candidate: c, reason: "flagged_public_sku_review" });
      continue;
    }

    // Duplicate public SKU or supplier SKU within the batch.
    if (pk && seenPublic.has(pk)) {
      duplicate.push({ candidate: c, reason: "duplicate_public_sku" });
      continue;
    }
    if (sk && seenSupplier.has(sk)) {
      duplicate.push({ candidate: c, reason: "duplicate_supplier_sku" });
      continue;
    }

    if (pk) seenPublic.add(pk);
    if (sk) seenSupplier.add(sk);
    approved.push({ candidate: c, reason: "ok" });
  }

  return {
    approved,
    rejected,
    duplicate,
    manualReview,
    counts: {
      total: candidates.length,
      approved: approved.length,
      rejected: rejected.length,
      duplicate: duplicate.length,
      manual_review: manualReview.length,
    },
  };
}

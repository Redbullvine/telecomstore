// Admin Payment Center — quote requests, pricing, Stripe invoices/links,
// payment status, history, and internal notes.
//
// Standalone module: no storefront imports, styles scoped under .pc- classes
// injected locally. Final wiring into the admin router happens during OGT
// integration (see docs/PAYMENTS.md).

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  QUOTE_STATUSES,
  STATUS_LABELS,
  fetchQuoteRequests,
  fetchQuoteDetail,
  fetchPaymentsConfig,
  quoteAction,
  formatMoney,
  toCents,
  centsToDecimal
} from "./payments-api.mjs";

const SCOPED_STYLES = `
.pc-toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
.pc-chip { border: 1px solid #d5dde5; background: #fff; border-radius: 999px; padding: 6px 14px; cursor: pointer; font-size: 13px; }
.pc-chip.active { background: #14202b; color: #fff; border-color: #14202b; }
.pc-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.pc-table th, .pc-table td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #e8edf2; }
.pc-table tbody tr { cursor: pointer; }
.pc-table tbody tr:hover { background: #f4f7fa; }
.pc-status { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; }
.pc-status[data-status="new"] { background: #e8f1fd; color: #1b64c0; }
.pc-status[data-status="reviewing"] { background: #fdf4e0; color: #8a6116; }
.pc-status[data-status="quoted"] { background: #eef2f6; color: #3d4f61; }
.pc-status[data-status="payment_sent"] { background: #f1e9fb; color: #6b3fa0; }
.pc-status[data-status="paid"] { background: #e7f6ee; color: #157347; }
.pc-status[data-status="canceled"] { background: #f4f5f6; color: #6c757d; }
.pc-status[data-status="refunded"] { background: #fdeaea; color: #b02a37; }
.pc-status[data-status="fulfilled"] { background: #e2f4f0; color: #0f766e; }
.pc-detail { display: grid; gap: 16px; }
.pc-grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
.pc-kv { display: grid; grid-template-columns: 130px 1fr; gap: 4px 12px; font-size: 14px; }
.pc-kv span { color: #64748b; }
.pc-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.pc-amounts input { width: 110px; padding: 7px 9px; border: 1px solid #cfd8e0; border-radius: 7px; font-size: 14px; }
.pc-amounts td, .pc-amounts th { padding: 8px 10px; }
.pc-totalbar { display: flex; flex-wrap: wrap; gap: 18px; align-items: center; font-size: 14px; padding: 10px 0; }
.pc-totalbar strong { font-size: 17px; }
.pc-error { background: #fdeaea; color: #b02a37; padding: 10px 14px; border-radius: 8px; font-size: 14px; }
.pc-warn { background: #fdf4e0; color: #8a6116; padding: 10px 14px; border-radius: 8px; font-size: 14px; }
.pc-ok { background: #e7f6ee; color: #157347; padding: 10px 14px; border-radius: 8px; font-size: 14px; }
.pc-note { border-left: 3px solid #d5dde5; padding: 6px 12px; margin: 8px 0; font-size: 14px; }
.pc-history { font-size: 13px; color: #46586a; }
.pc-history li { margin-bottom: 4px; }
.pc-mono { font-family: ui-monospace, monospace; font-size: 12px; word-break: break-all; }
.pc-spin { display: inline-block; animation: pc-rotate 0.9s linear infinite; }
@keyframes pc-rotate { to { transform: rotate(360deg); } }
`;

// Every action button shows pressed/busy feedback: disabled + spinner label
// while its request is in flight.
function ActionButton({ label, busyLabel, onClick, disabled, kind = "" }) {
  const [busy, setBusy] = useState(false);
  const handle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onClick();
    } finally {
      setBusy(false);
    }
  };
  return (
    <button className={`button ${kind}`} type="button" disabled={disabled || busy} onClick={handle}>
      {busy ? <><span className="pc-spin">◌</span> {busyLabel || "Working…"}</> : label}
    </button>
  );
}

function StatusBadge({ status }) {
  return <span className="pc-status" data-status={status}>{STATUS_LABELS[status] || status}</span>;
}

function ConfigBanner() {
  const [audit, setAudit] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetchPaymentsConfig().then(setAudit).catch(() => setFailed(true));
  }, []);

  if (failed) return <p className="pc-warn">Payment server functions are not reachable yet (they deploy with this branch). Stripe actions will be unavailable until then.</p>;
  if (!audit) return null;
  const missing = Object.entries(audit).filter(([, v]) => v.status !== "present").map(([k]) => k);
  if (missing.length === 0) {
    const mode = Object.values(audit).find((entry) => entry.mode)?.mode;
    return <p className="pc-ok">Stripe configuration present{mode ? ` — ${mode} mode` : ""}.</p>;
  }
  return (
    <p className="pc-warn">
      Payment configuration incomplete. Missing: {missing.join(", ")}. Stripe actions stay disabled until these are set in Netlify.
    </p>
  );
}

export default function PaymentCenterPage({ auth }) {
  const [filter, setFilter] = useState("all");
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setRequests(await fetchQuoteRequests({ status: filter }));
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="admin-page pc-root">
      <style>{SCOPED_STYLES}</style>
      <ConfigBanner />
      {selectedId ? (
        <QuoteDetail
          id={selectedId}
          onBack={() => { setSelectedId(null); load(); }}
        />
      ) : (
        <section className="admin-panel">
          <div className="pc-toolbar">
            <button className={filter === "all" ? "pc-chip active" : "pc-chip"} type="button" onClick={() => setFilter("all")}>All</button>
            {QUOTE_STATUSES.map((status) => (
              <button
                key={status}
                className={filter === status ? "pc-chip active" : "pc-chip"}
                type="button"
                onClick={() => setFilter(status)}
              >
                {STATUS_LABELS[status]}
              </button>
            ))}
          </div>
          {error ? <p className="pc-error">{error}</p> : null}
          {loading ? <p>Loading quote requests…</p> : (
            requests.length === 0 ? <p>No quote requests{filter !== "all" ? ` with status ${STATUS_LABELS[filter]}` : ""} yet.</p> : (
              <table className="pc-table">
                <thead>
                  <tr>
                    <th>Reference</th><th>Status</th><th>Customer</th><th>Total</th><th>Received</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((request) => (
                    <tr key={request.id} onClick={() => setSelectedId(request.id)}>
                      <td>{request.reference_code}</td>
                      <td><StatusBadge status={request.status} /></td>
                      <td>{request.customer_name}{request.customer_company ? ` — ${request.customer_company}` : ""}<br /><small>{request.customer_email}</small></td>
                      <td>{formatMoney(request.final_total, request.currency_code)}</td>
                      <td>{new Date(request.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
        </section>
      )}
    </div>
  );
}

function QuoteDetail({ id, onBack }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      setDetail(await fetchQuoteDetail(id));
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const act = useCallback(async (action, body = {}, successNotice = "") => {
    setError("");
    setNotice("");
    try {
      const result = await quoteAction(id, action, body);
      if (successNotice) setNotice(successNotice);
      if (result.hosted_invoice_url) setNotice(`Invoice sent. Hosted invoice: ${result.hosted_invoice_url}`);
      if (result.payment_link_url) setNotice(`Payment link ready: ${result.payment_link_url}`);
      if (result.checkout_session_url) setNotice(`${result.reused ? "Existing checkout session (still open)" : "Checkout session ready"}: ${result.checkout_session_url}`);
      await load();
      return result;
    } catch (actionError) {
      setError(actionError.message);
      throw actionError;
    }
  }, [id, load]);

  if (error && !detail) {
    return (
      <section className="admin-panel">
        <p className="pc-error">{error}</p>
        <button className="button" type="button" onClick={onBack}>Back to list</button>
      </section>
    );
  }
  if (!detail) return <p>Loading request…</p>;

  const { request, items, payments, history, notes } = detail;
  const address = request.shipping_address || {};

  return (
    <div className="pc-detail">
      <section className="admin-panel">
        <div className="panel-heading" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <h2>{request.reference_code} <StatusBadge status={request.status} /></h2>
          <button className="button" type="button" onClick={onBack}>← All requests</button>
        </div>
        {error ? <p className="pc-error">{error}</p> : null}
        {notice ? <p className="pc-ok">{notice}</p> : null}
        <div className="pc-grid2">
          <div className="pc-kv">
            <span>Customer</span><b>{request.customer_name}</b>
            <span>Company</span><b>{request.customer_company || "—"}</b>
            <span>Email</span><b>{request.customer_email}</b>
            <span>Phone</span><b>{request.customer_phone}</b>
            <span>Received</span><b>{new Date(request.created_at).toLocaleString()}</b>
            <span>Source</span><b>{request.source}</b>
          </div>
          <div className="pc-kv">
            <span>Ship to</span>
            <b>
              {address.line1 || "—"}{address.line2 ? `, ${address.line2}` : ""}<br />
              {address.city ? `${address.city}, ${address.state} ${address.postal_code}` : ""}<br />
              {address.country || ""}
            </b>
            <span>Project notes</span><b>{request.project_notes || "—"}</b>
          </div>
        </div>
      </section>

      <AmountsPanel request={request} items={items} act={act} />

      <section className="admin-panel">
        <div className="panel-heading"><h2>Payment</h2></div>
        <div className="pc-kv">
          <span>Final total</span><b>{formatMoney(request.final_total, request.currency_code)}</b>
          <span>Quote valid until</span>
          <b>{request.quote_expires_at
            ? `${new Date(request.quote_expires_at).toLocaleDateString()}${new Date(request.quote_expires_at) <= new Date() ? " — EXPIRED (re-price to renew)" : ""}`
            : "—"}</b>
          <span>Invoice ID</span><b className="pc-mono">{request.stripe_invoice_id || "—"}</b>
          <span>Payment link</span><b className="pc-mono">{request.stripe_payment_link_url || request.stripe_payment_link_id || "—"}</b>
          <span>Checkout session</span><b className="pc-mono">{request.stripe_checkout_session_url || request.stripe_checkout_session_id || "—"}</b>
          <span>Payment intent</span><b className="pc-mono">{request.stripe_payment_intent_id || "—"}</b>
        </div>
        <div className="pc-actions" style={{ marginTop: 14 }}>
          {request.status === "new" ? (
            <ActionButton kind="primary" label="Start Review" busyLabel="Starting…" onClick={() => act("review", {}, "Request moved to Reviewing.")} />
          ) : null}
          {request.status === "quoted" ? (
            <>
              <ActionButton kind="primary" label="Create Checkout Session" busyLabel="Creating session…" onClick={() => act("checkout-session")} />
              <ActionButton kind="primary" label="Create Stripe Invoice" busyLabel="Creating invoice…" onClick={() => act("invoice")} />
              <ActionButton label="Create Payment Link" busyLabel="Creating link…" onClick={() => act("payment-link")} />
            </>
          ) : null}
          {request.status === "payment_sent" ? (
            <ActionButton label="Resend Payment" busyLabel="Resending…" onClick={() => act("resend", {}, "Payment resent / link retrieved.")} />
          ) : null}
          {request.status === "paid" ? (
            <ActionButton kind="primary" label="Mark Fulfilled" busyLabel="Updating…" onClick={() => act("fulfill", {}, "Marked fulfilled.")} />
          ) : null}
          {["paid", "fulfilled"].includes(request.status) ? (
            <ActionButton label="Record Refund" busyLabel="Recording…" onClick={() => act("refund", {}, "Refund recorded.")} />
          ) : null}
          {["new", "reviewing", "quoted", "payment_sent"].includes(request.status) ? (
            <ActionButton label="Cancel Request" busyLabel="Canceling…" onClick={() => act("cancel", {}, "Request canceled.")} />
          ) : null}
        </div>
        {payments.length ? (
          <>
            <h3 style={{ marginTop: 18 }}>Payment records</h3>
            <table className="pc-table">
              <thead><tr><th>Type</th><th>Stripe ID</th><th>Amount</th><th>Status</th><th>Mode</th><th>Created</th></tr></thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id} style={{ cursor: "default" }}>
                    <td>{payment.stripe_object_type}</td>
                    <td className="pc-mono">{payment.stripe_object_id}</td>
                    <td>{formatMoney(payment.amount, payment.currency_code)}</td>
                    <td>{payment.status}</td>
                    <td>{payment.livemode ? "live" : "test"}</td>
                    <td>{new Date(payment.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}
      </section>

      <section className="admin-panel pc-grid2">
        <div>
          <div className="panel-heading"><h2>Status history</h2></div>
          <ul className="pc-history">
            {history.map((entry) => (
              <li key={entry.id}>
                {new Date(entry.created_at).toLocaleString()} — {entry.from_status ? `${STATUS_LABELS[entry.from_status]} → ` : ""}{STATUS_LABELS[entry.to_status] || entry.to_status}
                {entry.changed_by ? "" : " (system)"}{entry.note ? ` · ${entry.note}` : ""}
              </li>
            ))}
            {history.length === 0 ? <li>No transitions yet.</li> : null}
          </ul>
        </div>
        <NotesPanel notes={notes} act={act} />
      </section>
    </div>
  );
}

function AmountsPanel({ request, items, act }) {
  const editable = ["reviewing", "quoted"].includes(request.status);
  const [unitAmounts, setUnitAmounts] = useState(() => Object.fromEntries(
    items.map((item) => [item.id, item.unit_amount ?? item.public_unit_price ?? ""])
  ));
  const [shipping, setShipping] = useState(request.shipping_amount ?? "");
  const [tax, setTax] = useState(request.tax_amount ?? "");
  const [expires, setExpires] = useState(request.quote_expires_at ? request.quote_expires_at.slice(0, 10) : "");

  useEffect(() => {
    setUnitAmounts(Object.fromEntries(items.map((item) => [item.id, item.unit_amount ?? item.public_unit_price ?? ""])));
    setShipping(request.shipping_amount ?? "");
    setTax(request.tax_amount ?? "");
    setExpires(request.quote_expires_at ? request.quote_expires_at.slice(0, 10) : "");
  }, [request.id, request.status]);

  const subtotalCents = useMemo(() => {
    let sum = 0;
    for (const item of items) {
      const cents = toCents(unitAmounts[item.id]);
      if (cents === null) return null;
      sum += cents * item.quantity;
    }
    return sum;
  }, [items, unitAmounts]);

  const shippingCents = toCents(shipping === "" ? null : shipping);
  const taxCents = toCents(tax === "" ? null : tax);
  const totalCents = subtotalCents !== null && shippingCents !== null && taxCents !== null
    ? subtotalCents + shippingCents + taxCents
    : null;

  const save = () => act("amounts", {
    product_subtotal: centsToDecimal(subtotalCents),
    shipping_amount: centsToDecimal(shippingCents),
    tax_amount: centsToDecimal(taxCents),
    final_total: centsToDecimal(totalCents),
    quote_expires_at: expires ? `${expires}T23:59:59Z` : null,
    items: items.map((item) => ({ id: item.id, unit_amount: String(unitAmounts[item.id]).trim() }))
  }, "Amounts saved — request is now Quoted.");

  return (
    <section className="admin-panel">
      <div className="panel-heading"><h2>Requested products</h2></div>
      <table className="pc-table pc-amounts">
        <thead>
          <tr><th>Product</th><th>SKU</th><th>MPN</th><th>GTIN</th><th>Qty</th><th>Unit price</th><th>Line total</th></tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const unitCents = toCents(unitAmounts[item.id]);
            return (
              <tr key={item.id} style={{ cursor: "default" }}>
                <td>
                  {item.product_url ? <a href={item.product_url} target="_blank" rel="noreferrer">{item.product_title}</a> : item.product_title}
                </td>
                <td>{item.product_sku || "—"}</td>
                <td>{item.manufacturer_mpn || "—"}</td>
                <td>{item.gtin || "—"}</td>
                <td>{item.quantity}</td>
                <td>
                  {editable ? (
                    <input
                      inputMode="decimal"
                      placeholder="0.00"
                      value={unitAmounts[item.id]}
                      onChange={(event) => setUnitAmounts((current) => ({ ...current, [item.id]: event.target.value }))}
                    />
                  ) : formatMoney(item.unit_amount, request.currency_code)}
                </td>
                <td>{unitCents !== null ? formatMoney(centsToDecimal(unitCents * item.quantity), request.currency_code) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="pc-totalbar">
        <span>Subtotal: <b>{subtotalCents !== null ? formatMoney(centsToDecimal(subtotalCents), request.currency_code) : "—"}</b></span>
        {editable ? (
          <>
            <span className="pc-amounts">Shipping: <input inputMode="decimal" placeholder="0.00" value={shipping} onChange={(e) => setShipping(e.target.value)} /></span>
            <span className="pc-amounts">Tax: <input inputMode="decimal" placeholder="0.00" value={tax} onChange={(e) => setTax(e.target.value)} /></span>
            <span className="pc-amounts">Quote valid until: <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></span>
          </>
        ) : (
          <>
            <span>Shipping: <b>{formatMoney(request.shipping_amount, request.currency_code)}</b></span>
            <span>Tax: <b>{formatMoney(request.tax_amount, request.currency_code)}</b></span>
          </>
        )}
        <span>Final total: <strong>{totalCents !== null ? formatMoney(centsToDecimal(totalCents), request.currency_code) : formatMoney(request.final_total, request.currency_code)}</strong></span>
        {editable ? (
          <ActionButton
            kind="primary"
            label={request.status === "quoted" ? "Update Amounts" : "Save Amounts → Quote"}
            busyLabel="Saving…"
            disabled={totalCents === null || totalCents === 0}
            onClick={save}
          />
        ) : null}
      </div>
      {editable && totalCents === null ? <p className="pc-warn">Enter a unit price for every line plus shipping and tax (use 0.00 where nothing applies).</p> : null}
    </section>
  );
}

function NotesPanel({ notes, act }) {
  const [draft, setDraft] = useState("");
  return (
    <div>
      <div className="panel-heading"><h2>Internal notes</h2></div>
      <p style={{ fontSize: 13, color: "#64748b" }}>Never shown to customers.</p>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input
          style={{ flex: 1, padding: "8px 10px", border: "1px solid #cfd8e0", borderRadius: 7 }}
          placeholder="Add an internal note…"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <ActionButton
          label="Add"
          busyLabel="Adding…"
          disabled={!draft.trim()}
          onClick={async () => { await act("note", { body: draft }, "Note added."); setDraft(""); }}
        />
      </div>
      {notes.map((note) => (
        <div className="pc-note" key={note.id}>
          {note.body}
          <br /><small>{new Date(note.created_at).toLocaleString()}</small>
        </div>
      ))}
    </div>
  );
}

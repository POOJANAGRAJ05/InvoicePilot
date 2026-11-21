import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchInvoiceMatches, fetchInvoices, fetchPurchaseOrders, matchInvoiceToPurchaseOrder } from "../api/invoices";

function money(value) {
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(number) : "—";
}
function errorMessage(error) {
  const data = error?.response?.data;
  if (!data) return "The request could not be completed. Check the backend connection.";
  return typeof data.detail === "string" ? data.detail : Object.values(data).flat().join(" ");
}
function resultStyle(result) {
  if (result === "MATCHED") return "bg-emerald-50 text-emerald-700";
  if (result === "PARTIAL_MATCH") return "bg-amber-50 text-amber-800";
  if (result === "MISMATCH") return "bg-rose-50 text-rose-700";
  return "bg-slate-100 text-slate-700";
}

function POMatching() {
  const [invoices, setInvoices] = useState([]);
  const [orders, setOrders] = useState([]);
  const [matches, setMatches] = useState([]);
  const [invoiceId, setInvoiceId] = useState("");
  const [purchaseOrderId, setPurchaseOrderId] = useState("");
  const [invoicePoNumber, setInvoicePoNumber] = useState("");
  const [loading, setLoading] = useState(true);
  const [matching, setMatching] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [invoiceData, poData, matchData] = await Promise.all([
        fetchInvoices(), fetchPurchaseOrders(), fetchInvoiceMatches(),
      ]);
      setInvoices(Array.isArray(invoiceData) ? invoiceData : invoiceData.results || []);
      setOrders(Array.isArray(poData) ? poData : poData.results || []);
      setMatches(Array.isArray(matchData) ? matchData : matchData.results || []);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { loadData(); }, [loadData]);

  const selectedInvoice = useMemo(() => invoices.find((invoice) => String(invoice.id) === invoiceId), [invoices, invoiceId]);
  const availableOrders = useMemo(() => orders.filter((order) => order.status !== "CANCELLED"), [orders]);
  const runMatch = async (event) => {
    event.preventDefault();
    if (!invoiceId || !purchaseOrderId) { setError("Select both an invoice and a purchase order."); return; }
    setMatching(true);
    setError("");
    setMessage("");
    try {
      const result = await matchInvoiceToPurchaseOrder(purchaseOrderId, invoiceId, invoicePoNumber);
      setMessage(`Matching completed: ${result.result.replaceAll("_", " ")}. This does not approve or pay the invoice.`);
      await loadData();
    } catch (requestError) { setError(errorMessage(requestError)); }
    finally { setMatching(false); }
  };

  return (
    <section className="space-y-6 p-5 md:p-8">
      <header><p className="text-sm font-semibold text-blue-600">Procurement controls</p><h1 className="mt-1 text-2xl font-bold text-slate-900">Invoice-to-PO matching</h1><p className="mt-1 max-w-3xl text-sm text-slate-500">Compare a saved invoice with a purchase order. Matching is an advisory result only; it never approves or pays an invoice.</p></header>
      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800" role="alert">{error}<button className="ml-3 font-semibold underline" onClick={loadData} type="button">Retry</button></div>}
      {message && <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800" role="status">{message}</div>}
      <form className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-3" onSubmit={runMatch}>
        <label><span className="mb-1 block text-sm font-medium text-slate-700">Invoice</span><select className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" onChange={(event) => { const selected = invoices.find((invoice) => String(invoice.id) === event.target.value); setInvoiceId(event.target.value); setInvoicePoNumber(selected?.purchase_order_number || ""); }} required value={invoiceId}><option value="">Select invoice</option>{invoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoice_number || `Invoice #${invoice.id}`} · {invoice.vendor_name || "Unknown vendor"} · {invoice.status}</option>)}</select></label>
        <label><span className="mb-1 block text-sm font-medium text-slate-700">Purchase order</span><select className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" onChange={(event) => setPurchaseOrderId(event.target.value)} required value={purchaseOrderId}><option value="">Select PO</option>{availableOrders.map((order) => <option key={order.id} value={order.id}>{order.po_number} · {order.vendor_name} · {order.status}</option>)}</select></label>
          <label><span className="mb-1 block text-sm font-medium text-slate-700">PO number shown on invoice</span><input className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" onChange={(event) => setInvoicePoNumber(event.target.value)} placeholder="OCR value or enter from invoice" value={invoicePoNumber} /></label>
        <div className="flex items-end"><button className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50" disabled={matching || loading} type="submit">{matching ? "Comparing…" : "Compare invoice & PO"}</button></div>
        {selectedInvoice && <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700 md:col-span-3"><span className="font-semibold">Selected invoice:</span> {selectedInvoice.invoice_number || `#${selectedInvoice.id}`} · {selectedInvoice.vendor_details?.name || selectedInvoice.vendor_name || "Unknown vendor"} · Total {money(selectedInvoice.total_amount)} · PO reference {selectedInvoice.purchase_order_number || "Not recorded"}</div>}
      </form>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 px-5 py-4"><h2 className="font-bold text-slate-900">Match history</h2><p className="mt-1 text-sm text-slate-500">Previous comparison results are saved and remain available.</p></div>{loading ? <div className="p-8 text-center text-slate-500">Loading match history…</div> : matches.length === 0 ? <div className="p-12 text-center"><p className="font-semibold">No matches recorded yet</p><p className="mt-1 text-sm text-slate-500">Select an invoice and PO above to run the first comparison.</p></div> : <div className="divide-y divide-slate-100">{matches.map((match) => <article className="p-5" key={match.id}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold text-slate-900">Invoice #{match.invoice} · {match.purchase_order_number}</p><p className="mt-1 text-xs text-slate-500">Compared {new Date(match.created_at).toLocaleString()}</p></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${resultStyle(match.result)}`}>{match.result.replaceAll("_", " ")}</span></div><ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">{match.explanations.map((item, index) => <li className="rounded-lg bg-slate-50 p-3 text-sm" key={`${match.id}-${item.check}-${index}`}><p className="font-semibold capitalize text-slate-700">{item.check.replaceAll("_", " ")}: {item.passed === null ? "Not available" : item.passed ? "Pass" : "Review"}</p><p className="mt-1 text-slate-600">{item.message}</p></li>)}</ul></article>)}</div>}</section>
    </section>
  );
}

export default POMatching;

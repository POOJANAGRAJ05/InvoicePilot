import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchPurchaseOrders, fetchVendors, performPurchaseOrderAction, savePurchaseOrder, transitionPurchaseOrder } from "../api/invoices";

const emptyItem = () => ({ description: "", quantity: "1", unit_price: "0.00", tax_rate: "0.00" });
const emptyForm = () => ({ po_number: "", vendor: "", po_date: new Date().toISOString().slice(0, 10), expected_delivery_date: "", notes: "", line_items: [emptyItem()] });

function money(value) {
  const number = Number(value || 0);
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(number);
}
function errorMessage(error) {
  const data = error?.response?.data;
  if (!data) return "The request could not be completed. Check the backend connection.";
  if (typeof data.detail === "string") return data.detail;
  return Object.values(data).flat().map((entry) => typeof entry === "string" ? entry : JSON.stringify(entry)).join(" ");
}
function statusClass(status) {
  if (["ISSUED", "PARTIALLY_RECEIVED"].includes(status)) return "bg-blue-50 text-blue-700";
  if (status === "RECEIVED" || status === "CLOSED") return "bg-emerald-50 text-emerald-700";
  if (status === "CANCELLED") return "bg-rose-50 text-rose-700";
  return "bg-slate-100 text-slate-700";
}
function lineTotal(item) {
  const subtotal = (Number(item.quantity) || 0) * (Number(item.unit_price) || 0);
  return subtotal + subtotal * (Number(item.tax_rate) || 0) / 100;
}

function PurchaseOrders() {
  const [orders, setOrders] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [form, setForm] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [selected, setSelected] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [orderData, vendorData] = await Promise.all([fetchPurchaseOrders(), fetchVendors()]);
      setOrders(Array.isArray(orderData) ? orderData : orderData.results || []);
      setVendors((Array.isArray(vendorData) ? vendorData : vendorData.results || []).filter((vendor) => vendor.status === "ACTIVE"));
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { loadData(); }, [loadData]);

  const filteredOrders = useMemo(() => orders.filter((order) => {
    const term = search.trim().toLowerCase();
    const textMatch = !term || order.po_number.toLowerCase().includes(term) || (order.vendor_name || "").toLowerCase().includes(term) || (order.vendor_code || "").toLowerCase().includes(term);
    return textMatch && (!statusFilter || order.status === statusFilter);
  }), [orders, search, statusFilter]);

  const totals = useMemo(() => ({
    all: orders.length,
    drafts: orders.filter((order) => order.status === "DRAFT").length,
    issued: orders.filter((order) => ["ISSUED", "PARTIALLY_RECEIVED"].includes(order.status)).length,
    value: orders.filter((order) => order.status !== "CANCELLED").reduce((sum, order) => sum + (Number(order.total_amount) || 0), 0),
  }), [orders]);

  const startCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setMessage("");
    setError("");
  };
  const startEdit = (order) => {
    setEditingId(order.id);
    setForm({
      po_number: order.po_number,
      vendor: String(order.vendor),
      po_date: order.po_date,
      expected_delivery_date: order.expected_delivery_date || "",
      notes: order.notes || "",
      line_items: order.line_items.map((item) => ({ description: item.description, quantity: String(item.quantity), unit_price: String(item.unit_price), tax_rate: String(item.tax_rate) })),
    });
    setMessage("");
  };
  const updateItem = (index, key, value) => setForm((previous) => ({
    ...previous,
    line_items: previous.line_items.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item),
  }));
  const removeItem = (index) => setForm((previous) => ({ ...previous, line_items: previous.line_items.filter((_, itemIndex) => itemIndex !== index) }));

  const submitForm = async (event) => {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const payload = {
        ...form,
        vendor: Number(form.vendor),
        expected_delivery_date: form.expected_delivery_date || null,
        line_items: form.line_items.map((item) => ({ ...item, quantity: String(item.quantity), unit_price: String(item.unit_price), tax_rate: String(item.tax_rate) })),
      };
      const saved = await savePurchaseOrder(payload, editingId);
      setMessage(`${saved.po_number} ${editingId ? "updated" : "created"}.`);
      setForm(null);
      setEditingId(null);
      await loadData();
    } catch (requestError) {
      setMessage(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  };

  const issueOrder = async (order) => {
    if (!window.confirm(`Issue purchase order ${order.po_number}? Issued purchase orders can no longer be edited.`)) return;
    setSaving(true);
    try {
      await performPurchaseOrderAction(order.id, "issue");
      setMessage(`${order.po_number} issued successfully.`);
      await loadData();
      if (selected?.id === order.id) setSelected((await fetchPurchaseOrders()).find((item) => item.id === order.id) || null);
    } catch (requestError) { setMessage(errorMessage(requestError)); }
    finally { setSaving(false); }
  };

  const cancelOrder = async (order) => {
    const reason = window.prompt(`Why are you cancelling ${order.po_number}?`);
    if (reason === null) return;
    if (!reason.trim()) { setMessage("Enter a cancellation reason."); return; }
    if (!window.confirm(`Confirm cancellation of ${order.po_number}?`)) return;
    setSaving(true);
    try {
      await performPurchaseOrderAction(order.id, "cancel", { reason: reason.trim() });
      setMessage(`${order.po_number} cancelled.`);
      await loadData();
      if (selected?.id === order.id) setSelected(null);
    } catch (requestError) { setMessage(errorMessage(requestError)); }
    finally { setSaving(false); }
  };

  const advanceOrder = async (order, nextStatus, label) => {
    if (!window.confirm(`${label} ${order.po_number}?`)) return;
    setSaving(true);
    try {
      await transitionPurchaseOrder(order.id, nextStatus);
      setMessage(`${order.po_number} marked ${label.toLowerCase()}.`);
      await loadData();
      if (selected?.id === order.id) {
        const refreshed = await fetchPurchaseOrders();
        setSelected((Array.isArray(refreshed) ? refreshed : refreshed.results || []).find((item) => item.id === order.id) || null);
      }
    } catch (requestError) { setMessage(errorMessage(requestError)); }
    finally { setSaving(false); }
  };

  return (
    <section className="space-y-6 p-5 md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-semibold text-blue-600">Procurement</p><h1 className="mt-1 text-2xl font-bold text-slate-900">Purchase orders</h1><p className="mt-1 text-sm text-slate-500">Create, issue, and track vendor purchase commitments.</p></div><button className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700" onClick={startCreate} type="button">+ Create purchase order</button></header>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{[["Purchase orders", totals.all], ["Draft", totals.drafts], ["Issued / in progress", totals.issued], ["Non-cancelled PO value", money(totals.value)]].map(([label, value]) => <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" key={label}><p className="text-sm text-slate-500">{label}</p><p className="mt-3 text-2xl font-bold text-slate-900">{loading ? "…" : value}</p></article>)}</div>
      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800" role="alert">{error}<button className="ml-3 font-semibold underline" onClick={loadData} type="button">Retry</button></div>}
      {message && <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800" role="status">{message}</div>}

      {form && <form className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:p-6" onSubmit={submitForm}>
        <div className="flex items-center justify-between"><div><h2 className="text-lg font-bold">{editingId ? "Edit draft PO" : "New purchase order"}</h2><p className="mt-1 text-sm text-slate-500">Totals are calculated on the server from line items.</p></div><button className="text-sm font-semibold text-slate-500" onClick={() => setForm(null)} type="button">Close</button></div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label><span className="mb-1 block text-sm font-medium">PO number (optional)</span><input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" onChange={(event) => setForm((previous) => ({ ...previous, po_number: event.target.value }))} placeholder="Auto-generated if blank" value={form.po_number} /></label>
          <label><span className="mb-1 block text-sm font-medium">Vendor *</span><select className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" onChange={(event) => setForm((previous) => ({ ...previous, vendor: event.target.value }))} required value={form.vendor}><option value="">Select active vendor</option>{vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name} · {vendor.vendor_code}</option>)}</select></label>
          <label><span className="mb-1 block text-sm font-medium">PO date *</span><input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" onChange={(event) => setForm((previous) => ({ ...previous, po_date: event.target.value }))} required type="date" value={form.po_date} /></label>
          <label><span className="mb-1 block text-sm font-medium">Expected delivery</span><input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" onChange={(event) => setForm((previous) => ({ ...previous, expected_delivery_date: event.target.value }))} type="date" value={form.expected_delivery_date} /></label>
        </div>
        <div><div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">Line items</h3><button className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold" onClick={() => setForm((previous) => ({ ...previous, line_items: [...previous.line_items, emptyItem()] }))} type="button">+ Add line</button></div>
          <div className="space-y-3">{form.line_items.map((item, index) => <div className="grid grid-cols-1 gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-2 lg:grid-cols-6" key={index}><label className="sm:col-span-2"><span className="mb-1 block text-xs text-slate-500">Description *</span><input className="w-full rounded border border-slate-300 bg-white px-2 py-2 text-sm" onChange={(event) => updateItem(index, "description", event.target.value)} required value={item.description} /></label><label><span className="mb-1 block text-xs text-slate-500">Quantity *</span><input className="w-full rounded border border-slate-300 bg-white px-2 py-2 text-sm" min="0.001" onChange={(event) => updateItem(index, "quantity", event.target.value)} required step="0.001" type="number" value={item.quantity} /></label><label><span className="mb-1 block text-xs text-slate-500">Unit price *</span><input className="w-full rounded border border-slate-300 bg-white px-2 py-2 text-sm" min="0" onChange={(event) => updateItem(index, "unit_price", event.target.value)} required step="0.01" type="number" value={item.unit_price} /></label><label><span className="mb-1 block text-xs text-slate-500">Tax % *</span><input className="w-full rounded border border-slate-300 bg-white px-2 py-2 text-sm" max="100" min="0" onChange={(event) => updateItem(index, "tax_rate", event.target.value)} required step="0.01" type="number" value={item.tax_rate} /></label><div className="flex items-end justify-between gap-2"><span className="pb-2 text-xs text-slate-600">Est. total {money(lineTotal(item))}</span><button aria-label="Remove line item" className="pb-2 text-sm font-semibold text-rose-600 disabled:opacity-40" disabled={form.line_items.length === 1} onClick={() => removeItem(index)} type="button">Remove</button></div></div>)}</div>
        </div>
        <label className="block"><span className="mb-1 block text-sm font-medium">Notes</span><textarea className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" onChange={(event) => setForm((previous) => ({ ...previous, notes: event.target.value }))} rows={2} value={form.notes} /></label>
        <div className="flex gap-2"><button className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={saving || !vendors.length} type="submit">{saving ? "Saving…" : "Save draft"}</button><button className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold" onClick={() => setForm(null)} type="button">Cancel</button></div>
        {!vendors.length && <p className="text-sm text-amber-700">Add an active vendor before creating a purchase order.</p>}
      </form>}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="grid grid-cols-1 gap-3 border-b border-slate-200 bg-slate-50 p-4 sm:grid-cols-3"><input className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm sm:col-span-2" onChange={(event) => setSearch(event.target.value)} placeholder="Search PO number or vendor" value={search} /><select className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}><option value="">All statuses</option>{["DRAFT", "ISSUED", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED", "CANCELLED"].map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select></div>
        {loading ? <div className="p-8 text-center text-slate-500">Loading purchase orders…</div> : filteredOrders.length === 0 ? <div className="p-12 text-center"><p className="font-semibold">No purchase orders found</p><p className="mt-1 text-sm text-slate-500">Create a draft PO to get started.</p></div> : <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left text-sm"><thead className="bg-white text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">PO number</th><th className="px-4 py-3">Vendor</th><th className="px-4 py-3">PO date</th><th className="px-4 py-3">Delivery</th><th className="px-4 py-3">Items</th><th className="px-4 py-3">Total</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Actions</th></tr></thead><tbody className="divide-y divide-slate-100">{filteredOrders.map((order) => <tr className="hover:bg-slate-50" key={order.id}><td className="px-4 py-3"><button className="font-semibold text-blue-700 hover:underline" onClick={() => setSelected(order)} type="button">{order.po_number}</button></td><td className="px-4 py-3">{order.vendor_name} <span className="text-xs text-slate-400">{order.vendor_code}</span></td><td className="px-4 py-3">{order.po_date}</td><td className="px-4 py-3">{order.expected_delivery_date || "—"}</td><td className="px-4 py-3">{order.line_items.length}</td><td className="px-4 py-3 font-semibold">{money(order.total_amount)}</td><td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(order.status)}`}>{order.status.replaceAll("_", " ")}</span></td><td className="px-4 py-3"><div className="flex flex-wrap gap-3">{order.status === "DRAFT" && <><button className="font-semibold text-blue-700" onClick={() => startEdit(order)} type="button">Edit</button><button className="font-semibold text-emerald-700" disabled={saving} onClick={() => issueOrder(order)} type="button">Issue</button></>}{order.status === "ISSUED" && <><button className="font-semibold text-amber-700" disabled={saving} onClick={() => advanceOrder(order, "PARTIALLY_RECEIVED", "Mark partially received")} type="button">Partially received</button><button className="font-semibold text-emerald-700" disabled={saving} onClick={() => advanceOrder(order, "RECEIVED", "Mark received")} type="button">Received</button></>}{order.status === "PARTIALLY_RECEIVED" && <button className="font-semibold text-emerald-700" disabled={saving} onClick={() => advanceOrder(order, "RECEIVED", "Mark received")} type="button">Received</button>}{order.status === "RECEIVED" && <button className="font-semibold text-blue-700" disabled={saving} onClick={() => advanceOrder(order, "CLOSED", "Close purchase order")} type="button">Close PO</button>}{!["CANCELLED", "CLOSED"].includes(order.status) && <button className="font-semibold text-rose-600" disabled={saving} onClick={() => cancelOrder(order)} type="button">Cancel</button>}</div></td></tr>)}</tbody></table></div>}
      </section>

      {selected && <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }} role="presentation"><section aria-modal="true" className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl bg-white p-6 shadow-2xl" role="dialog"><div className="flex justify-between gap-3"><div><p className="text-xs font-semibold uppercase text-blue-600">Purchase order details</p><h2 className="mt-1 text-xl font-bold">{selected.po_number}</h2></div><button className="text-sm font-semibold text-slate-500" onClick={() => setSelected(null)} type="button">Close</button></div><div className="mt-4 grid grid-cols-2 gap-3 text-sm"><p><span className="text-slate-500">Vendor:</span> {selected.vendor_name}</p><p><span className="text-slate-500">Status:</span> {selected.status}</p><p><span className="text-slate-500">PO date:</span> {selected.po_date}</p><p><span className="text-slate-500">Expected:</span> {selected.expected_delivery_date || "—"}</p></div><div className="mt-5 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Description</th><th className="py-2">Quantity</th><th className="py-2">Unit price</th><th className="py-2">Tax</th><th className="py-2">Total</th></tr></thead><tbody className="divide-y">{selected.line_items.map((item) => <tr key={item.id}><td className="py-2">{item.description}</td><td className="py-2">{item.quantity}</td><td className="py-2">{money(item.unit_price)}</td><td className="py-2">{item.tax_rate}% · {money(item.tax_amount)}</td><td className="py-2 font-semibold">{money(item.total)}</td></tr>)}</tbody></table></div><div className="mt-4 ml-auto max-w-xs space-y-1 text-right text-sm"><p>Subtotal: {money(selected.subtotal_amount)}</p><p>Tax: {money(selected.tax_amount)}</p><p className="text-base font-bold">Total: {money(selected.total_amount)}</p></div>{selected.cancellation_reason && <p className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">Cancellation reason: {selected.cancellation_reason}</p>}{selected.notes && <p className="mt-4 text-sm text-slate-600">Notes: {selected.notes}</p>}</section></div>}
    </section>
  );
}

export default PurchaseOrders;

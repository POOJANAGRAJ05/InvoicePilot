import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchVendor, fetchVendors, saveVendor, setVendorActive } from "../api/invoices";

const emptyVendor = {
  name: "", vendor_code: "", email: "", phone_number: "", tax_registration_number: "",
  contact_person: "", address: "", payment_terms: "Net 30", bank_name: "",
  account_holder_name: "", bank_account_number: "", ifsc_code: "", status: "ACTIVE",
};

function money(value) {
  const number = Number(value || 0);
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(number);
}

function apiError(error) {
  const data = error?.response?.data;
  if (!data) return "The request could not be completed. Check the backend connection.";
  if (typeof data.detail === "string") return data.detail;
  return Object.values(data).flat().join(" ");
}

function Vendors() {
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [form, setForm] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [selectedVendor, setSelectedVendor] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const loadVendors = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchVendors();
      setVendors(Array.isArray(data) ? data : data.results || []);
    } catch (requestError) {
      setError(apiError(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadVendors(); }, [loadVendors]);

  const filteredVendors = useMemo(() => vendors.filter((vendor) => {
    const term = search.trim().toLowerCase();
    const matchesText = !term || [vendor.name, vendor.vendor_code, vendor.email, vendor.tax_registration_number]
      .some((value) => (value || "").toLowerCase().includes(term));
    return matchesText && (!statusFilter || vendor.status === statusFilter);
  }), [vendors, search, statusFilter]);

  const startCreate = () => { setEditingId(null); setForm({ ...emptyVendor }); setMessage(""); };

  const startEdit = async (vendor) => {
    setSaving(true);
    try {
      const details = await fetchVendor(vendor.id);
      setEditingId(vendor.id);
      setForm({ ...emptyVendor, ...details });
      setMessage("");
    } catch (requestError) {
      setError(apiError(requestError));
    } finally {
      setSaving(false);
    }
  };

  const openDetails = async (vendor) => {
    setSaving(true);
    try {
      setSelectedVendor(await fetchVendor(vendor.id));
    } catch (requestError) {
      setError(apiError(requestError));
    } finally {
      setSaving(false);
    }
  };

  const submitVendor = async (event) => {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const saved = await saveVendor(form, editingId);
      setMessage(`${saved.name} ${editingId ? "updated" : "added"} successfully.`);
      setForm(null);
      setEditingId(null);
      await loadVendors();
    } catch (requestError) {
      setMessage(apiError(requestError));
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (vendor) => {
    const activating = vendor.status !== "ACTIVE";
    if (!window.confirm(`${activating ? "Activate" : "Deactivate"} ${vendor.name}?`)) return;
    setSaving(true);
    setMessage("");
    try {
      await setVendorActive(vendor.id, activating);
      setMessage(`${vendor.name} ${activating ? "activated" : "deactivated"}.`);
      await loadVendors();
      if (selectedVendor?.id === vendor.id) setSelectedVendor(await fetchVendor(vendor.id));
    } catch (requestError) {
      setMessage(apiError(requestError));
    } finally {
      setSaving(false);
    }
  };

  const totals = useMemo(() => ({
    count: vendors.length,
    active: vendors.filter((vendor) => vendor.status === "ACTIVE").length,
    invoices: vendors.reduce((sum, vendor) => sum + (Number(vendor.invoice_count) || 0), 0),
    outstanding: vendors.reduce((sum, vendor) => sum + (Number(vendor.outstanding_amount) || 0), 0),
  }), [vendors]);

  return (
    <section className="space-y-6 p-5 md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-blue-600">Supplier directory</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Vendor management</h1>
          <p className="mt-1 text-sm text-slate-500">Manage vendor records and review linked invoice activity.</p>
        </div>
        <button className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700" onClick={startCreate} type="button">+ Add vendor</button>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Vendors", totals.count], ["Active vendors", totals.active], ["Linked invoices", totals.invoices], ["Approved outstanding", money(totals.outstanding)],
        ].map(([label, value]) => <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" key={label}><p className="text-sm text-slate-500">{label}</p><p className="mt-3 text-2xl font-bold text-slate-900">{loading ? "…" : value}</p></article>)}
      </div>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800" role="alert">{error}<button className="ml-3 font-semibold underline" onClick={loadVendors} type="button">Retry</button></div>}
      {message && <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800" role="status">{message}</div>}

      {form && (
        <form className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:p-6" onSubmit={submitVendor}>
          <div className="mb-5 flex items-center justify-between gap-3"><div><h2 className="text-lg font-bold text-slate-900">{editingId ? "Edit vendor" : "Add vendor"}</h2><p className="mt-1 text-sm text-slate-500">Vendor name and code are required. Bank details are only shown in vendor detail views.</p></div><button className="text-sm font-semibold text-slate-500" onClick={() => setForm(null)} type="button">Close</button></div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[["Vendor name", "name", true], ["Vendor code", "vendor_code", true], ["Email", "email"], ["Phone", "phone_number"], ["GSTIN / Tax registration", "tax_registration_number"], ["Contact person", "contact_person"], ["Payment terms", "payment_terms"], ["Bank name", "bank_name"], ["Account holder", "account_holder_name"], ["Bank account number", "bank_account_number"], ["IFSC code", "ifsc_code"]].map(([label, key, required]) => <label key={key}><span className="mb-1 block text-sm font-medium text-slate-700">{label}{required ? " *" : ""}</span><input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" onChange={(event) => setForm((previous) => ({ ...previous, [key]: event.target.value }))} required={Boolean(required)} type={key === "email" ? "email" : "text"} value={form[key] || ""} /></label>)}
            <label><span className="mb-1 block text-sm font-medium text-slate-700">Status</span><select className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" onChange={(event) => setForm((previous) => ({ ...previous, status: event.target.value }))} value={form.status}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></label>
            <label className="sm:col-span-2 lg:col-span-3"><span className="mb-1 block text-sm font-medium text-slate-700">Address</span><textarea className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" onChange={(event) => setForm((previous) => ({ ...previous, address: event.target.value }))} rows={2} value={form.address || ""} /></label>
          </div>
          <div className="mt-5 flex gap-2"><button className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={saving} type="submit">{saving ? "Saving…" : "Save vendor"}</button><button className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold" onClick={() => setForm(null)} type="button">Cancel</button></div>
        </form>
      )}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="grid grid-cols-1 gap-3 border-b border-slate-200 bg-slate-50 p-4 sm:grid-cols-3">
          <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm sm:col-span-2" onChange={(event) => setSearch(event.target.value)} placeholder="Search name, code, email, GSTIN" value={search} />
          <select className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}><option value="">All statuses</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select>
        </div>
        {loading ? <div className="p-8 text-center text-slate-500">Loading vendors…</div> : filteredVendors.length === 0 ? <div className="p-12 text-center"><p className="font-semibold text-slate-700">No vendors found</p><p className="mt-1 text-sm text-slate-500">Add a vendor or adjust the search and status filter.</p></div> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead className="bg-white text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Vendor</th><th className="px-4 py-3">Code</th><th className="px-4 py-3">Contact</th><th className="px-4 py-3">Invoices</th><th className="px-4 py-3">Invoiced</th><th className="px-4 py-3">Paid</th><th className="px-4 py-3">Outstanding</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Actions</th></tr></thead><tbody className="divide-y divide-slate-100">{filteredVendors.map((vendor) => <tr className="hover:bg-slate-50" key={vendor.id}><td className="px-4 py-3"><button className="font-semibold text-blue-700 hover:underline" onClick={() => openDetails(vendor)} type="button">{vendor.name}</button><p className="mt-0.5 text-xs text-slate-500">{vendor.tax_registration_number || "No tax ID"}</p></td><td className="px-4 py-3">{vendor.vendor_code}</td><td className="px-4 py-3">{vendor.contact_person || "—"}<p className="mt-0.5 text-xs text-slate-500">{vendor.email || vendor.phone_number || ""}</p></td><td className="px-4 py-3">{vendor.invoice_count || 0}</td><td className="px-4 py-3">{money(vendor.gross_invoiced_amount)}</td><td className="px-4 py-3">{money(vendor.paid_amount)}</td><td className="px-4 py-3">{money(vendor.outstanding_amount)}</td><td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${vendor.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{vendor.status}</span></td><td className="px-4 py-3"><div className="flex gap-3"><button className="font-semibold text-blue-700" onClick={() => startEdit(vendor)} type="button">Edit</button><button className="font-semibold text-slate-600" onClick={() => toggleStatus(vendor)} type="button">{vendor.status === "ACTIVE" ? "Deactivate" : "Activate"}</button></div></td></tr>)}</tbody></table></div>
        )}
      </section>

      {selectedVendor && <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedVendor(null); }} role="presentation"><section aria-modal="true" className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl bg-white p-6 shadow-2xl" role="dialog"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Vendor details</p><h2 className="mt-1 text-xl font-bold">{selectedVendor.name}</h2></div><button className="text-sm font-semibold text-slate-500" onClick={() => setSelectedVendor(null)} type="button">Close</button></div><dl className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">{[["Code", selectedVendor.vendor_code], ["Email", selectedVendor.email], ["Phone", selectedVendor.phone_number], ["GSTIN / tax ID", selectedVendor.tax_registration_number], ["Contact person", selectedVendor.contact_person], ["Payment terms", selectedVendor.payment_terms], ["Bank", selectedVendor.bank_name], ["Account holder", selectedVendor.account_holder_name], ["Account number", selectedVendor.bank_account_number], ["IFSC", selectedVendor.ifsc_code], ["Address", selectedVendor.address]].map(([label, value]) => <div className="rounded-lg bg-slate-50 p-3" key={label}><dt className="text-xs uppercase text-slate-500">{label}</dt><dd className="mt-1 break-words text-sm font-medium">{value || "—"}</dd></div>)}</dl><h3 className="mt-6 font-semibold">Linked invoices ({selectedVendor.invoices?.length || 0})</h3>{selectedVendor.invoices?.length ? <ul className="mt-2 divide-y divide-slate-100">{selectedVendor.invoices.map((invoice) => <li className="flex flex-wrap justify-between gap-2 py-2 text-sm" key={invoice.id}><span>{invoice.invoice_number || `Invoice #${invoice.id}`}</span><span>{invoice.status} · {money(invoice.total_amount)}</span></li>)}</ul> : <p className="mt-2 text-sm text-slate-500">No invoices are explicitly linked to this vendor yet.</p>}</section></div>}
    </section>
  );
}

export default Vendors;

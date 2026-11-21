
import { useEffect, useState } from "react";
import axios from "axios";

const API_URL = "https://invoicepilot-ocr.onrender.com/api/invoices/";

function Approvals() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState(null);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [rejectInvoice, setRejectInvoice] = useState(null);
  const [rejectReason, setRejectReason] = useState("");

  const loadInvoices = async () => {
    setLoading(true);
    setError("");

    try {
      const response = await axios.get(API_URL);
      let data = response.data;

      if (data.results) {
        data = data.results;
      }

      if (!Array.isArray(data)) {
        data = [];
      }

      const pendingInvoices = data.filter((invoice) => {
        return (
          invoice.status === "PENDING" ||
          invoice.status === "PENDING_APPROVAL"
        );
      });

      setInvoices(pendingInvoices);
    } catch (err) {
      console.error("Failed to load approvals:", err);
      setError("Failed to load invoices awaiting approval.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInvoices();
  }, []);

  const approveInvoice = async (invoice) => {
    const confirmed = window.confirm(
      `Are you sure you want to approve invoice ${
        invoice.invoice_number || invoice.id
      }?`
    );

    if (!confirmed) {
      return;
    }

    setActionLoading(invoice.id);
    setError("");

    try {
      await axios.post(`${API_URL}${invoice.id}/approve/`);

      alert("Invoice approved successfully!");
      setSelectedInvoice(null);
      await loadInvoices();
    } catch (err) {
      console.error("Approval failed:", err);

      if (err.response && err.response.data && err.response.data.detail) {
        setError(err.response.data.detail);
      } else {
        setError("Failed to approve invoice. Please try again.");
      }
    } finally {
      setActionLoading(null);
    }
  };

  const submitRejection = async () => {
    if (!rejectReason.trim()) {
      setError("Please enter a rejection reason.");
      return;
    }

    setActionLoading(rejectInvoice.id);
    setError("");

    try {
      await axios.post(`${API_URL}${rejectInvoice.id}/reject/`, {
        reason: rejectReason.trim(),
      });

      alert("Invoice rejected successfully!");
      setRejectInvoice(null);
      setRejectReason("");
      setSelectedInvoice(null);
      await loadInvoices();
    } catch (err) {
      console.error("Rejection failed:", err);

      if (err.response && err.response.data && err.response.data.detail) {
        setError(err.response.data.detail);
      } else {
        setError("Failed to reject invoice. Please try again.");
      }
    } finally {
      setActionLoading(null);
    }
  };

  const formatAmount = (amount) => {
    return Number(amount || 0).toLocaleString("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 2,
    });
  };

  const formatDate = (date) => {
    if (!date) {
      return "—";
    }

    return new Date(date).toLocaleDateString("en-IN");
  };

  const getVendorName = (invoice) => {
    if (invoice.vendor_details && invoice.vendor_details.name) {
      return invoice.vendor_details.name;
    }

    if (invoice.vendor_name) {
      return invoice.vendor_name;
    }

    return "Unknown Vendor";
  };

  const getStatusStyle = (status) => {
    if (status === "PENDING" || status === "PENDING_APPROVAL") {
      return "bg-amber-100 text-amber-700";
    }

    return "bg-slate-100 text-slate-700";
  };

  const totalPendingAmount = invoices.reduce((total, invoice) => {
    return total + Number(invoice.total_amount || 0);
  }, 0);

  return (
    <div className="space-y-6 p-6 md:p-8">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Approval Center
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Review, approve, or reject invoices awaiting approval.
          </p>
        </div>

        <button
          onClick={loadInvoices}
          disabled={loading}
          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? "Refreshing..." : "↻ Refresh"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Awaiting Approval</p>
          <h2 className="mt-2 text-3xl font-bold text-amber-600">
            {invoices.length}
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Invoices requiring your decision
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Pending Approval Amount</p>
          <h2 className="mt-2 text-2xl font-bold text-slate-900">
            {formatAmount(totalPendingAmount)}
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Combined value of pending invoices
          </p>
        </div>
      </div>

      {/* Invoice Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-5">
          <h2 className="font-semibold text-slate-900">
            Pending Approval Invoices
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Invoices submitted for approval.
          </p>
        </div>

        {loading ? (
          <div className="p-12 text-center text-slate-500">
            Loading approval invoices...
          </div>
        ) : invoices.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-4xl">✓</div>
            <h3 className="mt-3 font-semibold text-slate-800">
              All caught up!
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              No invoices are currently awaiting approval.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Invoice</th>
                  <th className="px-5 py-3 font-medium">Vendor</th>
                  <th className="px-5 py-3 font-medium">Invoice Date</th>
                  <th className="px-5 py-3 font-medium">Due Date</th>
                  <th className="px-5 py-3 font-medium">Amount</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Actions</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {invoices.map((invoice) => (
                  <tr key={invoice.id} className="hover:bg-slate-50">
                    <td className="px-5 py-4 font-medium text-slate-900">
                      {invoice.invoice_number || `Invoice #${invoice.id}`}
                    </td>

                    <td className="px-5 py-4 text-slate-600">
                      {getVendorName(invoice)}
                    </td>

                    <td className="px-5 py-4 text-slate-600">
                      {formatDate(invoice.invoice_date)}
                    </td>

                    <td className="px-5 py-4 text-slate-600">
                      {formatDate(invoice.due_date)}
                    </td>

                    <td className="px-5 py-4 font-semibold text-slate-800">
                      {formatAmount(invoice.total_amount)}
                    </td>

                    <td className="px-5 py-4">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getStatusStyle(
                          invoice.status
                        )}`}
                      >
                        {invoice.status}
                      </span>
                    </td>

                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setSelectedInvoice(invoice)}
                          className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          View
                        </button>

                        <button
                          onClick={() => approveInvoice(invoice)}
                          disabled={actionLoading === invoice.id}
                          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          {actionLoading === invoice.id ? "..." : "Approve"}
                        </button>

                        <button
                          onClick={() => {
                            setRejectInvoice(invoice);
                            setRejectReason("");
                            setError("");
                          }}
                          disabled={actionLoading === invoice.id}
                          className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Invoice Details Modal */}
      {selectedInvoice && !rejectInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-slate-900">
                Invoice Details
              </h2>
              <button
                onClick={() => setSelectedInvoice(null)}
                className="rounded-lg px-3 py-2 text-slate-500 hover:bg-slate-100"
              >
                ✕
              </button>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Detail label="Invoice Number" value={selectedInvoice.invoice_number} />
              <Detail label="Vendor" value={getVendorName(selectedInvoice)} />
              <Detail label="Invoice Date" value={formatDate(selectedInvoice.invoice_date)} />
              <Detail label="Due Date" value={formatDate(selectedInvoice.due_date)} />
              <Detail label="Subtotal" value={formatAmount(selectedInvoice.subtotal)} />
              <Detail label="Tax Amount" value={formatAmount(selectedInvoice.tax_amount)} />
              <Detail label="Total Amount" value={formatAmount(selectedInvoice.total_amount)} />
              <Detail label="Status" value={selectedInvoice.status} />
              <Detail label="Validation" value={selectedInvoice.validation_status} />
            </div>

            {selectedInvoice.validation_errors &&
              selectedInvoice.validation_errors.length > 0 && (
                <div className="mt-5 rounded-lg bg-amber-50 p-4">
                  <h3 className="font-semibold text-amber-800">
                    Validation Issues
                  </h3>
                  <ul className="mt-2 list-disc pl-5 text-sm text-amber-700">
                    {selectedInvoice.validation_errors.map((issue, index) => (
                      <li key={index}>{issue}</li>
                    ))}
                  </ul>
                </div>
              )}

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setSelectedInvoice(null)}
                className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {rejectInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-xl font-bold text-slate-900">
              Reject Invoice
            </h2>

            <p className="mt-2 text-sm text-slate-500">
              Rejection for invoice{" "}
              <strong>
                {rejectInvoice.invoice_number || `#${rejectInvoice.id}`}
              </strong>
            </p>

            <label className="mt-5 block text-sm font-medium text-slate-700">
              Rejection Reason
            </label>

            <textarea
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              rows={4}
              placeholder="Explain why this invoice is being rejected..."
              className="mt-2 w-full rounded-lg border border-slate-300 p-3 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100"
            />

            {error && (
              <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => {
                  setRejectInvoice(null);
                  setRejectReason("");
                  setError("");
                }}
                disabled={actionLoading === rejectInvoice.id}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>

              <button
                onClick={submitRejection}
                disabled={actionLoading === rejectInvoice.id}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {actionLoading === rejectInvoice.id
                  ? "Rejecting..."
                  : "Confirm Rejection"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 break-words font-semibold text-slate-800">
        {value || "—"}
      </p>
    </div>
  );
}

export default Approvals;




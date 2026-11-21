
import { useEffect, useMemo, useState } from "react";
import {
  fetchInvoices,
  recordInvoicePayment,
} from "../api/invoices";

export default function Payments() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const today = new Date().toISOString().split("T")[0];

  const [paymentForm, setPaymentForm] = useState({
    amount: "",
    payment_date: today,
    payment_method: "BANK_TRANSFER",
    reference_number: "",
    notes: "",
  });

  useEffect(() => {
    loadInvoices();
  }, []);

  async function loadInvoices() {
    try {
      const data = await fetchInvoices();
      setInvoices(
        Array.isArray(data) ? data : data.results || data.invoices || []
      );
    } catch (err) {
      console.error(err);
      setError("Failed to load invoices.");
    } finally {
      setLoading(false);
    }
  }

  function getAmount(invoice) {
    return Number(
      invoice.total_amount ??
        invoice.total ??
        invoice.grand_total ??
        invoice.amount ??
        0
    );
  }

  function getStatus(invoice) {
    return String(invoice.payment_status || invoice.status || "").toUpperCase();
  }

  function getInvoiceNumber(invoice) {
    return (
      invoice.invoice_number ||
      invoice.invoice_no ||
      invoice.number ||
      `INV-${invoice.id}`
    );
  }

  function getVendor(invoice) {
    return invoice.vendor_name || invoice.vendor?.name || "Unknown Vendor";
  }

  function formatAmount(amount) {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
    }).format(Number(amount || 0));
  }

  function formatDate(date) {
    if (!date) return "—";
    return new Date(date).toLocaleDateString("en-IN");
  }

  const paymentInvoices = useMemo(() => {
    return invoices.filter((invoice) => {
      const status = getStatus(invoice);
      return ["APPROVED", "PAID", "UNPAID", "PARTIALLY_PAID"].includes(status);
    });
  }, [invoices]);

  const filteredInvoices = useMemo(() => {
    return paymentInvoices.filter((invoice) => {
      const status = getStatus(invoice);
      const paymentStatus =
        status === "PAID" || invoice.payment_status === "PAID"
          ? "PAID"
          : "UNPAID";

      const matchesSearch = `${getInvoiceNumber(invoice)} ${getVendor(invoice)}`
        .toLowerCase()
        .includes(search.toLowerCase());

      const matchesFilter =
        statusFilter === "ALL" || paymentStatus === statusFilter;

      return matchesSearch && matchesFilter;
    });
  }, [paymentInvoices, search, statusFilter]);

  const totalPayable = paymentInvoices.reduce(
    (sum, invoice) => sum + getAmount(invoice),
    0
  );

  const paidAmount = paymentInvoices
    .filter((invoice) => getStatus(invoice) === "PAID")
    .reduce((sum, invoice) => sum + getAmount(invoice), 0);

  const pendingAmount = totalPayable - paidAmount;

  function openPaymentForm(invoice) {
    setSelectedInvoice(invoice);
    setPaymentForm({
      amount: String(getAmount(invoice)),
      payment_date: today,
      payment_method: "BANK_TRANSFER",
      reference_number: "",
      notes: "",
    });
    setMessage("");
    setError("");
    setShowForm(true);
  }

  async function handlePaymentSubmit(e) {
    e.preventDefault();

    if (!selectedInvoice) return;

    const amount = Number(paymentForm.amount);

    if (!amount || amount <= 0) {
      setError("Enter a valid payment amount.");
      return;
    }

    if (amount > getAmount(selectedInvoice)) {
      setError("Payment cannot exceed the invoice total.");
      return;
    }

    if (!paymentForm.payment_date || !paymentForm.payment_method) {
      setError("Payment date and method are required.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      await recordInvoicePayment(selectedInvoice.id, {
        ...paymentForm,
        amount,
      });

      setShowForm(false);
      setSelectedInvoice(null);
      setMessage("Payment recorded successfully!");
      await loadInvoices();
    } catch (err) {
      setError(
        err.response?.data?.error ||
          err.response?.data?.detail ||
          "Failed to record payment."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Payments</h1>
          <p className="mt-1 text-sm text-slate-500">
            Track invoice payments and outstanding amounts.
          </p>
        </div>

        {/* Success / Error */}
        {message && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-green-700">
            {message}
          </div>
        )}

        {error && !showForm && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
            {error}
          </div>
        )}

        {/* Summary Cards */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <SummaryCard title="Total Payable" value={formatAmount(totalPayable)} />

          <SummaryCard
            title="Paid Amount"
            value={formatAmount(paidAmount)}
            color="text-green-600"
          />

          <SummaryCard
            title="Pending Amount"
            value={formatAmount(pendingAmount)}
            color="text-orange-500"
          />
        </div>

        {/* Search and Filter */}
        <div className="flex flex-col gap-3 rounded-xl border bg-white p-4 sm:flex-row">
          <input
            type="text"
            placeholder="Search invoice or vendor..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 rounded-lg border px-4 py-2 outline-none focus:ring-2 focus:ring-blue-500"
          />

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border px-4 py-2"
          >
            <option value="ALL">All Payments</option>
            <option value="PAID">Paid</option>
            <option value="UNPAID">Unpaid</option>
          </select>
        </div>

        {/* Invoice Table */}
        <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-4 py-3">Invoice Number</th>
                <th className="px-4 py-3">Vendor</th>
                <th className="px-4 py-3">Invoice Date</th>
                <th className="px-4 py-3">Due Date</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="7" className="py-10 text-center text-slate-500">
                    Loading payments...
                  </td>
                </tr>
              ) : filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan="7" className="py-10 text-center text-slate-500">
                    No payment records found.
                  </td>
                </tr>
              ) : (
                filteredInvoices.map((invoice) => {
                  const paid = getStatus(invoice) === "PAID";

                  return (
                    <tr key={invoice.id} className="border-t hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-blue-600">
                        {getInvoiceNumber(invoice)}
                      </td>
                      <td className="px-4 py-3">{getVendor(invoice)}</td>
                      <td className="px-4 py-3">
                        {formatDate(invoice.invoice_date)}
                      </td>
                      <td className="px-4 py-3">
                        {formatDate(invoice.due_date)}
                      </td>
                      <td className="px-4 py-3 font-medium">
                        {formatAmount(getAmount(invoice))}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${
                            paid
                              ? "bg-green-100 text-green-700"
                              : "bg-orange-100 text-orange-700"
                          }`}
                        >
                          {paid ? "PAID" : "UNPAID"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {!paid &&
                        invoice.status === "APPROVED" &&
                        invoice.validation_status === "VALID" &&
                        !invoice.is_duplicate ? (
                          <button
                            onClick={() => openPaymentForm(invoice)}
                            className="whitespace-nowrap rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700"
                          >
                            Record Payment
                          </button>
                        ) : paid ? (
                          <span className="text-xs text-green-600">Completed</span>
                        ) : (
                          <span className="text-xs text-slate-400">
                            Not eligible
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Record Payment Modal */}
      {showForm && selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-xl font-bold text-slate-800">Record Payment</h2>

            <p className="mt-1 text-sm text-slate-500">
              {getInvoiceNumber(selectedInvoice)} — {getVendor(selectedInvoice)}
            </p>

            <form onSubmit={handlePaymentSubmit} className="mt-5 space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium">
                  Amount (₹)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={getAmount(selectedInvoice)}
                  value={paymentForm.amount}
                  onChange={(e) =>
                    setPaymentForm({ ...paymentForm, amount: e.target.value })
                  }
                  className="w-full rounded-lg border px-3 py-2"
                  required
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">
                  Payment Date
                </label>
                <input
                  type="date"
                  value={paymentForm.payment_date}
                  onChange={(e) =>
                    setPaymentForm({
                      ...paymentForm,
                      payment_date: e.target.value,
                    })
                  }
                  className="w-full rounded-lg border px-3 py-2"
                  required
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">
                  Payment Method
                </label>
                <select
                  value={paymentForm.payment_method}
                  onChange={(e) =>
                    setPaymentForm({
                      ...paymentForm,
                      payment_method: e.target.value,
                    })
                  }
                  className="w-full rounded-lg border px-3 py-2"
                  required
                >
                  <option value="BANK_TRANSFER">Bank Transfer</option>
                  <option value="UPI">UPI</option>
                  <option value="CHEQUE">Cheque</option>
                  <option value="CASH">Cash</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">
                  Reference Number
                </label>
                <input
                  type="text"
                  value={paymentForm.reference_number}
                  onChange={(e) =>
                    setPaymentForm({
                      ...paymentForm,
                      reference_number: e.target.value,
                    })
                  }
                  placeholder="Transaction ID / Cheque number"
                  className="w-full rounded-lg border px-3 py-2"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">
                  Notes
                </label>
                <textarea
                  value={paymentForm.notes}
                  onChange={(e) =>
                    setPaymentForm({ ...paymentForm, notes: e.target.value })
                  }
                  rows={2}
                  className="w-full rounded-lg border px-3 py-2"
                  placeholder="Optional notes"
                />
              </div>

              {error && (
                <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
                  {error}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false);
                    setError("");
                  }}
                  disabled={saving}
                  className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? "Recording..." : "Confirm Payment"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ title, value, color = "text-slate-800" }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-slate-500">{title}</p>
      <h2 className={`mt-2 text-2xl font-bold ${color}`}>{value}</h2>
    </div>
  );
}

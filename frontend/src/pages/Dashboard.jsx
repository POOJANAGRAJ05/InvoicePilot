import { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  fetchInvoices,
  fetchPaymentSummary,
  fetchAgingSummary,
} from "../api/invoices";
import InvoiceDetailsModal from "../components/InvoiceDetailsModal";

function formatAmount(value) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(amount);
}

function getInvoiceNumber(invoice) {
  return (
    invoice.invoice_number ||
    invoice.invoice_no ||
    invoice.number ||
    invoice.id ||
    "—"
  );
}

function getVendorName(invoice) {
  return (
    invoice.vendor_name ||
    invoice.vendor?.name ||
    invoice.vendor ||
    "Unknown Vendor"
  );
}

function getInvoiceAmount(invoice) {
  return Number(
    invoice.total_amount ??
      invoice.total ??
      invoice.grand_total ??
      invoice.amount ??
      0
  );
}

function getStatus(invoice) {
  return (
    invoice.status ||
    invoice.approval_status ||
    invoice.payment_status ||
    "UNKNOWN"
  );
}

function getStatusStyle(status) {
  const value = String(status).toUpperCase();

  if (["APPROVED", "PAID", "COMPLETED"].includes(value)) {
    return "bg-green-100 text-green-700";
  }

  if (["PENDING", "PENDING_APPROVAL", "UPLOADED"].includes(value)) {
    return "bg-amber-100 text-amber-700";
  }

  if (["REJECTED", "FAILED", "OVERDUE"].includes(value)) {
    return "bg-red-100 text-red-700";
  }

  return "bg-slate-100 text-slate-700";
}

function StatCard({ title, value, subtitle, icon, color }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <h2 className="mt-2 text-2xl font-bold text-slate-800">
            {value}
          </h2>
          {subtitle && (
            <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
          )}
        </div>

        <div
          className={`flex h-11 w-11 items-center justify-center rounded-lg text-xl ${color}`}
        >
          {icon}
        </div>
      </div>
    </div>
  );
}

function AgingCard({ title, amount, color }) {
  return (
    <div className={`rounded-xl border p-4 ${color}`}>
      <p className="text-sm font-medium">{title}</p>
      <h3 className="mt-2 text-xl font-bold">{formatAmount(amount)}</h3>
    </div>
  );
}

export default function Dashboard() {
  const [invoices, setInvoices] = useState([]);
  const [paymentSummary, setPaymentSummary] = useState(null);
  const [agingSummary, setAgingSummary] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selectedInvoice, setSelectedInvoice] = useState(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError("");

    const results = await Promise.allSettled([
      fetchInvoices(),
      fetchPaymentSummary(),
      fetchAgingSummary(),
    ]);

    if (results[0].status === "fulfilled") {
      const invoiceData = results[0].value;

      const invoiceList = Array.isArray(invoiceData)
        ? invoiceData
        : invoiceData?.results || invoiceData?.invoices || [];

      setInvoices(invoiceList);
    } else {
      setError("Unable to load invoices. Please refresh.");
      setInvoices([]);
    }

    if (results[1].status === "fulfilled") {
      setPaymentSummary(results[1].value);
    }

    if (results[2].status === "fulfilled") {
      setAgingSummary(results[2].value);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const stats = useMemo(() => {
    const totalInvoices = invoices.length;

    const pendingInvoices = invoices.filter((invoice) =>
      ["PENDING", "PENDING_APPROVAL", "UPLOADED"].includes(
        String(getStatus(invoice)).toUpperCase()
      )
    );

    const approvedInvoices = invoices.filter((invoice) =>
      ["APPROVED"].includes(String(getStatus(invoice)).toUpperCase())
    );

    const paidInvoices = invoices.filter(
      (invoice) =>
        String(invoice.payment_status || "").toUpperCase() === "PAID" ||
        String(getStatus(invoice)).toUpperCase() === "PAID"
    );

    return {
      totalInvoices,
      pendingCount: pendingInvoices.length,
      approvedCount: approvedInvoices.length,
      paidCount: paidInvoices.length,
    };
  }, [invoices]);

  const recentInvoices = useMemo(() => {
    return [...invoices]
      .sort((a, b) => {
        const dateA = new Date(
          a.created_at || a.uploaded_at || a.invoice_date || 0
        ).getTime();

        const dateB = new Date(
          b.created_at || b.uploaded_at || b.invoice_date || 0
        ).getTime();

        return dateB - dateA;
      })
      .slice(0, 5);
  }, [invoices]);

  const agingBuckets = agingSummary?.aging_buckets || {};

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">
              Dashboard
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Overview of your accounts payable activities.
            </p>
          </div>

          <button
            onClick={loadDashboard}
            disabled={loading}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
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

        {/* Main KPI Cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="Total Invoices"
            value={stats.totalInvoices}
            subtitle="Invoices in system"
            icon="📄"
            color="bg-blue-100"
          />

          <StatCard
            title="Pending Approvals"
            value={stats.pendingCount}
            subtitle="Awaiting approval"
            icon="⏳"
            color="bg-amber-100"
          />

          <StatCard
            title="Approved Invoices"
            value={stats.approvedCount}
            subtitle="Approved for payment"
            icon="✅"
            color="bg-green-100"
          />

          <StatCard
            title="Paid Invoices"
            value={stats.paidCount}
            subtitle="Payments completed"
            icon="💰"
            color="bg-purple-100"
          />
        </div>

        {/* Aging Tracker */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-5">
            <h2 className="text-lg font-semibold text-slate-800">
              Invoice Aging & Overdue Tracker
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Monitor outstanding payments and overdue invoices.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <StatCard
              title="Total Outstanding"
              value={formatAmount(agingSummary?.total_outstanding)}
              subtitle="Unpaid invoice balance"
              icon="💳"
              color="bg-blue-100"
            />

            <StatCard
              title="Overdue Amount"
              value={formatAmount(agingSummary?.overdue_amount)}
              subtitle={`${agingSummary?.overdue_invoice_count || 0} overdue invoices`}
              icon="⚠️"
              color="bg-red-100"
            />

            <StatCard
              title="Due Soon"
              value={formatAmount(agingSummary?.due_soon_amount)}
              subtitle={`${agingSummary?.due_soon_invoice_count || 0} invoices due soon`}
              icon="📅"
              color="bg-amber-100"
            />
          </div>

          <h3 className="mb-3 mt-6 text-sm font-semibold text-slate-700">
            Overdue Aging Breakdown
          </h3>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <AgingCard
              title="0–30 Days"
              amount={agingBuckets["0_30_days"]}
              color="border-blue-200 bg-blue-50 text-blue-800"
            />

            <AgingCard
              title="31–60 Days"
              amount={agingBuckets["31_60_days"]}
              color="border-amber-200 bg-amber-50 text-amber-800"
            />

            <AgingCard
              title="61–90 Days"
              amount={agingBuckets["61_90_days"]}
              color="border-orange-200 bg-orange-50 text-orange-800"
            />

            <AgingCard
              title="90+ Days"
              amount={agingBuckets["90_plus_days"]}
              color="border-red-200 bg-red-50 text-red-800"
            />
          </div>
        </div>

        {/* Recent Invoices */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col justify-between gap-3 border-b border-slate-200 p-5 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-lg font-semibold text-slate-800">
                Recent Invoices
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Your latest uploaded invoices.
              </p>
            </div>

            <NavLink
              to="/invoices"
              className="text-sm font-medium text-blue-600 hover:text-blue-800"
            >
              View All Invoices →
            </NavLink>
          </div>

          {loading ? (
            <div className="space-y-3 p-6" aria-label="Loading invoices">
              {[1, 2, 3].map((row) => (
                <div
                  key={row}
                  className="h-10 animate-pulse rounded bg-slate-100"
                />
              ))}
            </div>
          ) : recentInvoices.length === 0 ? (
            <div className="p-10 text-center text-slate-500">
              No invoices available.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">Invoice Number</th>
                    <th className="px-5 py-3 font-medium">Vendor</th>
                    <th className="px-5 py-3 font-medium">Invoice Date</th>
                    <th className="px-5 py-3 font-medium">Due Date</th>
                    <th className="px-5 py-3 font-medium">Amount</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">Action</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                  {recentInvoices.map((invoice) => (
                    <tr
                      key={invoice.id}
                      className="hover:bg-slate-50"
                    >
                      <td className="whitespace-nowrap px-5 py-4 font-medium text-slate-800">
                        {getInvoiceNumber(invoice)}
                      </td>

                      <td className="px-5 py-4 text-slate-600">
                        {getVendorName(invoice)}
                      </td>

                      <td className="whitespace-nowrap px-5 py-4 text-slate-600">
                        {invoice.invoice_date || "—"}
                      </td>

                      <td className="whitespace-nowrap px-5 py-4 text-slate-600">
                        {invoice.due_date || "—"}
                      </td>

                      <td className="whitespace-nowrap px-5 py-4 font-medium text-slate-700">
                        {formatAmount(getInvoiceAmount(invoice))}
                      </td>

                      <td className="px-5 py-4">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getStatusStyle(
                            getStatus(invoice)
                          )}`}
                        >
                          {String(getStatus(invoice)).replace(/_/g, " ")}
                        </span>
                      </td>

                      <td className="whitespace-nowrap px-5 py-4">
                        <button
                          onClick={() => setSelectedInvoice(invoice)}
                          className="font-medium text-blue-600 hover:text-blue-800"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Quick Links */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <NavLink
            to="/approvals"
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
          >
            <h3 className="font-semibold text-slate-800">Approvals</h3>
            <p className="mt-1 text-sm text-slate-500">
              Review invoices awaiting approval.
            </p>
          </NavLink>

          <NavLink
            to="/payments"
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
          >
            <h3 className="font-semibold text-slate-800">Payments</h3>
            <p className="mt-1 text-sm text-slate-500">
              Track invoice payment activity.
            </p>
          </NavLink>

          <NavLink
            to="/reports"
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
          >
            <h3 className="font-semibold text-slate-800">Reports</h3>
            <p className="mt-1 text-sm text-slate-500">
              View financial reports and analytics.
            </p>
          </NavLink>
        </div>
      </div>

      {/* Invoice Details Modal */}
      {selectedInvoice && (
        <InvoiceDetailsModal
          invoice={selectedInvoice}
          onClose={() => setSelectedInvoice(null)}
        />
      )}
    </div>
  );
}
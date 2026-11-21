import { useCallback, useEffect, useMemo, useState } from "react";
import { downloadReportCsv, fetchReports } from "../api/invoices";

const STATUS_ORDER = ["UPLOADED", "PROCESSING", "PENDING", "APPROVED", "REJECTED", "PAID", "EXCEPTION", "UNKNOWN"];
const STATUS_COLORS = {
  UPLOADED: "#64748b",
  PROCESSING: "#8b5cf6",
  PENDING: "#f59e0b",
  APPROVED: "#2563eb",
  REJECTED: "#f43f5e",
  PAID: "#10b981",
  EXCEPTION: "#e11d48",
  UNKNOWN: "#94a3b8",
};

function formatAmount(value) {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)
    : "—";
}

function formatPeriod(value, grouping) {
  if (value === "undated") return "Undated invoices";
  const parsed = new Date(`${value}T00:00:00`);
  if (grouping === "yearly") return parsed.getFullYear().toString();
  if (grouping === "quarterly") {
    return `Q${Math.floor(parsed.getMonth() / 3) + 1} ${parsed.getFullYear()}`;
  }
  return parsed.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}

function SummaryCard({ title, value, note, color }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-slate-500">{title}</p>
      <p className="mt-3 break-words text-2xl font-bold text-slate-900">{value}</p>
      <p className={`mt-2 text-xs ${color || "text-slate-400"}`}>{note}</p>
    </article>
  );
}

function Panel({ title, description, children, className = "" }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      <div className="border-b border-slate-100 px-5 py-4 md:px-6">
        <h2 className="font-bold text-slate-900">{title}</h2>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      <div className="p-5 md:p-6">{children}</div>
    </section>
  );
}

function TrendChart({ rows, grouping }) {
  const width = 720;
  const height = 250;
  const padding = { top: 18, right: 18, bottom: 42, left: 58 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(1, ...rows.map((row) => Math.max(Number(row.invoiced_amount) || 0, Number(row.paid_amount) || 0, Number(row.outstanding_amount) || 0)));
  const x = (index) => padding.left + (rows.length <= 1 ? plotWidth / 2 : (index * plotWidth) / (rows.length - 1));
  const y = (value) => padding.top + plotHeight - ((Number(value) || 0) / maxValue) * plotHeight;
  const series = [
    { key: "gross_invoiced_amount", label: "Gross invoices (duplicates included)", color: "#2563eb" },
    { key: "unique_invoiced_amount", label: "Unique invoices (duplicates excluded)", color: "#7c3aed" },
    { key: "paid_amount", label: "Paid", color: "#10b981" },
    { key: "outstanding_amount", label: "Approved outstanding", color: "#f59e0b" },
  ];
  const labelStep = Math.max(1, Math.ceil(rows.length / 6));

  if (!rows.length) return <p className="py-12 text-center text-sm text-slate-500">No monthly trend data for these filters.</p>;

  return (
    <div className="overflow-x-auto">
      <svg aria-label="Monthly invoice and payment trends" className="h-64 min-w-[620px] w-full" role="img" viewBox={`0 0 ${width} ${height}`}>
        {[0, 0.5, 1].map((fraction) => {
          const gridY = padding.top + plotHeight * fraction;
          return <line key={fraction} stroke="#e2e8f0" x1={padding.left} x2={width - padding.right} y1={gridY} y2={gridY} />;
        })}
        {series.map((item) => {
          const points = rows.map((row, index) => `${x(index)},${y(row[item.key])}`).join(" ");
          return (
            <g key={item.key}>
              <polyline fill="none" points={points} stroke={item.color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
              {rows.map((row, index) => <circle key={`${item.key}-${row.period}`} cx={x(index)} cy={y(row[item.key])} fill={item.color} r="3.5" />)}
            </g>
          );
        })}
        {rows.map((row, index) => index % labelStep === 0 || index === rows.length - 1 ? (
          <text key={row.period} fill="#64748b" fontSize="10" textAnchor="middle" x={x(index)} y={height - 12}>{formatPeriod(row.period, grouping)}</text>
        ) : null)}
      </svg>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-600">
        {series.map((item) => <span className="inline-flex items-center gap-2" key={item.key}><i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />{item.label}</span>)}
      </div>
    </div>
  );
}

function HorizontalBars({ rows, valueKey, labelKey, color, valueFormatter = formatAmount, maxRows = 8 }) {
  const visibleRows = rows.slice(0, maxRows);
  const maximum = Math.max(1, ...visibleRows.map((row) => Number(row[valueKey]) || 0));
  if (!visibleRows.length) return <p className="py-8 text-center text-sm text-slate-500">No data for these filters.</p>;
  return (
    <div className="space-y-4">
      {visibleRows.map((row, index) => {
        const value = Number(row[valueKey]) || 0;
        return (
          <div key={`${row[labelKey]}-${index}`}>
            <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-medium text-slate-700">{row[labelKey]}</span>
              <span className="shrink-0 font-semibold text-slate-900">{valueFormatter(value)}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full" style={{ width: `${Math.max(value > 0 ? 2 : 0, (value / maximum) * 100)}%`, backgroundColor: typeof color === "function" ? color(row, index) : color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Reports() {
  const [filters, setFilters] = useState({ start_date: "", end_date: "", vendor: "", status: "", grouping: "monthly" });
  const [draftFilters, setDraftFilters] = useState(filters);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState("");
  const [exportMessage, setExportMessage] = useState("");

  const loadReport = useCallback(async (activeFilters) => {
    setLoading(true);
    setError("");
    try {
      const cleanFilters = Object.fromEntries(Object.entries(activeFilters).filter(([, value]) => value !== ""));
      const data = await fetchReports(cleanFilters);
      setReport(data);
    } catch (requestError) {
      console.error("Could not load reports:", requestError);
      const details = requestError?.response?.data;
      setError(typeof details === "object" ? Object.values(details).flat().join(" ") : "Report data could not be loaded. Check the backend connection and retry.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReport(filters);
  }, [filters, loadReport]);

  const vendors = useMemo(() => report?.vendor_summary || [], [report]);
  const summary = report?.summary;
  const summaryCards = summary ? [
    { title: "Total invoices", value: summary.total_invoices.toLocaleString(), note: "Matching records", color: "text-blue-600" },
    { title: "Gross invoice amount", value: formatAmount(summary.gross_invoice_amount), note: "All records; duplicates included", color: "text-violet-600" },
    { title: "Unique invoice amount", value: formatAmount(summary.unique_invoice_amount), note: "Duplicate records excluded", color: "text-indigo-600" },
    { title: "Total paid", value: formatAmount(summary.total_paid_amount), note: "Recorded payments", color: "text-emerald-600" },
    { title: "Approved outstanding", value: formatAmount(summary.total_outstanding_approved_amount), note: "Approved and unpaid", color: "text-amber-600" },
    { title: "Pending approvals", value: summary.pending_approvals_count.toLocaleString(), note: "Awaiting review", color: "text-amber-600" },
    { title: "Rejected invoices", value: summary.rejected_invoices_count.toLocaleString(), note: "Rejected records", color: "text-rose-600" },
    { title: "Exceptions", value: summary.exception_invoices_count.toLocaleString(), note: "Require attention", color: "text-rose-600" },
    { title: "Paid invoices", value: summary.paid_invoices_count.toLocaleString(), note: "Payment recorded", color: "text-emerald-600" },
  ] : [];

  const applyFilters = (event) => {
    event.preventDefault();
    setFilters({ ...draftFilters });
  };

  const exportCsv = async (type) => {
    setExporting(type);
    setExportMessage("");
    try {
      const cleanFilters = Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== ""));
      const blob = await downloadReportCsv(type, cleanFilters);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `invoicepilot-${type}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setExportMessage(`${type[0].toUpperCase()}${type.slice(1)} CSV downloaded.`);
    } catch (downloadError) {
      console.error("Report export failed:", downloadError);
      setExportMessage("Export failed. Please retry or check the backend connection.");
    } finally {
      setExporting("");
    }
  };

  return (
    <section className="space-y-6 p-5 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-blue-600">Finance intelligence</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Reports &amp; analytics</h1>
          <p className="mt-1 text-sm text-slate-500">Spending, payments, vendor exposure, and invoice aging from your records.</p>
        </div>
        <button className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50" disabled={loading} onClick={() => loadReport(filters)} type="button">
          {loading ? "Refreshing…" : "Refresh reports"}
        </button>
      </div>

      <form className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-2 lg:grid-cols-6" onSubmit={applyFilters}>
        <label>
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">From invoice date</span>
          <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" onChange={(event) => setDraftFilters((previous) => ({ ...previous, start_date: event.target.value }))} type="date" value={draftFilters.start_date} />
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">To invoice date</span>
          <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" onChange={(event) => setDraftFilters((previous) => ({ ...previous, end_date: event.target.value }))} type="date" value={draftFilters.end_date} />
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Vendor</span>
          <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" list="report-vendors" onChange={(event) => setDraftFilters((previous) => ({ ...previous, vendor: event.target.value }))} placeholder="All vendors" value={draftFilters.vendor} />
          <datalist id="report-vendors">{vendors.map((row) => <option key={row.vendor_name} value={row.vendor_name} />)}</datalist>
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Invoice status</span>
          <select className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" onChange={(event) => setDraftFilters((previous) => ({ ...previous, status: event.target.value }))} value={draftFilters.status}>
            <option value="">All statuses</option>
            {STATUS_ORDER.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Trend grouping</span>
          <select className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" onChange={(event) => setDraftFilters((previous) => ({ ...previous, grouping: event.target.value }))} value={draftFilters.grouping}>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="yearly">Yearly</option>
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700" type="submit">Apply filters</button>
          <button className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50" onClick={() => { const cleared = { start_date: "", end_date: "", vendor: "", status: "", grouping: "monthly" }; setDraftFilters(cleared); setFilters(cleared); }} type="button">Reset</button>
        </div>
      </form>
      <p className="-mt-4 px-1 text-xs text-slate-500">
        Date ranges filter by invoice date. When a range is selected, invoices without an invoice date cannot be assigned to that range and are excluded from the filtered report.
      </p>

      {error && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800" role="alert"><span>{error}</span><button className="font-semibold underline" onClick={() => loadReport(filters)} type="button">Retry</button></div>}

      {loading && !report ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Loading reports">{Array.from({ length: 8 }, (_, index) => <div className="h-32 animate-pulse rounded-xl bg-white" key={index} />)}</div>
      ) : report && (
        <>
          {summaryCards.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {summaryCards.map((card) => <SummaryCard key={card.title} {...card} />)}
            </div>
          ) : <p className="rounded-xl bg-white p-8 text-center text-slate-500">No report data found.</p>}

          <Panel className={loading ? "opacity-60" : ""} description={`${filters.grouping[0].toUpperCase()}${filters.grouping.slice(1)} invoice cohort: count and gross include all records, unique excludes duplicates; payments are grouped by their invoice's period`} title="Invoice & payment trends">
            {report.monthly_trends.length ? (
              <>
                <TrendChart grouping={filters.grouping} rows={report.monthly_trends} />
                <div className="mt-5 overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left text-sm">
                    <thead className="text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-2">Period</th><th className="py-2">Records</th><th className="py-2">Gross invoiced</th><th className="py-2">Unique invoiced</th><th className="py-2">Paid</th><th className="py-2">Approved outstanding</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">{report.monthly_trends.map((row) => <tr key={row.period}><td className="py-2 font-medium">{formatPeriod(row.period, filters.grouping)}</td><td className="py-2">{row.invoice_count}</td><td className="py-2">{formatAmount(row.gross_invoiced_amount)}</td><td className="py-2">{formatAmount(row.unique_invoiced_amount)}</td><td className="py-2">{formatAmount(row.paid_amount)}</td><td className="py-2">{formatAmount(row.outstanding_amount)}</td></tr>)}</tbody>
                  </table>
                </div>
              </>
            ) : <p className="py-12 text-center text-sm text-slate-500">No trend data available for the selected filters.</p>}
          </Panel>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Panel description="Gross invoice amount per vendor; duplicate rows are included in gross, excluded from unique totals" title="Vendor spending">
              <HorizontalBars color="#4f46e5" labelKey="vendor_name" rows={[...report.vendor_summary].sort((a, b) => Number(b.gross_invoiced_amount) - Number(a.gross_invoiced_amount))} valueKey="gross_invoiced_amount" />
            </Panel>
            <Panel description="Record counts include duplicates; gross amounts include duplicate rows and unique amounts exclude them. Status totals therefore reconcile to the gross invoice amount." title="Approval & status analysis">
              <div className="space-y-4">
                {STATUS_ORDER.map((status) => {
                  const row = report.status_breakdown[status];
                  const maxCount = Math.max(1, ...STATUS_ORDER.map((key) => report.status_breakdown[key].invoice_count));
                  return (
                    <div key={status}>
                      <div className="mb-1.5 flex flex-wrap justify-between gap-2 text-sm"><span className="font-medium text-slate-700">{status}</span><span className="text-slate-500">{row.invoice_count} records · gross {formatAmount(row.gross_amount)} · unique {formatAmount(row.unique_amount)}</span></div>
                      <div className="h-2.5 rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${row.invoice_count ? Math.max(2, row.invoice_count / maxCount * 100) : 0}%`, backgroundColor: STATUS_COLORS[status] }} /></div>
                    </div>
                  );
                })}
              </div>
            </Panel>
          </div>

          <Panel description="Record count includes duplicates; gross includes duplicates; unique excludes duplicates. Paid is actual recorded payments." title="Vendor summary">
            {report.vendor_summary.length ? <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-3">Vendor</th><th className="px-3 py-3">Invoice records</th><th className="px-3 py-3">Unique invoices</th><th className="px-3 py-3">Gross invoiced</th><th className="px-3 py-3">Unique invoiced</th><th className="px-3 py-3">Paid</th><th className="px-3 py-3">Approved outstanding</th></tr></thead><tbody className="divide-y divide-slate-100">{report.vendor_summary.map((row) => <tr key={row.vendor_name}><td className="px-3 py-3 font-medium text-slate-800">{row.vendor_name}</td><td className="px-3 py-3">{row.invoice_count}</td><td className="px-3 py-3">{row.unique_invoice_count}</td><td className="px-3 py-3">{formatAmount(row.gross_invoiced_amount)}</td><td className="px-3 py-3">{formatAmount(row.unique_invoiced_amount)}</td><td className="px-3 py-3">{formatAmount(row.paid_amount)}</td><td className="px-3 py-3">{formatAmount(row.outstanding_amount)}</td></tr>)}</tbody></table></div> : <p className="py-8 text-center text-sm text-slate-500">No vendor data available.</p>}
          </Panel>

          <Panel description="Valid, approved, unpaid, nonduplicate balances; invoices missing a due date are shown separately." title="Invoice aging">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <HorizontalBars color={(_row, index) => ["#10b981", "#f59e0b", "#f97316", "#ef4444", "#be123c", "#94a3b8"][index]} labelKey="label" rows={report.aging_summary} valueKey="amount" />
              <div className="space-y-3">
                {report.aging_summary.map((row) => <div className="flex items-center justify-between rounded-lg bg-slate-50 p-3" key={row.key}><div><p className="text-sm font-medium text-slate-700">{row.label}</p><p className="mt-1 text-xs text-slate-500">{row.invoice_count} invoice(s)</p></div><p className="font-bold text-slate-900">{formatAmount(row.amount)}</p></div>)}
                {!report.aging_invoices.length && <p className="py-3 text-center text-sm text-slate-500">No approved unpaid invoices match the selected filters.</p>}
              </div>
            </div>
          </Panel>

          <Panel description="Exports use the active date, vendor, status, and grouping filters" title="Export reports">
            <div className="flex flex-wrap gap-3">
              {[["invoices", "Invoice register CSV"], ["vendors", "Vendor summary CSV"], ["aging", "Invoice aging CSV"], ["monthly", "Monthly analytics CSV"]].map(([type, label]) => <button className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:border-blue-300 hover:bg-blue-50 disabled:cursor-wait disabled:opacity-50" disabled={Boolean(exporting)} key={type} onClick={() => exportCsv(type)} type="button">{exporting === type ? "Preparing…" : label}</button>)}
            </div>
            {exportMessage && <p className="mt-3 text-sm text-slate-600" role="status">{exportMessage}</p>}
          </Panel>
        </>
      )}
    </section>
  );
}

export default Reports;

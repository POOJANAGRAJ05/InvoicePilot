import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { fetchInvoices, notifyInvoicesUpdated } from "../api/invoices";
import InvoiceDetailsModal from "../components/InvoiceDetailsModal";

const PAGE_SIZE = 10;

const sortableColumns = [
  ["invoice_number", "Invoice number"],
  ["vendor_name", "Vendor"],
  ["invoice_date", "Invoice date"],
  ["due_date", "Due date"],
  ["subtotal_amount", "Subtotal"],
  ["tax_amount", "Tax"],
  ["total_amount", "Total"],
  ["created_at", "Uploaded"],
  ["status", "Status"],
];

function amount(value) {
  const parsed = Number(value);

  if (
    value === null ||
    value === undefined ||
    value === "" ||
    !Number.isFinite(parsed)
  ) {
    return "—";
  }

  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(parsed);
}

function date(value) {
  return value ? new Date(value).toLocaleDateString() : "—";
}

function statusStyle(status) {
  const palette = {
    PAID: "bg-emerald-50 text-emerald-700",
    APPROVED: "bg-blue-50 text-blue-700",
    PENDING: "bg-amber-50 text-amber-800",
    EXCEPTION: "bg-rose-50 text-rose-700",
    REJECTED: "bg-rose-50 text-rose-700",
    PROCESSING: "bg-violet-50 text-violet-700",
  };

  return palette[status] || "bg-slate-100 text-slate-700";
}

function validationBadge(invoice) {
  if (invoice.is_duplicate) {
    return { label: "Duplicate", style: "bg-violet-50 text-violet-700" };
  }

  if (invoice.validation_status === "VALID") {
    return { label: "Valid", style: "bg-emerald-50 text-emerald-700" };
  }

  if (invoice.validation_status === "EXCEPTION") {
    return { label: "Exception", style: "bg-rose-50 text-rose-700" };
  }

  return { label: "Not checked", style: "bg-slate-100 text-slate-600" };
}

function Invoices() {
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("");
  const [processedInvoices, setProcessedInvoices] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loadingInvoices, setLoadingInvoices] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [validationFilter, setValidationFilter] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [sortKey, setSortKey] = useState("created_at");
  const [sortDirection, setSortDirection] = useState("desc");
  const [page, setPage] = useState(1);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [deletingInvoiceId, setDeletingInvoiceId] = useState(null);

  const loadInvoices = useCallback(async () => {
    setLoadingInvoices(true);
    setLoadError("");

    try {
      const records = await fetchInvoices();

      if (Array.isArray(records)) {
        setInvoices(records);
      } else {
        setInvoices(records.results || []);
      }
    } catch (error) {
      console.error("Could not load invoices:", error);
      setLoadError(
        "Invoice records could not be loaded. Check the backend connection and retry."
      );
    } finally {
      setLoadingInvoices(false);
    }
  }, []);

  // Delete one selected invoice
  const handleDeleteInvoice = async (invoice) => {
    const confirmed = window.confirm(
      `Are you sure you want to delete invoice ${
        invoice.invoice_number || invoice.id
      }? This action cannot be undone.`
    );

    if (!confirmed) return;

    setDeletingInvoiceId(invoice.id);
    setMessage("");

    try {
      const API_BASE_URL = (
        import.meta.env.VITE_API_URL || "http://127.0.0.1:8000/api"
      ).replace(/\/+$/, "");

      const response = await axios.delete(
        `${API_BASE_URL}/invoices/${invoice.id}/`
      );

      setInvoices((previous) =>
        previous.filter((item) => item.id !== invoice.id)
      );

      setProcessedInvoices((previous) =>
        previous.filter((item) => item.id !== invoice.id)
      );

      if (selectedInvoice?.id === invoice.id) {
        setSelectedInvoice(null);
      }

      // Keep the page number valid after deletion
      const remainingCount = filteredInvoices.length - 1;
      const newPageCount = Math.max(
        1,
        Math.ceil(remainingCount / PAGE_SIZE)
      );

      setPage((currentPage) => Math.min(currentPage, newPageCount));

      setMessage(
        response.data?.message ||
          `Invoice ${invoice.invoice_number || invoice.id} deleted successfully.`
      );
      setMessageType("success");

      notifyInvoicesUpdated();
      await loadInvoices();
    } catch (error) {
      console.error("Delete invoice error:", error);

      setMessage(
        error?.response?.data
          ? `Delete failed: ${JSON.stringify(error.response.data)}`
          : "Failed to delete invoice. Please check the backend connection."
      );

      setMessageType("error");
    } finally {
      setDeletingInvoiceId(null);
    }
  };

  useEffect(() => {
    loadInvoices();

    const refresh = () => {
      loadInvoices();
    };

    window.addEventListener("invoicepilot:invoices-updated", refresh);

    return () => {
      window.removeEventListener("invoicepilot:invoices-updated", refresh);
    };
  }, [loadInvoices]);

  const handleFileChange = (event) => {
    const selectedFiles = Array.from(event.target.files || []);

    setFiles((previousFiles) => [...previousFiles, ...selectedFiles]);
    setMessage("");
    event.target.value = "";
  };

  const removeFile = (indexToRemove) => {
    setFiles((previousFiles) =>
      previousFiles.filter((_, index) => index !== indexToRemove)
    );
  };

  const handleUpload = async () => {
    if (files.length === 0) {
      setMessage("Please select at least one invoice file.");
      setMessageType("error");
      return;
    }

    setUploading(true);
    setMessage("");

    const uploadResults = [];

    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append("invoice_file", file);

        const response = await axios.post("http://127.0.0.1:8000/api/invoices/", formData);

        uploadResults.push(response.data);
      }

      setProcessedInvoices(uploadResults);
      setFiles([]);

      const failedOCRCount = uploadResults.filter(
        (invoice) => invoice.ocr_status === "failed"
      ).length;

      if (failedOCRCount > 0) {
        setMessage(
          `${uploadResults.length} invoice(s) uploaded. OCR needs review for ${failedOCRCount}; the original files were saved.`
        );
        setMessageType("warning");
      } else {
        setMessage(
          `${uploadResults.length} invoice(s) uploaded and invoice details extracted successfully.`
        );
        setMessageType("success");
      }
    } catch (error) {
      console.error("Upload error:", error);

      let errorDetails = null;

      if (error && error.response && error.response.data) {
        errorDetails = error.response.data;
      }

      console.error("Server response:", errorDetails);

      let errorMessage =
        "Upload failed. Please check whether the Django server is running.";

      if (uploadResults.length > 0) {
        errorMessage =
          `${uploadResults.length} invoice(s) uploaded before an error occurred. ` +
          (errorDetails
            ? JSON.stringify(errorDetails)
            : "Check whether the Django server is running.");
      } else if (errorDetails) {
        errorMessage = `Upload failed: ${JSON.stringify(errorDetails)}`;
      }

      setMessage(errorMessage);
      setMessageType("error");
    } finally {
      setUploading(false);

      if (uploadResults.length > 0) {
        notifyInvoicesUpdated();
        await loadInvoices();
      }
    }
  };

  const filteredInvoices = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    const filtered = invoices.filter((invoice) => {
      const vendor = (invoice.vendor_name || "").toLowerCase();
      const invoiceNumber = (invoice.invoice_number || "").toLowerCase();

      const matchesSearch =
        !normalizedSearch ||
        vendor.includes(normalizedSearch) ||
        invoiceNumber.includes(normalizedSearch);

      const invoiceDate = invoice.invoice_date || "";
      const matchesStatus = !statusFilter || invoice.status === statusFilter;

      let matchesValidation = true;

      if (validationFilter === "DUPLICATE") {
        matchesValidation = Boolean(invoice.is_duplicate);
      } else if (validationFilter === "EXCEPTION") {
        matchesValidation =
          invoice.validation_status === "EXCEPTION" &&
          !invoice.is_duplicate;
      } else if (validationFilter === "VALID") {
        matchesValidation = invoice.validation_status === "VALID";
      }

      const hasPayment =
        Array.isArray(invoice.payment_history) &&
        invoice.payment_history.length > 0;

      const matchesPayment =
        !paymentFilter ||
          (paymentFilter === "PAID" &&
            (hasPayment || invoice.status === "PAID")) ||
          (paymentFilter === "UNPAID_APPROVED" &&
            invoice.status === "APPROVED" &&
            !hasPayment) ||
          (paymentFilter === "NOT_ELIGIBLE" &&
            invoice.status !== "APPROVED" &&
            !hasPayment);

      const matchesStart =
        !startDate || (invoiceDate && invoiceDate >= startDate);

      const matchesEnd =
        !endDate || (invoiceDate && invoiceDate <= endDate);

      return (
        matchesSearch &&
        matchesStatus &&
        matchesValidation &&
        matchesPayment &&
        matchesStart &&
        matchesEnd
      );
    });

    filtered.sort((first, second) => {
      const firstValue = first[sortKey];
      const secondValue = second[sortKey];

      let comparison = 0;

      if (
        sortKey === "subtotal_amount" ||
        sortKey === "tax_amount" ||
        sortKey === "total_amount"
      ) {
        comparison =
          (Number(firstValue) || 0) - (Number(secondValue) || 0);
      } else {
        comparison = String(firstValue || "").localeCompare(
          String(secondValue || ""),
          undefined,
          {
            numeric: true,
            sensitivity: "base",
          }
        );
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });

    return filtered;
  }, [
    invoices,
    search,
    statusFilter,
    validationFilter,
    paymentFilter,
    startDate,
    endDate,
    sortKey,
    sortDirection,
  ]);

  const pageCount = Math.max(
    1,
    Math.ceil(filteredInvoices.length / PAGE_SIZE)
  );

  const visibleInvoices = filteredInvoices.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE
  );

  const changeSort = (key) => {
    if (sortKey === key) {
      setSortDirection((direction) =>
        direction === "asc" ? "desc" : "asc"
      );
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }

    setPage(1);
  };

  const setFilter = (setter) => (event) => {
    setter(event.target.value);
    setPage(1);
  };

  return (
    <div className="min-h-screen bg-slate-100 p-6 md:p-8">
      {/* Page Heading */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">
          Invoice Management
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Upload and manage your vendor invoices.
        </p>
      </div>

      {/* Upload Card */}
      <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h2 className="mb-2 text-lg font-bold text-slate-800">
          Upload Invoices
        </h2>

        <p className="mb-6 text-sm text-slate-500">
          Upload PDF, JPG, PNG or TIFF invoice documents.
        </p>

        {/* File Selection Area */}
        <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-blue-300 bg-blue-50 px-6 py-14 text-center transition hover:bg-blue-100">
          <span className="mb-3 text-4xl">📄</span>
          <span className="font-semibold text-blue-700">
            Click to select invoice files
          </span>
          <span className="mt-2 text-sm text-slate-500">
            PDF, JPG, PNG, TIFF
          </span>

          <input
            type="file"
            multiple
            accept=".pdf,.jpg,.jpeg,.png,.tiff,.tif"
            onChange={handleFileChange}
            className="hidden"
          />
        </label>

        {/* Selected Files */}
        <div className="mt-6">
          <h3 className="mb-3 font-semibold text-slate-800">
            Selected Files ({files.length})
          </h3>

          {files.length === 0 ? (
            <p className="text-sm text-slate-400">No files selected yet.</p>
          ) : (
            <div className="space-y-3">
              {files.map((file, index) => (
                <div
                  key={`${file.name}-${index}`}
                  className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 p-4"
                >
                  <div className="min-w-0">
                    <p className="break-all font-medium text-slate-700">
                      {file.name}
                    </p>
                    <p className="text-xs text-slate-400">
                      {(file.size / 1024).toFixed(2)} KB
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => removeFile(index)}
                    disabled={uploading}
                    className="shrink-0 text-sm font-medium text-red-500 hover:text-red-700 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Upload Button */}
        <button
          type="button"
          onClick={handleUpload}
          disabled={uploading || files.length === 0}
          className="mt-6 rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {uploading ? "Uploading..." : "Upload Invoices"}
        </button>

        {/* Status Message */}
        {message && (
          <div
            className={`mt-4 rounded-lg p-4 text-sm font-medium ${
              messageType === "success"
                ? "bg-green-50 text-green-700"
                : messageType === "warning"
                  ? "bg-amber-50 text-amber-800"
                  : "bg-red-50 text-red-700"
            }`}
          >
            {message}
          </div>
        )}
      </div>

      {/* Extracted Invoice Details */}
      {processedInvoices.length > 0 && (
        <div className="mt-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-bold text-slate-800">
              Extracted Invoice Details
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Values below were saved from the uploaded invoice files.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Vendor</th>
                  <th className="px-4 py-3">Invoice #</th>
                  <th className="px-4 py-3">Invoice Date</th>
                  <th className="px-4 py-3">Due Date</th>
                  <th className="px-4 py-3">Subtotal</th>
                  <th className="px-4 py-3">Tax</th>
                  <th className="px-4 py-3">Total</th>
                  <th className="px-4 py-3">OCR</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100 text-slate-700">
                {processedInvoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td className="whitespace-nowrap px-4 py-3">
                      {invoice.vendor_name || "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {invoice.invoice_number || "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {invoice.invoice_date || "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {invoice.due_date || "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {invoice.subtotal_amount ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {invoice.tax_amount ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {invoice.total_amount ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                          invoice.ocr_status === "completed"
                            ? "bg-green-100 text-green-700"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {invoice.ocr_status === "completed"
                          ? "Extracted"
                          : "Needs review"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Invoice Register */}
      <section className="mt-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {/* Register Header */}
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 p-5 md:p-6">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Invoice register
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Search, review, and manage uploaded invoice records.
            </p>
          </div>

          <button
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            disabled={loadingInvoices || deletingInvoiceId !== null}
            onClick={loadInvoices}
            type="button"
          >
            {loadingInvoices ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 gap-3 border-b border-slate-200 bg-slate-50/70 p-5 sm:grid-cols-2 xl:grid-cols-6">
          <label className="sm:col-span-2">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Search
            </span>
            <input
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              onChange={setFilter(setSearch)}
              placeholder="Vendor or invoice number"
              type="search"
              value={search}
            />
          </label>

          <label>
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Status
            </span>
            <select
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"
              onChange={setFilter(setStatusFilter)}
              value={statusFilter}
            >
              <option value="">All statuses</option>
              {[
                "UPLOADED",
                "PROCESSING",
                "PENDING",
                "APPROVED",
                "REJECTED",
                "PAID",
                "EXCEPTION",
              ].map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Validation
            </span>
            <select
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"
              onChange={setFilter(setValidationFilter)}
              value={validationFilter}
            >
              <option value="">All validation results</option>
              <option value="VALID">Valid</option>
              <option value="EXCEPTION">Exception</option>
              <option value="DUPLICATE">Duplicate</option>
            </select>
          </label>

          <label>
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Payment status
            </span>
            <select
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"
              onChange={setFilter(setPaymentFilter)}
              value={paymentFilter}
            >
              <option value="">All payment statuses</option>
              <option value="PAID">Paid</option>
              <option value="UNPAID_APPROVED">Approved, unpaid</option>
              <option value="NOT_ELIGIBLE">Not eligible</option>
            </select>
          </label>

          <div className="grid grid-cols-2 gap-2 sm:col-span-2 xl:col-span-1">
            <label>
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Invoice date from
              </span>
              <input
                className="w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 py-2.5 text-sm"
                onChange={setFilter(setStartDate)}
                type="date"
                value={startDate}
              />
            </label>

            <label>
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                To
              </span>
              <input
                className="w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 py-2.5 text-sm"
                onChange={setFilter(setEndDate)}
                type="date"
                value={endDate}
              />
            </label>
          </div>
        </div>

        {/* Load Error */}
        {loadError && (
          <div
            className="m-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"
            role="alert"
          >
            <span>{loadError}</span>
            <button
              className="font-semibold underline"
              onClick={loadInvoices}
              type="button"
            >
              Retry
            </button>
          </div>
        )}

        {/* Table States */}
        {loadingInvoices ? (
          <div className="space-y-3 p-6" aria-label="Loading invoice records">
            {[1, 2, 3, 4].map((row) => (
              <div
                key={row}
                className="h-10 animate-pulse rounded bg-slate-100"
              />
            ))}
          </div>
        ) : !loadError && filteredInvoices.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <p className="font-semibold text-slate-700">
              {invoices.length
                ? "No invoices match these filters"
                : "No invoice records yet"}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {invoices.length
                ? "Try a different search, status, or invoice date range."
                : "Upload an invoice above to start building your register."}
            </p>
          </div>
        ) : !loadError ? (
          <>
            {/* Invoice Table */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1150px] text-left text-sm">
                <thead className="bg-white text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    {sortableColumns.map(([key, label]) => (
                      <th className="whitespace-nowrap px-4 py-3" key={key}>
                        <button
                          className="font-semibold hover:text-blue-700"
                          onClick={() => changeSort(key)}
                          type="button"
                        >
                          {label}
                          {sortKey === key
                            ? sortDirection === "asc"
                              ? " ↑"
                              : " ↓"
                            : ""}
                        </button>
                      </th>
                    ))}
                    <th className="whitespace-nowrap px-4 py-3">Validation</th>
                    <th className="whitespace-nowrap px-4 py-3">Payment</th>
                    <th className="px-4 py-3">Details</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                  {visibleInvoices.map((invoice) => (
                    <tr className="hover:bg-slate-50" key={invoice.id}>
                      <td className="whitespace-nowrap px-4 py-4 font-semibold text-slate-800">
                        {invoice.invoice_number || "—"}
                      </td>
                      <td className="px-4 py-4 text-slate-700">
                        {invoice.vendor_name || "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4">
                        {date(invoice.invoice_date)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4">
                        {date(invoice.due_date)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4">
                        {amount(invoice.subtotal_amount)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4">
                        {amount(invoice.tax_amount)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 font-semibold">
                        {amount(invoice.total_amount)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4">
                        {date(invoice.created_at)}
                      </td>
                      <td className="px-4 py-4">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyle(
                            invoice.status
                          )}`}
                        >
                          {invoice.status || "Unknown"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-4">
                        {(() => {
                          const badge = validationBadge(invoice);

                          return (
                            <span
                              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${badge.style}`}
                            >
                              {badge.label}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4">
                        {Array.isArray(invoice.payment_history) &&
                        invoice.payment_history.length > 0 ? (
                          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                            PAID
                          </span>
                        ) : invoice.status === "APPROVED" ? (
                          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
                            Unpaid
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4">
                        <div className="flex flex-wrap gap-3">
                          {invoice.status === "APPROVED" &&
                            invoice.validation_status === "VALID" &&
                            !invoice.is_duplicate &&
                            (!Array.isArray(invoice.payment_history) ||
                              invoice.payment_history.length === 0) && (
                              <button
                                className="font-semibold text-emerald-700 hover:text-emerald-900"
                                onClick={() =>
                                  setSelectedInvoice({
                                    ...invoice,
                                    open_payment_form: true,
                                  })
                                }
                                type="button"
                              >
                                Record payment
                              </button>
                            )}

                          <button
                            className="font-semibold text-blue-600 hover:text-blue-800"
                            onClick={() => setSelectedInvoice(invoice)}
                            type="button"
                          >
                            View details
                          </button>

                          {/* Delete Individual Invoice */}
                          <button
                            className="font-semibold text-red-600 hover:text-red-800 disabled:cursor-not-allowed disabled:opacity-50"
                            onClick={() => handleDeleteInvoice(invoice)}
                            disabled={deletingInvoiceId !== null}
                            type="button"
                          >
                            {deletingInvoiceId === invoice.id
                              ? "Deleting..."
                              : "Delete"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-4 text-sm text-slate-500">
              <span>
                Showing{" "}
                {filteredInvoices.length === 0
                  ? 0
                  : (page - 1) * PAGE_SIZE + 1}
                –{Math.min(page * PAGE_SIZE, filteredInvoices.length)} of{" "}
                {filteredInvoices.length} invoices
              </span>

              <div className="flex items-center gap-2">
                <button
                  className="rounded-lg border border-slate-300 px-3 py-2 font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => current - 1)}
                  type="button"
                >
                  Previous
                </button>

                <span className="px-2">
                  Page {page} of {pageCount}
                </span>

                <button
                  className="rounded-lg border border-slate-300 px-3 py-2 font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={page >= pageCount}
                  onClick={() => setPage((current) => current + 1)}
                  type="button"
                >
                  Next
                </button>
              </div>
            </footer>
          </>
        ) : null}
      </section>

      {/* Invoice Details Modal */}
      <InvoiceDetailsModal
        invoice={selectedInvoice}
        openPaymentFormOnOpen={Boolean(selectedInvoice?.open_payment_form)}
        onClose={() => setSelectedInvoice(null)}
        onWorkflowChanged={(updatedInvoice) => {
          setSelectedInvoice(updatedInvoice);
          loadInvoices();
        }}
      />
    </div>
  );
}

export default Invoices;
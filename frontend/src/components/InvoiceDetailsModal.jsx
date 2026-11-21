
import { useEffect, useState } from "react";
import {
  getInvoiceFileUrl,
  fetchVendors,
  linkInvoiceVendor,
  performInvoiceWorkflowAction,
  recordInvoicePayment,
  fetchPurchaseOrders,
  matchInvoiceToPurchaseOrder,
  fetchInvoices,
} from "../api/invoices";

const fieldRows = [
  ["Invoice number", "invoice_number"],
  ["Purchase order number", "purchase_order_number"],
  ["Vendor", "vendor_name"],
  ["Invoice date", "invoice_date"],
  ["Due date", "due_date"],
  ["Subtotal", "subtotal_amount", true],
  ["Tax amount", "tax_amount", true],
  ["Total amount", "total_amount", true],
  ["Status", "status"],
  ["Validation", "validation_status"],
  ["Duplicate", "is_duplicate"],
  ["Uploaded", "created_at", false, true],
  ["OCR status", "ocr_status"],
];

function displayValue(value, amount = false, dateTime = false) {
  if (value === null || value === undefined || value === "") return "Not available";

  if (amount) {
    const number = Number(value);
    return Number.isFinite(number)
      ? new Intl.NumberFormat(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(number)
      : value;
  }

  if (dateTime) return new Date(value).toLocaleString();
  if (typeof value === "boolean") return value ? "Yes" : "No";

  return value;
}

function formatLineAmount(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) return "—";

  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(number);
}

function workflowErrorMessage(error) {
  const detail = error?.response?.data?.detail;

  if (typeof detail === "string") return detail;

  return "The workflow action could not be completed. Please try again.";
}

function getList(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.results)) return data.results;
  return [];
}

function InvoiceDetailsModal({
  invoice,
  onClose,
  onWorkflowChanged,
  openPaymentFormOnOpen = false,
}) {
  const fileUrl = getInvoiceFileUrl(invoice);

  const [rejectionReason, setRejectionReason] = useState("");
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const [workflowMessage, setWorkflowMessage] = useState("");
  const [workflowMessageType, setWorkflowMessageType] = useState("");

  const [paymentFormOpen, setPaymentFormOpen] = useState(false);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentMessage, setPaymentMessage] = useState("");
  const [paymentMessageType, setPaymentMessageType] = useState("");

  const [vendors, setVendors] = useState([]);
  const [vendorChoice, setVendorChoice] = useState("");
  const [vendorBusy, setVendorBusy] = useState(false);
  const [vendorMessage, setVendorMessage] = useState("");
  const [vendorMessageType, setVendorMessageType] = useState("");

  // PO matching state
  const [poMatchBusy, setPoMatchBusy] = useState(false);
  const [poMatchMessage, setPoMatchMessage] = useState("");
  const [poMatchMessageType, setPoMatchMessageType] = useState("");
  const [localPOMatch, setLocalPOMatch] = useState(null);

  const [paymentForm, setPaymentForm] = useState({
    amount: invoice?.total_amount || "",
    payment_date: new Date().toISOString().slice(0, 10),
    payment_method: "BANK_TRANSFER",
    reference_number: "",
    notes: "",
  });

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    setPaymentFormOpen(openPaymentFormOnOpen);

    setPaymentForm({
      amount: invoice?.total_amount || "",
      payment_date: new Date().toISOString().slice(0, 10),
      payment_method: "BANK_TRANSFER",
      reference_number: "",
      notes: "",
    });

    setPaymentMessage("");
    setLocalPOMatch(null);
    setPoMatchMessage("");
  }, [invoice?.id, invoice?.total_amount, openPaymentFormOnOpen]);

  useEffect(() => {
    let active = true;

    if (invoice?.id) {
      fetchVendors()
        .then((data) => {
          if (active) {
            setVendors(getList(data));
          }
        })
        .catch(() => {
          if (active) {
            setVendorMessage("Vendor directory could not be loaded.");
          }
        });
    }

    return () => {
      active = false;
    };
  }, [invoice?.id]);

  if (!invoice) return null;

  const lineItems = Array.isArray(invoice.line_items) ? invoice.line_items : [];

  const canSubmit =
    invoice.validation_status === "VALID" && !invoice.is_duplicate;

  const workflowActions = {
    UPLOADED: canSubmit
      ? [
          {
            action: "submit-for-approval",
            label: "Submit for approval",
            style: "bg-blue-600 text-white hover:bg-blue-700",
          },
        ]
      : [],
    PENDING: [
      {
        action: "approve",
        label: "Approve invoice",
        style: "bg-emerald-600 text-white hover:bg-emerald-700",
      },
      {
        action: "reject",
        label: "Reject invoice",
        style: "bg-rose-600 text-white hover:bg-rose-700",
      },
    ],
    REJECTED: canSubmit
      ? [
          {
            action: "resubmit",
            label: "Resubmit for approval",
            style: "bg-blue-600 text-white hover:bg-blue-700",
          },
        ]
      : [],
  };

  // -----------------------------------------------
  // Invoice workflow
  // -----------------------------------------------

  const handleWorkflowAction = async (action, label) => {
    if (
      action === "approve" &&
      !window.confirm(
        "Approve this invoice? This action will be recorded in the approval history."
      )
    ) {
      return;
    }

    if (action === "reject" && !rejectionReason.trim()) {
      setWorkflowMessage("Enter a rejection reason before rejecting this invoice.");
      setWorkflowMessageType("error");
      return;
    }

    setWorkflowBusy(true);
    setWorkflowMessage("");

    try {
      const updatedInvoice = await performInvoiceWorkflowAction(
        invoice.id,
        action,
        action === "reject" ? { reason: rejectionReason.trim() } : {}
      );

      setRejectionReason("");
      setWorkflowMessage(`${label} completed successfully.`);
      setWorkflowMessageType("success");

      onWorkflowChanged?.(updatedInvoice);
    } catch (error) {
      setWorkflowMessage(workflowErrorMessage(error));
      setWorkflowMessageType("error");
    } finally {
      setWorkflowBusy(false);
    }
  };

  // -----------------------------------------------
  // Vendor linking
  // -----------------------------------------------

  const handleVendorLink = async (event) => {
    event.preventDefault();

    if (!vendorChoice) return;

    setVendorBusy(true);
    setVendorMessage("");

    try {
      const updatedInvoice = await linkInvoiceVendor(invoice.id, vendorChoice);

      setVendorMessage("Vendor linked to invoice. OCR vendor text was preserved.");
      setVendorMessageType("success");

      onWorkflowChanged?.(updatedInvoice);
    } catch (error) {
      setVendorMessage(workflowErrorMessage(error));
      setVendorMessageType("error");
    } finally {
      setVendorBusy(false);
    }
  };

  // -----------------------------------------------
  // Purchase order matching
  // -----------------------------------------------

  const handlePOMatch = async () => {
    const invoicePONumber = invoice.purchase_order_number;

    if (!invoicePONumber) {
      setPoMatchMessage("This invoice does not have a PO number to match.");
      setPoMatchMessageType("error");
      return;
    }

    setPoMatchBusy(true);
    setPoMatchMessage("");
    setLocalPOMatch(null);

    try {
      // Step 1: Get purchase orders
      const poData = await fetchPurchaseOrders();
      const purchaseOrders = getList(poData);

      // Step 2: Find the exact PO number
      const matchingPO = purchaseOrders.find(
        (po) =>
          String(po.po_number).trim().toLowerCase() ===
          String(invoicePONumber).trim().toLowerCase()
      );

      if (!matchingPO) {
        setPoMatchMessage(
          `Purchase order ${invoicePONumber} was not found in the purchase order register.`
        );
        setPoMatchMessageType("error");
        return;
      }

      // Step 3: Run the existing backend match endpoint
      const matchResponse = await matchInvoiceToPurchaseOrder(
        matchingPO.id,
        invoice.id,
        invoicePONumber
      );

      // Build a result for immediate display in this modal
      const matchResult = {
        result: matchResponse.result || "PARTIAL_MATCH",
        purchase_order_number:
          matchingPO.po_number || invoicePONumber,
        explanations: Array.isArray(matchResponse.explanations)
          ? matchResponse.explanations
          : [],
      };

      setLocalPOMatch(matchResult);

      // Step 4: Refresh invoice list to retrieve saved match information
      try {
        const refreshedData = await fetchInvoices();
        const refreshedInvoices = getList(refreshedData);

        const refreshedInvoice = refreshedInvoices.find(
          (item) => String(item.id) === String(invoice.id)
        );

        if (refreshedInvoice) {
          onWorkflowChanged?.(refreshedInvoice);

          // Prefer the saved match returned by the refreshed invoice
          if (refreshedInvoice.latest_po_match) {
            setLocalPOMatch(refreshedInvoice.latest_po_match);
          }
        }
      } catch (refreshError) {
        // Match succeeded; refreshing is optional
      }

      setPoMatchMessage("Purchase order matching completed successfully.");
      setPoMatchMessageType("success");
    } catch (error) {
      const detail = error?.response?.data?.detail;

      setPoMatchMessage(
        typeof detail === "string"
          ? detail
          : "PO matching failed. Please check the backend connection and try again."
      );

      setPoMatchMessageType("error");
    } finally {
      setPoMatchBusy(false);
    }
  };

  // -----------------------------------------------
  // Payment
  // -----------------------------------------------

  const canRecordPayment =
    invoice.status === "APPROVED" &&
    invoice.validation_status === "VALID" &&
    !invoice.is_duplicate &&
    (!Array.isArray(invoice.payment_history) ||
      invoice.payment_history.length === 0);

  const handlePaymentSubmit = async (event) => {
    event.preventDefault();

    const amountValue = Number(paymentForm.amount);

    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      setPaymentMessage("Payment amount must be greater than zero.");
      setPaymentMessageType("error");
      return;
    }

    if (amountValue > Number(invoice.total_amount)) {
      setPaymentMessage("Payment amount cannot exceed the invoice total.");
      setPaymentMessageType("error");
      return;
    }

    if (!paymentForm.payment_date || !paymentForm.payment_method) {
      setPaymentMessage("Enter a payment date and method.");
      setPaymentMessageType("error");
      return;
    }

    setPaymentBusy(true);
    setPaymentMessage("");

    try {
      const updatedInvoice = await recordInvoicePayment(invoice.id, paymentForm);

      setPaymentMessage("Payment recorded and invoice marked PAID.");
      setPaymentMessageType("success");
      setPaymentFormOpen(false);

      onWorkflowChanged?.(updatedInvoice);
    } catch (error) {
      const detail = error?.response?.data?.detail;

      setPaymentMessage(
        typeof detail === "string"
          ? detail
          : error?.response?.data
            ? Object.values(error.response.data).flat().join(" ")
            : "Payment could not be recorded. Please check the backend connection and try again."
      );

      setPaymentMessageType("error");
    } finally {
      setPaymentBusy(false);
    }
  };

  const displayedPOMatch = localPOMatch || invoice.latest_po_match;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-labelledby="invoice-detail-title"
        aria-modal="true"
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl"
        role="dialog"
      >
        <header className="sticky top-0 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
              Invoice details
            </p>
            <h2
              id="invoice-detail-title"
              className="mt-1 text-xl font-bold text-slate-900"
            >
              {invoice.invoice_number || `Invoice #${invoice.id}`}
            </h2>
          </div>

          <button
            aria-label="Close invoice details"
            className="rounded-lg px-3 py-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </header>

        <div className="p-6">
          {/* Invoice fields */}
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {fieldRows.map(([label, key, currency, dateTime]) => (
              <div key={key} className="rounded-xl bg-slate-50 p-4">
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  {label}
                </dt>
                <dd className="mt-1 break-words font-semibold text-slate-900">
                  {displayValue(invoice[key], currency, dateTime)}
                </dd>
              </div>
            ))}
          </dl>

          {/* ----------------------------------------------- */}
          {/* EXTRACTED LINE ITEMS */}
          {/* ----------------------------------------------- */}

          <div className="mt-5 rounded-xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-slate-900">
                  Extracted line items
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  Products and quantities detected from the invoice OCR.
                </p>
              </div>

              <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                {lineItems.length} item{lineItems.length !== 1 ? "s" : ""}
              </span>
            </div>

            {lineItems.length > 0 ? (
              <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-[650px] text-sm">
                  <thead className="bg-slate-50">
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="px-4 py-3 font-semibold">Description</th>
                      <th className="px-4 py-3 text-right font-semibold">Qty</th>
                      <th className="px-4 py-3 text-right font-semibold">
                        Unit price
                      </th>
                      <th className="px-4 py-3 text-right font-semibold">
                        Line total
                      </th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-100">
                    {lineItems.map((item, index) => (
                      <tr
                        className="hover:bg-slate-50"
                        key={item.id || index}
                      >
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-900">
                            {item.description || "Unnamed item"}
                          </p>

                          {item.product_code && (
                            <p className="mt-1 text-xs text-slate-500">
                              Code: {item.product_code}
                            </p>
                          )}
                        </td>

                        <td className="px-4 py-3 text-right text-slate-700">
                          {displayValue(item.quantity)}
                        </td>

                        <td className="px-4 py-3 text-right text-slate-700">
                          {formatLineAmount(item.unit_price)}
                        </td>

                        <td className="px-4 py-3 text-right font-semibold text-slate-900">
                          {formatLineAmount(item.line_total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>

                  <tfoot className="border-t-2 border-slate-200 bg-slate-50">
                    <tr>
                      <td
                        className="px-4 py-3 font-semibold text-slate-900"
                        colSpan={3}
                      >
                        Extracted items total
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-slate-900">
                        {formatLineAmount(
                          lineItems.reduce(
                            (sum, item) => sum + Number(item.line_total || 0),
                            0
                          )
                        )}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <div className="mt-4 rounded-lg bg-slate-50 px-4 py-6 text-center">
                <p className="text-sm font-medium text-slate-600">
                  No line items extracted for this invoice.
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Line items will appear here after OCR processing detects the
                  products and quantities.
                </p>
              </div>
            )}
          </div>

          {/* Vendor record */}
          <div className="mt-5 rounded-xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-slate-900">Vendor record</h3>
                <p className="mt-1 text-sm text-slate-600">
                  OCR vendor text: {invoice.vendor_name || "Not extracted"}
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  Linked vendor: {invoice.vendor_details?.name || "Not linked"}
                  {invoice.vendor_details?.vendor_code
                      ? ` · ${invoice.vendor_details.vendor_code}`
                      : ""}
                </p>
              </div>
            </div>

            {!invoice.vendor_details && (
              <form className="mt-3 flex flex-wrap gap-2" onSubmit={handleVendorLink}>
                <select
                  className="min-w-[220px] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  onChange={(event) => setVendorChoice(event.target.value)}
                  value={vendorChoice}
                >
                  <option value="">Select registered vendor to link</option>
                  {vendors.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>
                      {vendor.name} · {vendor.vendor_code}
                      {vendor.status === "INACTIVE" ? " (Inactive)" : ""}
                    </option>
                  ))}
                </select>

                <button
                  className="rounded-lg border border-blue-200 px-4 py-2 text-sm font-semibold text-blue-700 disabled:opacity-50"
                  disabled={vendorBusy || !vendorChoice}
                  type="submit"
                >
                  {vendorBusy ? "Linking…" : "Link vendor"}
                </button>
              </form>
            )}

            {vendorMessage && (
              <p
                className={`mt-2 text-sm ${
                  vendorMessageType === "success"
                    ? "text-emerald-700"
                    : "text-rose-700"
                }`}
                role="status"
              >
                {vendorMessage}
              </p>
            )}
          </div>

          {/* Purchase order matching */}
          <div className="mt-5 rounded-xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-slate-900">
                  Purchase order match
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  {invoice.purchase_order_number
                    ? `Invoice PO reference: ${invoice.purchase_order_number}`
                    : "No PO number was extracted from this invoice."}
                </p>
              </div>

              {displayedPOMatch && (
                <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                  {displayedPOMatch.result.replaceAll("_", " ")}
                </span>
              )}
            </div>

            {invoice.purchase_order_number && (
              <button
                className="mt-3 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={poMatchBusy}
                onClick={handlePOMatch}
                type="button"
              >
                {poMatchBusy ? "Matching purchase order…" : "Run PO Match"}
              </button>
            )}

            {displayedPOMatch ? (
              <div className="mt-3 space-y-2">
                <p className="text-sm font-medium text-slate-700">
                  Compared with {displayedPOMatch.purchase_order_number}
                </p>

                {Array.isArray(displayedPOMatch.explanations) &&
                displayedPOMatch.explanations.length > 0 ? (
                  <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
                    {displayedPOMatch.explanations.map((item, index) => (
                      <li key={`${item.check}-${index}`}>{item.message}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500">
                    Comparison was recorded. Refresh to see the detailed comparison checks.
                  </p>
                )}

                <p className="text-xs text-slate-500">
                  Matching is advisory only and does not change approval or payment status.
                </p>
              </div>
            ) : (
              <p className="mt-2 text-sm text-slate-500">
                No purchase order comparison recorded yet.
              </p>
            )}

            {poMatchMessage && (
              <p
                className={`mt-3 rounded-lg p-3 text-sm ${
                  poMatchMessageType === "success"
                    ? "bg-emerald-50 text-emerald-800"
                    : "bg-rose-50 text-rose-800"
                }`}
                role="status"
              >
                {poMatchMessage}
              </p>
            )}
          </div>

          {/* Approval workflow */}
          <div className="mt-5 rounded-xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-slate-900">
                  Approval workflow
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  Current status:{" "}
                  <span className="font-semibold">{invoice.status || "Unknown"}</span>
                </p>
              </div>

              {workflowActions[invoice.status]?.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {workflowActions[invoice.status].map(
                    ({ action, label, style }) => (
                      <button
                        className={`rounded-lg px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${style}`}
                        disabled={workflowBusy}
                        key={action}
                        onClick={() => handleWorkflowAction(action, label)}
                        type="button"
                      >
                        {workflowBusy ? "Saving…" : label}
                      </button>
                    )
                  )}
                </div>
              )}
            </div>

            {invoice.status === "PENDING" && (
              <label className="mt-4 block">
                <span className="mb-1 block text-sm font-medium text-slate-700">
                  Rejection reason (required to reject)
                </span>
                <textarea
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  disabled={workflowBusy}
                  onChange={(event) => setRejectionReason(event.target.value)}
                  placeholder="Explain why this invoice is being rejected"
                  rows={3}
                  value={rejectionReason}
                />
              </label>
            )}

            {invoice.rejection_reason && (
              <p className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">
                <span className="font-semibold">Rejection reason:</span>{" "}
                {invoice.rejection_reason}
                {invoice.rejected_at && (
                  <span className="mt-1 block text-xs">
                    Rejected {new Date(invoice.rejected_at).toLocaleString()}
                  </span>
                )}
              </p>
            )}

            {workflowMessage && (
              <p
                className={`mt-3 rounded-lg p-3 text-sm ${
                  workflowMessageType === "success"
                    ? "bg-emerald-50 text-emerald-800"
                    : "bg-rose-50 text-rose-800"
                }`}
                role="status"
              >
                {workflowMessage}
              </p>
            )}

            {Array.isArray(invoice.approval_history) && (
              <div className="mt-5 border-t border-slate-200 pt-4">
                <h4 className="text-sm font-semibold text-slate-900">
                  Approval history
                </h4>

                {invoice.approval_history.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-500">
                    No approval actions recorded yet.
                  </p>
                ) : (
                  <ol className="mt-3 space-y-3">
                    {invoice.approval_history.map((entry) => (
                      <li
                        className="relative border-l-2 border-blue-100 pl-4"
                        key={entry.id}
                      >
                        <span className="absolute -left-[5px] top-1 h-2 w-2 rounded-full bg-blue-500" />
                        <p className="text-sm font-medium capitalize text-slate-800">
                          {entry.action} · {entry.previous_status} → {entry.new_status}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {entry.timestamp
                            ? new Date(entry.timestamp).toLocaleString()
                            : "Time unavailable"}
                          {entry.performed_by_name
                            ? ` · ${entry.performed_by_name}`
                            : " · User not recorded"}
                        </p>
                        {entry.rejection_reason && (
                          <p className="mt-1 text-sm text-rose-700">
                            Reason: {entry.rejection_reason}
                          </p>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </div>

          {/* Payment */}
          <div className="mt-5 rounded-xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-slate-900">Payment</h3>
                <p className="mt-1 text-sm text-slate-600">
                  {invoice.status === "PAID"
                    ? "Payment recorded for this invoice."
                    : invoice.status === "APPROVED"
                      ? "Approved invoice is eligible for payment recording."
                      : "Payment can only be recorded after approval."}
                </p>
              </div>

              {canRecordPayment && !paymentFormOpen && (
                <button
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                  onClick={() => {
                    setPaymentForm({
                      amount: invoice.total_amount || "",
                      payment_date: new Date().toISOString().slice(0, 10),
                      payment_method: "BANK_TRANSFER",
                      reference_number: "",
                      notes: "",
                    });
                    setPaymentMessage("");
                    setPaymentFormOpen(true);
                  }}
                  type="button"
                >
                  Record payment
                </button>
              )}
            </div>

            {paymentFormOpen && canRecordPayment && (
              <form
                className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2"
                onSubmit={handlePaymentSubmit}
              >
                <label>
                  <span className="mb-1 block text-sm font-medium text-slate-700">
                    Payment amount
                  </span>
                  <input
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    max={invoice.total_amount}
                    min="0.01"
                    onChange={(event) =>
                      setPaymentForm((previous) => ({
                        ...previous,
                        amount: event.target.value,
                      }))
                    }
                    required
                    step="0.01"
                    type="number"
                    value={paymentForm.amount}
                  />
                  <span className="mt-1 block text-xs text-slate-500">
                    Invoice total: {displayValue(invoice.total_amount, true)}
                  </span>
                </label>

                <label>
                  <span className="mb-1 block text-sm font-medium text-slate-700">
                    Payment date
                  </span>
                  <input
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(event) =>
                      setPaymentForm((previous) => ({
                        ...previous,
                        payment_date: event.target.value,
                      }))
                    }
                    required
                    type="date"
                    value={paymentForm.payment_date}
                  />
                </label>

                <label>
                  <span className="mb-1 block text-sm font-medium text-slate-700">
                    Payment method
                  </span>
                  <select
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    onChange={(event) =>
                      setPaymentForm((previous) => ({
                        ...previous,
                        payment_method: event.target.value,
                      }))
                    }
                    value={paymentForm.payment_method}
                  >
                    <option value="BANK_TRANSFER">Bank Transfer</option>
                    <option value="UPI">UPI</option>
                    <option value="CHEQUE">Cheque</option>
                    <option value="CASH">Cash</option>
                    <option value="OTHER">Other</option>
                  </select>
                </label>

                <label>
                  <span className="mb-1 block text-sm font-medium text-slate-700">
                    Transaction/reference number
                  </span>
                  <input
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    maxLength={255}
                    onChange={(event) =>
                      setPaymentForm((previous) => ({
                        ...previous,
                        reference_number: event.target.value,
                      }))
                    }
                    type="text"
                    value={paymentForm.reference_number}
                  />
                </label>

                <label className="sm:col-span-2">
                  <span className="mb-1 block text-sm font-medium text-slate-700">
                    Notes (optional)
                  </span>
                  <textarea
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    onChange={(event) =>
                      setPaymentForm((previous) => ({
                        ...previous,
                        notes: event.target.value,
                      }))
                    }
                    rows={2}
                    value={paymentForm.notes}
                  />
                </label>

                <div className="flex flex-wrap gap-2 sm:col-span-2">
                  <button
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    disabled={paymentBusy}
                    type="submit"
                  >
                    {paymentBusy ? "Recording…" : "Save payment"}
                  </button>

                  <button
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
                    disabled={paymentBusy}
                    onClick={() => setPaymentFormOpen(false)}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {paymentMessage && (
              <p
                className={`mt-3 rounded-lg p-3 text-sm ${
                  paymentMessageType === "success"
                    ? "bg-emerald-50 text-emerald-800"
                    : "bg-rose-50 text-rose-800"
                }`}
                role="status"
              >
                {paymentMessage}
              </p>
            )}

            {Array.isArray(invoice.payment_history) &&
              invoice.payment_history.length > 0 && (
                <div className="mt-4 border-t border-slate-200 pt-4">
                  <h4 className="text-sm font-semibold text-slate-900">
                    Payment history
                  </h4>

                  <ol className="mt-3 space-y-3">
                    {invoice.payment_history.map((payment) => (
                      <li
                        className="rounded-lg bg-emerald-50/70 p-3 text-sm"
                        key={payment.id}
                      >
                        <div className="flex flex-wrap justify-between gap-2">
                          <span className="font-semibold text-slate-900">
                            {displayValue(payment.amount, true)} ·{" "}
                            {payment.payment_method_display || payment.payment_method}
                          </span>
                          <span className="text-slate-600">
                            {payment.payment_date
                              ? new Date(
                                  `${payment.payment_date}T00:00:00`
                                ).toLocaleDateString()
                              : "—"}
                          </span>
                        </div>

                        {payment.reference_number && (
                          <p className="mt-1 text-slate-600">
                            Reference: {payment.reference_number}
                          </p>
                        )}

                        {payment.notes && (
                          <p className="mt-1 text-slate-600">{payment.notes}</p>
                        )}

                        <p className="mt-1 text-xs text-slate-500">
                          Recorded{" "}
                          {payment.created_at
                            ? new Date(payment.created_at).toLocaleString()
                            : ""}
                          {payment.created_by_name
                            ? ` by ${payment.created_by_name}`
                            : " · User not recorded"}
                        </p>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
          </div>

          {/* Validation */}
          <div className="mt-5 rounded-xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-slate-900">
                  Automated validation
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  {invoice.is_duplicate
                    ? `Duplicate of invoice #${invoice.duplicate_of || "another record"}.`
                    : invoice.validation_status === "VALID"
                      ? "All invoice validation checks passed."
                      : invoice.validation_status === "EXCEPTION"
                        ? "This invoice needs review before processing."
                        : "Validation has not been recorded for this invoice."}
                </p>
              </div>

              {invoice.is_duplicate ? (
                <span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700">
                  Duplicate
                </span>
              ) : invoice.validation_status === "VALID" ? (
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                  Valid
                </span>
              ) : invoice.validation_status === "EXCEPTION" ? (
                <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700">
                  Exception
                </span>
              ) : null}
            </div>

            {Array.isArray(invoice.validation_errors) &&
              invoice.validation_errors.length > 0 && (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-rose-700">
                  {invoice.validation_errors.map((reason, index) => (
                    <li key={`${index}-${reason}`}>{reason}</li>
                  ))}
                </ul>
              )}
          </div>

          {/* OCR result */}
          <div className="mt-5 rounded-xl border border-slate-200 p-4">
            <h3 className="font-semibold text-slate-900">OCR result</h3>

            <p className="mt-2 text-sm text-slate-600">
              {invoice.ocr_status === "failed"
                ? "OCR could not extract invoice data. Review the saved file and enter missing values manually."
                : invoice.ocr_status === "completed"
                  ? "OCR processing completed. Check extracted fields for accuracy."
                  : "OCR status is not recorded for this invoice."}
            </p>

            {invoice.ocr_error && (
              <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                {invoice.ocr_error}
              </p>
            )}

            {fileUrl ? (
              <div className="mt-4 flex flex-wrap gap-3">
                <a
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                  href={fileUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  View invoice
                </a>

                <a
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  download
                  href={fileUrl}
                >
                  Download original
                </a>
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-500">
                Original file link unavailable.
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

export default InvoiceDetailsModal;

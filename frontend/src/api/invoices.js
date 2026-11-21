import axios from "axios";

const API_BASE_URL =
    import.meta.env.VITE_API_URL || "http://127.0.0.1:8000/api";

const INVOICE_API_URL = `${API_BASE_URL}/invoices/`;
const REPORTS_API_URL = `${API_BASE_URL}/reports/`;
const VENDORS_API_URL = `${API_BASE_URL}/vendors/`;
const PURCHASE_ORDERS_API_URL = `${API_BASE_URL}/purchase-orders/`;
const PO_MATCHES_API_URL = `${API_BASE_URL}/po-matches/`;

export async function fetchInvoices() {
    const response = await axios.get(INVOICE_API_URL);
    return response.data;
}

export async function performInvoiceWorkflowAction(invoiceId, action, data = {}) {
    const response = await axios.post(
        `${INVOICE_API_URL}${invoiceId}/${action}/`,
        data
    );
    return response.data;
}

export function getInvoiceFileUrl(invoice) {
    if (!invoice || !invoice.invoice_file) return null;

    if (/^https?:\/\//i.test(invoice.invoice_file)) {
        return invoice.invoice_file;
    }

    const backendBase = API_BASE_URL.replace(/\/api\/?$/, "");

    return new URL(invoice.invoice_file, backendBase).toString();
}

export function notifyInvoicesUpdated() {
    window.dispatchEvent(new Event("invoicepilot:invoices-updated"));
}

export async function recordInvoicePayment(invoiceId, paymentData) {
    const response = await axios.post(
        `${INVOICE_API_URL}${invoiceId}/record-payment/`,
        paymentData
    );
    return response.data;
}

export async function fetchPaymentSummary() {
    const response = await axios.get(`${INVOICE_API_URL}payment-summary/`);
    return response.data;
}

// NEW: Invoice Aging & Overdue Summary
export async function fetchAgingSummary() {
    const response = await axios.get(`${INVOICE_API_URL}aging-summary/`);
    return response.data;
}

export async function fetchReports(filters = {}) {
    const response = await axios.get(REPORTS_API_URL, { params: filters });
    return response.data;
}

export async function downloadReportCsv(reportType, filters = {}) {
    const response = await axios.get(
        `${REPORTS_API_URL}export/${reportType}.csv`, { params: filters, responseType: "blob" }
    );
    return response.data;
}

export async function fetchVendors(params = {}) {
    const response = await axios.get(VENDORS_API_URL, { params });
    return response.data;
}

export async function fetchVendor(vendorId) {
    const response = await axios.get(`${VENDORS_API_URL}${vendorId}/`);
    return response.data;
}

export async function saveVendor(vendor, vendorId = null) {
    const response = vendorId ?
        await axios.patch(`${VENDORS_API_URL}${vendorId}/`, vendor) :
        await axios.post(VENDORS_API_URL, vendor);
    return response.data;
}

export async function setVendorActive(vendorId, active) {
    const response = await axios.post(
        `${VENDORS_API_URL}${vendorId}/${active ? "activate" : "deactivate"}/`, {}
    );
    return response.data;
}

export async function fetchPurchaseOrders(params = {}) {
    const response = await axios.get(PURCHASE_ORDERS_API_URL, { params });
    return response.data;
}

export async function savePurchaseOrder(purchaseOrder, purchaseOrderId = null) {
    const response = purchaseOrderId ?
        await axios.patch(`${PURCHASE_ORDERS_API_URL}${purchaseOrderId}/`, purchaseOrder) :
        await axios.post(PURCHASE_ORDERS_API_URL, purchaseOrder);
    return response.data;
}

export async function performPurchaseOrderAction(purchaseOrderId, action, data = {}) {
    const response = await axios.post(
        `${PURCHASE_ORDERS_API_URL}${purchaseOrderId}/${action}/`,
        data
    );
    return response.data;
}

export async function transitionPurchaseOrder(purchaseOrderId, nextStatus) {
    const response = await axios.post(
        `${PURCHASE_ORDERS_API_URL}${purchaseOrderId}/transition/`, { status: nextStatus }
    );
    return response.data;
}

export async function fetchInvoiceVendorCandidates(invoiceId) {
    const response = await axios.get(`${INVOICE_API_URL}${invoiceId}/vendor-link/`);
    return response.data;
}

export async function linkInvoiceVendor(invoiceId, vendorId) {
    const response = await axios.post(
        `${INVOICE_API_URL}${invoiceId}/vendor-link/`, { vendor_id: vendorId }
    );
    return response.data;
}

export async function matchInvoiceToPurchaseOrder(
    purchaseOrderId,
    invoiceId,
    invoicePoNumber = ""
) {
    const response = await axios.post(
        `${PURCHASE_ORDERS_API_URL}${purchaseOrderId}/match-invoice/`, {
            invoice_id: invoiceId,
            invoice_po_number: invoicePoNumber,
        }
    );
    return response.data;
}

export async function fetchInvoiceMatches() {
    const response = await axios.get(PO_MATCHES_API_URL);
    return response.data;
}
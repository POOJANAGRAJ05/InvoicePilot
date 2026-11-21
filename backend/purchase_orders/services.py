from decimal import Decimal

from django.db import transaction

from invoices.models import Invoice
from vendors.models import Vendor
from .models import InvoicePurchaseOrderMatch, PurchaseOrder

MATCH_TOLERANCE = Decimal("1.00")


class PurchaseOrderMatchError(Exception):
    """Raised when a PO cannot be used for invoice matching."""


def _normalized(value):
    return " ".join((value or "").split()).casefold()


def evaluate_invoice_match(invoice, purchase_order):
    explanations = []
    hard_mismatch = False
    partial = False

    if invoice.vendor_id:
        vendor_matches = invoice.vendor_id == purchase_order.vendor_id
        vendor_description = "Invoice is linked to the selected PO vendor." if vendor_matches else "Invoice is linked to a different registered vendor."
    else:
        invoice_vendor_name = _normalized(invoice.vendor_name)
        vendor_name = _normalized(purchase_order.vendor.name)
        vendor_matches = bool(invoice_vendor_name and invoice_vendor_name == vendor_name)
        vendor_description = (
            "OCR vendor name matches the PO vendor name; invoice remains unlinked."
            if vendor_matches
            else "OCR vendor name does not match the PO vendor name; invoice remains unlinked."
        )
    explanations.append({"check": "vendor", "passed": vendor_matches, "message": vendor_description})
    if not vendor_matches:
        hard_mismatch = True

    if invoice.purchase_order_number:
        po_number_matches = _normalized(invoice.purchase_order_number) == _normalized(purchase_order.po_number)
        explanations.append({
            "check": "po_number",
            "passed": po_number_matches,
            "message": "PO number matches." if po_number_matches else f"Invoice references {invoice.purchase_order_number}, not {purchase_order.po_number}.",
        })
        if not po_number_matches:
            hard_mismatch = True
    else:
        partial = True
        explanations.append({"check": "po_number", "passed": None, "message": "Invoice has no extracted or entered PO number; selected PO is compared manually."})

    if invoice.subtotal_amount is None:
        partial = True
        explanations.append({"check": "subtotal", "passed": None, "message": "Invoice subtotal is missing; subtotal comparison could not be performed."})
    else:
        subtotal_difference = abs(invoice.subtotal_amount - purchase_order.subtotal_amount)
        subtotal_matches = subtotal_difference <= MATCH_TOLERANCE
        explanations.append({
            "check": "subtotal",
            "passed": subtotal_matches,
            "message": "Subtotal amounts are within ₹1.00." if subtotal_matches else f"Invoice subtotal differs from PO subtotal by ₹{subtotal_difference:.2f}.",
        })
        if not subtotal_matches:
            hard_mismatch = True

    if invoice.total_amount is None:
        partial = True
        explanations.append({"check": "total", "passed": None, "message": "Invoice total is missing; total comparison could not be performed."})
    else:
        total_difference = abs(invoice.total_amount - purchase_order.total_amount)
        total_matches = total_difference <= MATCH_TOLERANCE
        explanations.append({
            "check": "total",
            "passed": total_matches,
            "message": "Invoice and PO totals are within ₹1.00." if total_matches else f"Invoice total differs from PO total by ₹{total_difference:.2f}.",
        })
        if not total_matches:
            hard_mismatch = True

    if invoice.tax_amount is None:
        partial = True
        explanations.append({"check": "tax", "passed": None, "message": "Invoice tax is missing; tax comparison could not be performed."})
    else:
        tax_difference = abs(invoice.tax_amount - purchase_order.tax_amount)
        tax_matches = tax_difference <= MATCH_TOLERANCE
        explanations.append({
            "check": "tax",
            "passed": tax_matches,
            "message": "Tax amounts are within ₹1.00." if tax_matches else f"Invoice tax differs from PO tax by ₹{tax_difference:.2f}.",
        })
        if not tax_matches:
            hard_mismatch = True

    # The current OCR/model has no invoice line-item extraction, so line comparison
    # is intentionally reported as unavailable rather than inferred or fabricated.
    partial = True
    explanations.append({"check": "line_items", "passed": None, "message": "Invoice line items are not available for comparison; PO item details are retained for manual review."})

    result = "MISMATCH" if hard_mismatch else ("PARTIAL_MATCH" if partial else "MATCHED")
    return result, explanations


def create_invoice_match(invoice_id, purchase_order_id, invoice_po_number=None):
    with transaction.atomic():
        # Lock only the invoice row: locking its nullable vendor join is unsupported by PostgreSQL.
        invoice = Invoice.objects.select_for_update().get(pk=invoice_id)
        purchase_order = PurchaseOrder.objects.select_for_update().select_related("vendor").prefetch_related("line_items").get(pk=purchase_order_id)
        if purchase_order.status == "CANCELLED":
            raise PurchaseOrderMatchError("A cancelled purchase order cannot be matched.")
        if invoice_po_number is not None:
            invoice.purchase_order_number = str(invoice_po_number).strip()[:40]
            invoice.save(update_fields=["purchase_order_number"])
        result, explanations = evaluate_invoice_match(invoice, purchase_order)
        match = InvoicePurchaseOrderMatch.objects.create(
            invoice=invoice,
            purchase_order=purchase_order,
            result=result,
            explanations=explanations,
        )
        return match


def vendor_name_matches(vendor_name, gstin="", *, exclude_id=None):
    normalized_name = Vendor.normalize_name(vendor_name)
    normalized_gstin = Vendor.normalize_tax_id(gstin)
    queryset = Vendor.objects.all()
    if exclude_id:
        queryset = queryset.exclude(pk=exclude_id)
    exact_name_matches = [
        vendor for vendor in queryset
        if Vendor.normalize_name(vendor.name) == normalized_name
    ]
    if normalized_gstin:
        exact_name_matches = [
            vendor for vendor in exact_name_matches
            if Vendor.normalize_tax_id(vendor.tax_registration_number) == normalized_gstin
        ]
    return exact_name_matches

from decimal import Decimal

from django.db.models.functions import Lower, Trim

from .models import Invoice

ROUNDING_TOLERANCE = Decimal("1.00")


def _normalized_identity(value):
    return " ".join((value or "").split()).casefold()


def _matching_invoices(vendor_name, invoice_number, exclude_pk=None):
    normalized_vendor = _normalized_identity(vendor_name)
    normalized_number = _normalized_identity(invoice_number)
    if not normalized_vendor or not normalized_number:
        return Invoice.objects.none()

    matches = Invoice.objects.annotate(
        normalized_invoice_number=Lower(Trim("invoice_number"))
    ).filter(normalized_invoice_number=normalized_number)
    if exclude_pk is not None:
        matches = matches.exclude(pk=exclude_pk)
    # Database case-insensitive comparison handles case; verify whitespace-normalized
    # identity in Python to avoid treating formatting differences as distinct.
    return [
        candidate
        for candidate in matches.order_by("created_at", "pk")
        if _normalized_identity(candidate.vendor_name) == normalized_vendor
        and _normalized_identity(candidate.invoice_number) == normalized_number
    ]


def validate_invoice(invoice, *, save=True):
    """Validate invoice fields and duplicate identity, persisting the result by default."""
    errors = []
    required_fields = (
        ("vendor_name", "Vendor name is missing."),
        ("invoice_number", "Invoice number is missing."),
        ("invoice_date", "Invoice date is missing."),
        ("due_date", "Due date is missing."),
        ("subtotal_amount", "Subtotal is missing."),
        ("tax_amount", "Tax amount is missing."),
        ("total_amount", "Total amount is missing."),
    )
    for field, message in required_fields:
        value = getattr(invoice, field, None)
        if value is None or (isinstance(value, str) and not value.strip()):
            errors.append(message)

    if invoice.invoice_date and invoice.due_date and invoice.due_date < invoice.invoice_date:
        errors.append("Due date is earlier than invoice date.")

    amount_fields = (
        ("subtotal_amount", "Subtotal"),
        ("tax_amount", "Tax amount"),
        ("total_amount", "Total amount"),
    )
    for field, label in amount_fields:
        value = getattr(invoice, field, None)
        if value is not None and value < 0:
            errors.append(f"{label} cannot be negative.")

    subtotal = invoice.subtotal_amount
    tax = invoice.tax_amount
    total = invoice.total_amount
    if tax is not None and total is not None and tax > total:
        errors.append("Tax amount is greater than the total amount.")
    if subtotal is not None and tax is not None and total is not None:
        if abs(subtotal + tax - total) > ROUNDING_TOLERANCE:
            errors.append("Subtotal plus tax does not match the total (tolerance: ₹1.00).")

    duplicate_matches = _matching_invoices(
        invoice.vendor_name, invoice.invoice_number, exclude_pk=invoice.pk
    )
    earlier_matches = [
        candidate
        for candidate in duplicate_matches
        if (candidate.created_at, candidate.pk) < (invoice.created_at, invoice.pk)
    ]
    duplicate_of = earlier_matches[0] if earlier_matches else None
    if duplicate_of:
        errors.append(
            f"Duplicate invoice: vendor and invoice number match invoice #{duplicate_of.pk}."
        )

    invoice.is_duplicate = duplicate_of is not None
    invoice.duplicate_of = duplicate_of
    invoice.validation_errors = errors
    invoice.validation_status = "EXCEPTION" if errors else "VALID"
    if errors:
        invoice.status = "EXCEPTION"
    elif invoice.rejected_at is not None:
        invoice.status = "REJECTED"
    elif invoice.status == "EXCEPTION":
        invoice.status = "UPLOADED"

    if save:
        invoice.save(
            update_fields=[
                "is_duplicate",
                "duplicate_of",
                "validation_errors",
                "validation_status",
                "status",
            ]
        )
    return errors


def revalidate_duplicate_group(vendor_name, invoice_number):
    """Recalculate every existing record sharing an invoice identity."""
    matches = _matching_invoices(vendor_name, invoice_number)
    for invoice in matches:
        validate_invoice(invoice)
    return matches

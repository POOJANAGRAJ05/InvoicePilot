from django.db import IntegrityError, transaction
from django.utils import timezone

from invoices.models import Invoice
from .models import Payment


class PaymentRecordingError(Exception):
    """Raised when payment cannot be safely recorded against an invoice."""


def record_invoice_payment(invoice_id, payment_data, *, actor=None):
    """Atomically record one payment and mark its approved invoice as paid."""
    with transaction.atomic():
        try:
            invoice = Invoice.objects.select_for_update().get(pk=invoice_id)
        except Invoice.DoesNotExist as error:
            raise PaymentRecordingError("Invoice was not found.") from error

        if invoice.status != "APPROVED":
            raise PaymentRecordingError(
                f"Payment can only be recorded for APPROVED invoices; this invoice is {invoice.status}."
            )
        if invoice.is_duplicate:
            raise PaymentRecordingError("Payment cannot be recorded for a duplicate invoice.")
        if invoice.validation_status != "VALID":
            raise PaymentRecordingError("Payment cannot be recorded for an invoice that has not passed validation.")
        if invoice.total_amount is None:
            raise PaymentRecordingError("Payment cannot be recorded because the invoice total is missing.")
        if hasattr(invoice, "payment"):
            raise PaymentRecordingError("A payment has already been recorded for this invoice.")
        if payment_data["amount"] <= 0:
            raise PaymentRecordingError("Payment amount must be greater than zero.")
        if payment_data["amount"] > invoice.total_amount:
            raise PaymentRecordingError("Payment amount cannot exceed the invoice total.")
        if payment_data["payment_date"] > timezone.localdate():
            raise PaymentRecordingError("Payment date cannot be in the future.")

        try:
            payment = Payment.objects.create(
                invoice=invoice,
                amount=payment_data["amount"],
                payment_date=payment_data["payment_date"],
                payment_method=payment_data["payment_method"],
                reference_number=payment_data.get("reference_number", "").strip(),
                notes=payment_data.get("notes", "").strip(),
                created_by=actor if getattr(actor, "is_authenticated", False) else None,
            )
        except IntegrityError as error:
            raise PaymentRecordingError("A payment has already been recorded for this invoice.") from error

        invoice.status = "PAID"
        invoice.save(update_fields=["status"])
        return invoice, payment

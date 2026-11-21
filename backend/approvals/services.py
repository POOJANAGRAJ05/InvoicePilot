from django.db import transaction
from django.utils import timezone

from invoices.models import Invoice
from invoices.validation import validate_invoice

from .models import ApprovalHistory


class WorkflowTransitionError(Exception):
    """Raised when an invoice cannot perform the requested workflow action."""


def _require_valid_invoice(invoice):
    validation_errors = validate_invoice(invoice)
    if invoice.validation_status != "VALID" or invoice.is_duplicate:
        reasons = validation_errors or ["Invoice must be valid and not a duplicate."]
        raise WorkflowTransitionError(
            "Invoice cannot enter the approval workflow: " + " ".join(reasons)
        )


def transition_invoice(invoice_id, action, *, actor=None, reason=""):
    """Apply one allowed invoice workflow transition and persist its audit event."""
    transitions = {
        "submitted": {"UPLOADED": "PENDING"},
        "approved": {"PENDING": "APPROVED"},
        "rejected": {"PENDING": "REJECTED"},
        "resubmitted": {"REJECTED": "PENDING"},
    }
    if action not in transitions:
        raise WorkflowTransitionError("Unknown approval workflow action.")

    reason = (reason or "").strip()
    if action == "rejected" and not reason:
        raise WorkflowTransitionError("A rejection reason is required.")

    with transaction.atomic():
        try:
            invoice = Invoice.objects.select_for_update().get(pk=invoice_id)
        except Invoice.DoesNotExist as error:
            raise WorkflowTransitionError("Invoice was not found.") from error

        expected_statuses = transitions[action]
        if invoice.status not in expected_statuses:
            if action in {"submitted", "resubmitted"} and (
                invoice.validation_status != "VALID" or invoice.is_duplicate
            ):
                errors = validate_invoice(invoice)
                reasons = errors or ["Invoice must be valid and not a duplicate."]
                raise WorkflowTransitionError(
                    "Invoice cannot enter the approval workflow: "
                    + " ".join(reasons)
                )
            expected = ", ".join(expected_statuses)
            raise WorkflowTransitionError(
                f"Cannot {action} an invoice with status {invoice.status}. "
                f"Expected status: {expected}."
            )

        if action in {"submitted", "resubmitted"}:
            _require_valid_invoice(invoice)

        previous_status = invoice.status
        invoice.status = expected_statuses[previous_status]
        update_fields = ["status"]
        if action == "rejected":
            invoice.rejection_reason = reason
            invoice.rejected_at = timezone.now()
            update_fields.extend(["rejection_reason", "rejected_at"])
        elif action == "resubmitted":
            invoice.rejection_reason = ""
            invoice.rejected_at = None
            update_fields.extend(["rejection_reason", "rejected_at"])
        invoice.save(update_fields=update_fields)

        ApprovalHistory.objects.create(
            invoice=invoice,
            previous_status=previous_status,
            new_status=invoice.status,
            action=action,
            performed_by=actor if getattr(actor, "is_authenticated", False) else None,
            rejection_reason=reason if action == "rejected" else "",
        )
        return invoice


import hashlib
import json
import logging
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone

from invoices.models import Invoice
from invoices.validation import validate_invoice
from vendors.models import Vendor
from .models import (
    AutomationActivity,
    AutomationConfig,
    AutomationNotification,
    AutomationRule,
    AutomationRun,
)

logger = logging.getLogger(__name__)

OUTCOMES = {choice[0] for choice in AutomationRule.OUTCOME_CHOICES}
EXCLUDED_REMINDER_STATUSES = {"PAID", "REJECTED"}


def _vendor_context(invoice):
    if invoice.vendor_id:
        return invoice.vendor.status, invoice.vendor_id, "Invoice is linked to a registered vendor."

    name = Vendor.normalize_name(invoice.vendor_name)

    if not name or name in {"unknown vendor", "unknown", "(intentionally missing)"}:
        return "MISSING", None, "Vendor name is missing."

    candidates = [
        vendor
        for vendor in Vendor.objects.all()
        if Vendor.normalize_name(vendor.name) == name
    ]

    if len(candidates) == 1:
        vendor = candidates[0]
        return (
            vendor.status,
            vendor.pk,
            "A single vendor name candidate exists, but the invoice remains unlinked until a user confirms it.",
        )

    if len(candidates) > 1:
        return (
            "AMBIGUOUS",
            None,
            "Multiple registered vendors share this normalized name; manual linking is required.",
        )

    return "UNREGISTERED", None, "No registered vendor matches the OCR vendor name."


def _rule_matches(rule, invoice, vendor_status):
    conditions = rule.conditions or {}
    amount = invoice.total_amount

    if "amount_min" in conditions and (
        amount is None or amount < Decimal(str(conditions["amount_min"]))
    ):
        return False

    if "amount_max" in conditions and (
        amount is None or amount > Decimal(str(conditions["amount_max"]))
    ):
        return False

    if "amount_greater_than" in conditions and (
        amount is None or amount <= Decimal(str(conditions["amount_greater_than"]))
    ):
        return False

    if "amount_less_than_or_equal" in conditions and (
        amount is None or amount > Decimal(str(conditions["amount_less_than_or_equal"]))
    ):
        return False

    if "validation_status" in conditions and (
        invoice.validation_status != conditions["validation_status"]
    ):
        return False

    if "is_duplicate" in conditions and (
        invoice.is_duplicate is not conditions["is_duplicate"]
    ):
        return False

    if "vendor_status" in conditions and (
        vendor_status not in conditions["vendor_status"]
    ):
        return False

    if "invoice_status" in conditions and (
        invoice.status not in conditions["invoice_status"]
    ):
        return False

    if "vendor_id" in conditions and (
        invoice.vendor_id != conditions["vendor_id"]
    ):
        return False

    return True


def _explanation_for_rule(rule, invoice, vendor_status, vendor_explanation):
    name = rule.name
    conditions = rule.conditions or {}

    if conditions.get("is_duplicate") is True:
        return f"{name}: duplicate invoice blocked from approval routing."

    if conditions.get("validation_status") == "EXCEPTION":
        reasons = "; ".join(invoice.validation_errors or [])
        return f"{name}: validation exceptions require correction. {reasons}".strip()

    if vendor_status == "INACTIVE":
        return f"{name}: {vendor_explanation}"

    if vendor_status in {"UNREGISTERED", "AMBIGUOUS", "MISSING"}:
        return f"{name}: {vendor_explanation}"

    if "amount_greater_than" in conditions:
        return (
            f"{name}: invoice amount {invoice.total_amount} exceeds "
            f"{conditions['amount_greater_than']}; manual review required."
        )

    return f"{name}: conditions matched; invoice is eligible for the next manual workflow step."


def _fingerprint(invoice, rule, vendor_status):
    data = {
        "id": invoice.pk,
        "invoice_number": invoice.invoice_number,
        "vendor_name": invoice.vendor_name,
        "vendor_id": invoice.vendor_id,
        "vendor_status": vendor_status,
        "invoice_date": invoice.invoice_date,
        "due_date": invoice.due_date,
        "subtotal": invoice.subtotal_amount,
        "tax": invoice.tax_amount,
        "total": invoice.total_amount,
        "status": invoice.status,
        "validation_status": invoice.validation_status,
        "validation_errors": invoice.validation_errors,
        "duplicate": invoice.is_duplicate,
        "rule_id": rule.pk if rule else None,
        "rule_updated": rule.updated_at.isoformat() if rule else None,
    }

    encoded = json.dumps(data, sort_keys=True, default=str).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _create_notification(invoice, notification_type, title, message, period_key):
    AutomationNotification.objects.get_or_create(
        invoice=invoice,
        notification_type=notification_type,
        period_key=period_key,
        defaults={
            "title": title,
            "message": message,
        },
    )


def process_invoice(invoice_id, *, trigger="UPLOAD", run=None):
    """Validate and evaluate configured rules without changing approval/payment state."""

    with transaction.atomic():
        # FIX: Lock only the Invoice row.
        # Avoid PostgreSQL FOR UPDATE errors on nullable joined relationships.
        invoice = (
            Invoice.objects
            .select_for_update(of=("self",))
            .select_related("vendor")
            .get(pk=invoice_id)
        )

        validate_invoice(invoice)
        invoice.refresh_from_db()

        vendor_status, _candidate_vendor_id, vendor_explanation = _vendor_context(invoice)

        rules = AutomationRule.objects.filter(is_active=True).order_by("-priority", "id")

        matched_rule = next(
            (rule for rule in rules if _rule_matches(rule, invoice, vendor_status)),
            None,
        )

        if matched_rule:
            outcome = matched_rule.outcome
            explanation = _explanation_for_rule(
                matched_rule,
                invoice,
                vendor_status,
                vendor_explanation,
            )
        else:
            outcome = "READY_FOR_REVIEW"
            explanation = (
                "No active rule matched. Invoice remains in its existing workflow "
                "status for manual review."
            )

        fingerprint = _fingerprint(invoice, matched_rule, vendor_status)
        activity_key = f"invoice:{invoice.pk}:state:{fingerprint}"

        activity, created = AutomationActivity.objects.get_or_create(
            idempotency_key=activity_key,
            defaults={
                "invoice": invoice,
                "rule": matched_rule,
                "run": run,
                "trigger": trigger,
                "action": outcome,
                "result": outcome,
                "explanation": explanation,
                "success": True,
            },
        )

        if created:
            if outcome == "DUPLICATE_BLOCKED":
                _create_notification(
                    invoice,
                    "DUPLICATE",
                    "Duplicate invoice detected",
                    explanation,
                    fingerprint[:24],
                )

            elif outcome == "EXCEPTION":
                _create_notification(
                    invoice,
                    "EXCEPTION",
                    "Invoice requires attention",
                    explanation,
                    fingerprint[:24],
                )

            elif outcome == "VENDOR_REVIEW_REQUIRED":
                _create_notification(
                    invoice,
                    "VENDOR_ISSUE",
                    "Vendor review required",
                    explanation,
                    fingerprint[:24],
                )

            elif outcome == "ROUTED_FOR_APPROVAL":
                _create_notification(
                    invoice,
                    "APPROVAL_REQUIRED",
                    "Invoice ready for approval",
                    explanation,
                    fingerprint[:24],
                )

            elif outcome == "READY_FOR_REVIEW":
                _create_notification(
                    invoice,
                    "AUTOMATION",
                    "Invoice processing completed",
                    explanation,
                    fingerprint[:24],
                )

        return activity, created


def process_invoice_safely(invoice_id, *, trigger="UPLOAD"):
    """Keep the invoice upload successful while persisting automation failures."""

    try:
        return process_invoice(invoice_id, trigger=trigger)

    except Exception as error:
        logger.exception("Automation processing failed for invoice %s", invoice_id)

        failure_key = hashlib.sha256(
            f"invoice:{invoice_id}:automation-failure:{type(error).__name__}:{error}".encode("utf-8")
        ).hexdigest()

        try:
            AutomationActivity.objects.get_or_create(
                idempotency_key=f"failure:{failure_key}",
                defaults={
                    "invoice_id": invoice_id,
                    "trigger": trigger,
                    "action": "PROCESSING_FAILED",
                    "result": "FAILURE",
                    "explanation": str(error)[:2000],
                    "success": False,
                },
            )

        except Exception:
            logger.exception(
                "Could not persist automation failure for invoice %s",
                invoice_id,
            )

        return None


def _reminder_category(invoice, today):
    if invoice.due_date is None:
        return "DUE_DATE_MISSING", "missing", "Invoice has no due date."

    days = (invoice.due_date - today).days

    if days < 0:
        overdue = -days

        if overdue <= 30:
            return "OVERDUE", "overdue_1_30", f"Invoice is {overdue} day(s) overdue."

        if overdue <= 60:
            return "OVERDUE", "overdue_31_60", f"Invoice is {overdue} day(s) overdue."

        if overdue <= 90:
            return "OVERDUE", "overdue_61_90", f"Invoice is {overdue} day(s) overdue."

        return "OVERDUE", "overdue_over_90", f"Invoice is {overdue} day(s) overdue."

    if days == 0:
        return "UPCOMING_DUE", "due_today", "Invoice is due today."

    if days <= 3:
        return "UPCOMING_DUE", "due_within_3_days", f"Invoice is due in {days} day(s)."

    if days <= 7:
        return "UPCOMING_DUE", "due_within_7_days", f"Invoice is due in {days} day(s)."

    return None


def generate_due_reminders(run=None):
    today = timezone.localdate()

    invoices = (
        Invoice.objects
        .exclude(status__in=EXCLUDED_REMINDER_STATUSES)
        .filter(is_duplicate=False)
        .select_related("vendor", "payment")
    )

    made = 0

    for invoice in invoices:
        if invoice.status == "PAID":
            continue

        category = _reminder_category(invoice, today)

        if not category:
            continue

        notification_type, category_key, message = category

        if category_key == "missing":
            period_key = f"missing:{today:%Y-%m}"

        elif category_key.startswith("due_"):
            period_key = f"{category_key}:{invoice.due_date.isoformat()}"

        else:
            period_key = f"{category_key}:{today:%Y-%m}"

        title = (
            "Invoice due date reminder"
            if notification_type == "UPCOMING_DUE"
            else "Invoice due date missing"
            if notification_type == "DUE_DATE_MISSING"
            else "Invoice overdue"
        )

        with transaction.atomic():
            _notification, created = AutomationNotification.objects.get_or_create(
                invoice=invoice,
                notification_type=notification_type,
                period_key=period_key,
                defaults={
                    "title": title,
                    "message": message,
                },
            )

            if created:
                made += 1

                digest = hashlib.sha256(
                    f"due:{invoice.pk}:{period_key}".encode()
                ).hexdigest()

                AutomationActivity.objects.get_or_create(
                    idempotency_key=f"reminder:{digest}",
                    defaults={
                        "invoice": invoice,
                        "run": run,
                        "trigger": run.trigger if run else "SCHEDULED",
                        "action": "DUE_DATE_REMINDER",
                        "result": period_key.upper(),
                        "explanation": message,
                        "success": True,
                    },
                )

    return made


def run_automation(*, trigger="MANUAL", include_due_reminders=True):
    config = AutomationConfig.current()
    run = AutomationRun.objects.create(trigger=trigger)

    if trigger == "SCHEDULED" and not config.enabled:
        run.finished_at = timezone.now()
        run.explanation = "Automation is disabled; scheduled run skipped."
        run.save(update_fields=["finished_at", "explanation"])

        config.last_run_at = run.finished_at
        config.save(update_fields=["last_run_at", "updated_at"])

        return run

    processed = 0
    reminders = 0
    failures = 0

    for invoice_id in Invoice.objects.order_by("id").values_list("id", flat=True).iterator():
        try:
            _activity, created = process_invoice(
                invoice_id,
                trigger=trigger,
                run=run,
            )
            processed += int(created)

        except Exception as error:
            failures += 1

            key = f"run:{run.pk}:invoice:{invoice_id}:failure"

            AutomationActivity.objects.get_or_create(
                idempotency_key=key,
                defaults={
                    "invoice_id": invoice_id,
                    "run": run,
                    "trigger": trigger,
                    "action": "PROCESSING_FAILED",
                    "result": "FAILURE",
                    "explanation": str(error)[:2000],
                    "success": False,
                },
            )

    if include_due_reminders:
        try:
            reminders = generate_due_reminders(run=run)

        except Exception as error:
            failures += 1

            AutomationActivity.objects.get_or_create(
                idempotency_key=f"run:{run.pk}:due-reminders:failure",
                defaults={
                    "run": run,
                    "trigger": trigger,
                    "action": "DUE_REMINDERS_FAILED",
                    "result": "FAILURE",
                    "explanation": str(error)[:2000],
                    "success": False,
                },
            )

    run.finished_at = timezone.now()
    run.processed_count = processed
    run.reminder_count = reminders
    run.failure_count = failures
    run.success = failures == 0

    run.explanation = (
        f"{processed} new invoice evaluation(s), "
        f"{reminders} new reminder(s), "
        f"{failures} failure(s)."
    )

    run.save(
        update_fields=[
            "finished_at",
            "processed_count",
            "reminder_count",
            "failure_count",
            "success",
            "explanation",
        ]
    )

    config = AutomationConfig.current()
    config.last_run_at = run.finished_at
    config.save(update_fields=["last_run_at", "updated_at"])

    return run

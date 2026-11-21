from collections import defaultdict
from datetime import date
from decimal import Decimal

from django.db.models import Count, Q, Sum
from django.db.models.functions import TruncMonth
from django.utils import timezone

from invoices.models import Invoice
from payments.models import Payment

ZERO = Decimal("0.00")
MISSING_VENDOR_LABELS = {"unknown vendor", "unknown", "n/a", "na", "not available", "(intentionally missing)"}


def _decimal(value):
    return value if value is not None else ZERO


def _vendor_display_name(value):
    normalized = " ".join((value or "").split())
    if not normalized or normalized.casefold() in MISSING_VENDOR_LABELS:
        return "Unknown vendor"
    return normalized


def _get_filtered_invoices(params):
    queryset = Invoice.objects.all().select_related("payment")
    start_date = params.get("start_date")
    end_date = params.get("end_date")
    vendor = params.get("vendor")
    status = params.get("status")
    if start_date:
        queryset = queryset.filter(invoice_date__gte=start_date)
    if end_date:
        queryset = queryset.filter(invoice_date__lte=end_date)
    if vendor:
        if vendor.strip().casefold() == "unknown vendor":
            queryset = queryset.filter(
                Q(vendor_name__isnull=True)
                | Q(vendor_name__regex=r"^\s*$")
                | Q(vendor_name__iexact="unknown vendor")
                | Q(vendor_name__iexact="unknown")
                | Q(vendor_name__iexact="n/a")
                | Q(vendor_name__iexact="na")
                | Q(vendor_name__iexact="not available")
                | Q(vendor_name__iexact="(intentionally missing)")
            )
        else:
            queryset = queryset.filter(vendor_name__icontains=vendor)
    if status:
        if status.upper() == "UNKNOWN":
            queryset = queryset.exclude(status__in=(
                "UPLOADED", "PROCESSING", "PENDING", "APPROVED", "REJECTED", "PAID", "EXCEPTION"
            ))
        else:
            queryset = queryset.filter(status=status.upper())
    return queryset


def build_report(params):
    invoices = _get_filtered_invoices(params)
    invoice_ids = invoices.values_list("pk", flat=True)
    payments = Payment.objects.filter(invoice_id__in=invoice_ids)

    gross_amount = _decimal(invoices.aggregate(value=Sum("total_amount"))["value"])
    unique_amount = _decimal(
        invoices.filter(is_duplicate=False).aggregate(value=Sum("total_amount"))["value"]
    )
    total_paid = _decimal(payments.aggregate(value=Sum("amount"))["value"])
    approved_unpaid = invoices.filter(
        status="APPROVED", validation_status="VALID", is_duplicate=False,
        payment__isnull=True,
    )
    outstanding_amount = _decimal(
        approved_unpaid.aggregate(value=Sum("total_amount"))["value"]
    )
    counts = {
        "total_invoices": invoices.count(),
        "total_invoiced_amount": gross_amount,
        "gross_invoice_amount": gross_amount,
        "unique_invoice_amount": unique_amount,
        "total_paid_amount": total_paid,
        "total_outstanding_approved_amount": outstanding_amount,
        "pending_approvals_count": invoices.filter(status="PENDING").count(),
        "rejected_invoices_count": invoices.filter(status="REJECTED").count(),
        "exception_invoices_count": invoices.filter(status="EXCEPTION").count(),
        "paid_invoices_count": invoices.filter(status="PAID").count(),
    }

    grouping = params.get("grouping", "monthly").lower()
    if grouping not in {"monthly", "quarterly", "yearly"}:
        grouping = "monthly"
    truncation = {"monthly": TruncMonth, "quarterly": "quarter", "yearly": "year"}[grouping]
    if truncation == "quarter":
        from django.db.models.functions import TruncQuarter
        truncation = TruncQuarter

    invoice_periods = invoices.annotate(
        period=truncation("invoice_date")
    ).values("period").annotate(
        invoice_count=Count("pk"),
        gross_invoiced_amount=Sum("total_amount"),
        unique_invoiced_amount=Sum("total_amount", filter=Q(is_duplicate=False)),
        outstanding_amount=Sum(
            "total_amount",
            filter=Q(
                status="APPROVED", validation_status="VALID", is_duplicate=False,
                payment__isnull=True,
            ),
        ),
    ).order_by("period")
    # Report date filters select the invoice cohort by invoice_date. Group recorded
    # payments by that same cohort period so every series uses the same filter scope.
    payment_periods = payments.annotate(
        period=truncation("invoice__invoice_date")
    ).values("period").annotate(
        paid_amount=Sum("amount")
    )
    payment_by_period = {
        row["period"]
        for row in payment_periods
    }
    paid_totals = {
        row["period"]: _decimal(row["paid_amount"])
        for row in payment_periods
    }
    trends = []
    periods = {row["period"] for row in invoice_periods} | payment_by_period
    invoice_by_period = {row["period"]: row for row in invoice_periods}
    for period in sorted(periods, key=lambda value: (value is not None, value or date.min)):
        row = invoice_by_period.get(period, {})
        trends.append({
            "period": period.isoformat()[:10] if period else "undated",
            "invoice_count": row.get("invoice_count", 0),
            "gross_invoiced_amount": _decimal(row.get("gross_invoiced_amount")),
            "unique_invoiced_amount": _decimal(row.get("unique_invoiced_amount")),
            "invoiced_amount": _decimal(row.get("gross_invoiced_amount")),
            "paid_amount": paid_totals.get(period, ZERO),
            "outstanding_amount": _decimal(row.get("outstanding_amount")),
        })

    vendor_totals = defaultdict(lambda: {
        "invoice_count": 0,
        "unique_invoice_count": 0,
        "gross_invoiced_amount": ZERO,
        "unique_invoiced_amount": ZERO,
        "paid_amount": ZERO,
        "outstanding_amount": ZERO,
    })
    for invoice in invoices:
        vendor_name = _vendor_display_name(invoice.vendor_name)
        vendor_key = vendor_name.casefold()
        totals = vendor_totals[vendor_key]
        totals["vendor_name"] = vendor_name
        totals["invoice_count"] += 1
        amount = _decimal(invoice.total_amount)
        totals["gross_invoiced_amount"] += amount
        if not invoice.is_duplicate:
            totals["unique_invoice_count"] += 1
            totals["unique_invoiced_amount"] += amount
        try:
            payment = invoice.payment
        except Payment.DoesNotExist:
            payment = None
        if payment:
            totals["paid_amount"] += payment.amount
        if (
            invoice.status == "APPROVED"
            and invoice.validation_status == "VALID"
            and not invoice.is_duplicate
            and payment is None
        ):
            totals["outstanding_amount"] += amount
    vendors = sorted(vendor_totals.values(), key=lambda row: row["vendor_name"].casefold())
    for vendor_row in vendors:
        vendor_row["invoiced_amount"] = vendor_row["gross_invoiced_amount"]

    status_rows = invoices.values("status").annotate(
        invoice_count=Count("pk"),
        gross_amount=Sum("total_amount"),
        unique_amount=Sum("total_amount", filter=Q(is_duplicate=False)),
    )
    known_statuses = {"UPLOADED", "PROCESSING", "PENDING", "APPROVED", "REJECTED", "PAID", "EXCEPTION"}
    statuses = {}
    for row in status_rows:
        status_name = row["status"] if row["status"] in known_statuses else "UNKNOWN"
        totals = statuses.setdefault(status_name, {
            "invoice_count": 0,
            "gross_amount": ZERO,
            "unique_amount": ZERO,
            "total_amount": ZERO,
        })
        totals["invoice_count"] += row["invoice_count"]
        totals["gross_amount"] += _decimal(row["gross_amount"])
        totals["unique_amount"] += _decimal(row["unique_amount"])
        totals["total_amount"] += _decimal(row["gross_amount"])
    for status_name in known_statuses:
        statuses.setdefault(status_name, {"invoice_count": 0, "gross_amount": ZERO, "unique_amount": ZERO, "total_amount": ZERO})
    statuses.setdefault("UNKNOWN", {"invoice_count": 0, "gross_amount": ZERO, "unique_amount": ZERO, "total_amount": ZERO})

    today = timezone.localdate()
    aging_totals = defaultdict(lambda: ZERO)
    aging_invoices = []
    aging_brackets = (
        ("current", "Current / not yet due"),
        ("1_30", "1–30 days overdue"),
        ("31_60", "31–60 days overdue"),
        ("61_90", "61–90 days overdue"),
        ("over_90", "More than 90 days overdue"),
        ("missing_due_date", "Due date unavailable"),
    )
    outstanding_invoices = invoices.filter(
        status="APPROVED", validation_status="VALID", is_duplicate=False,
        payment__isnull=True,
    )
    for invoice in outstanding_invoices:
        if invoice.due_date is None:
            bracket = "missing_due_date"
            days_overdue = None
        elif invoice.due_date >= today:
            bracket = "current"
            days_overdue = 0
        else:
            days_overdue = (today - invoice.due_date).days
            bracket = (
                "1_30" if days_overdue <= 30 else
                "31_60" if days_overdue <= 60 else
                "61_90" if days_overdue <= 90 else "over_90"
            )
        balance = _decimal(invoice.total_amount)
        aging_totals[bracket] += balance
        aging_invoices.append({
            "invoice_id": invoice.pk,
            "invoice_number": invoice.invoice_number or "",
            "vendor_name": _vendor_display_name(invoice.vendor_name),
            "invoice_date": invoice.invoice_date,
            "due_date": invoice.due_date,
            "outstanding_amount": balance,
            "days_overdue": days_overdue,
            "aging_bracket": bracket,
        })

    aging = [
        {"key": key, "label": label, "amount": aging_totals[key],
         "invoice_count": sum(item["aging_bracket"] == key for item in aging_invoices)}
        for key, label in aging_brackets
    ]

    return {
        "filters": {
            "start_date": params.get("start_date", ""),
            "end_date": params.get("end_date", ""),
            "vendor": params.get("vendor", ""),
            "status": params.get("status", ""),
            "grouping": grouping,
        },
        "summary": counts,
        "monthly_trends": trends,
        "vendor_summary": vendors,
        "status_breakdown": statuses,
        "aging_summary": aging,
        "aging_invoices": aging_invoices,
        "invoice_register": invoices.order_by("-created_at"),
    }

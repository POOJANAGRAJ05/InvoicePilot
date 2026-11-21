import csv

from django.http import HttpResponse
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from decimal import Decimal

from payments.models import Payment
from .services import _vendor_display_name, build_report


class ReportFilterSerializer(serializers.Serializer):
	start_date = serializers.DateField(required=False)
	end_date = serializers.DateField(required=False)
	vendor = serializers.CharField(required=False, allow_blank=True, max_length=255)
	status = serializers.ChoiceField(
		required=False,
		choices=("UPLOADED", "PROCESSING", "PENDING", "APPROVED", "REJECTED", "PAID", "EXCEPTION", "UNKNOWN"),
	)
	grouping = serializers.ChoiceField(
		required=False,
		choices=("monthly", "quarterly", "yearly"),
		default="monthly",
	)

	def validate(self, attrs):
		start = attrs.get("start_date")
		end = attrs.get("end_date")
		if start and end and start > end:
			raise serializers.ValidationError({"end_date": "End date must be on or after start date."})
		return attrs


def _validated_filters(query_params):
	serializer = ReportFilterSerializer(data=query_params)
	serializer.is_valid(raise_exception=True)
	return serializer.validated_data


def _report_response_data(report):
	register = []
	for invoice in report["invoice_register"]:
		try:
			payment = invoice.payment
		except Payment.DoesNotExist:
			payment = None
		register.append({
			"id": invoice.pk,
			"invoice_number": invoice.invoice_number or "",
			"vendor_name": _vendor_display_name(invoice.vendor_name),
			"invoice_date": invoice.invoice_date,
			"due_date": invoice.due_date,
			"subtotal_amount": invoice.subtotal_amount,
			"tax_amount": invoice.tax_amount,
			"total_amount": invoice.total_amount,
			"gross_invoice_amount": invoice.total_amount,
			"unique_invoice_amount": invoice.total_amount if not invoice.is_duplicate else Decimal("0.00"),
			"status": invoice.status,
			"validation_status": invoice.validation_status,
			"is_duplicate": invoice.is_duplicate,
			"created_at": invoice.created_at,
			"payment_amount": payment.amount if payment else None,
			"payment_date": payment.payment_date if payment else None,
			"payment_method": payment.get_payment_method_display() if payment else "",
			"payment_reference": payment.reference_number if payment else "",
		})
	return {**report, "invoice_register": register}


class ReportsAPIView(APIView):
	permission_classes = [AllowAny]

	def get(self, request):
		filters = _validated_filters(request.query_params)
		return Response(_report_response_data(build_report(filters)))


class ReportExportAPIView(APIView):
	permission_classes = [AllowAny]

	EXPORTS = {
		"invoices": (
			"invoice_register",
			[
				("Invoice ID", "id"), ("Invoice Number", "invoice_number"),
				("Vendor", "vendor_name"), ("Invoice Date", "invoice_date"),
				("Due Date", "due_date"), ("Subtotal", "subtotal_amount"),
				("Tax", "tax_amount"), ("Invoice Total", "total_amount"),
				("Gross Invoice Amount", "gross_invoice_amount"),
				("Unique Invoice Amount", "unique_invoice_amount"),
				("Status", "status"), ("Validation", "validation_status"),
				("Duplicate", "is_duplicate"), ("Payment Amount", "payment_amount"),
				("Payment Date", "payment_date"), ("Payment Method", "payment_method"),
				("Payment Reference", "payment_reference"), ("Uploaded At", "created_at"),
			],
		),
		"vendors": (
			"vendor_summary",
			[
				("Vendor", "vendor_name"), ("Invoice Count", "invoice_count"),
				("Unique Invoice Count", "unique_invoice_count"),
				("Total Invoiced", "invoiced_amount"),
				("Gross Invoiced", "gross_invoiced_amount"),
				("Unique Invoiced", "unique_invoiced_amount"), ("Total Paid", "paid_amount"),
				("Outstanding Approved", "outstanding_amount"),
			],
		),
		"aging": (
			"aging_invoices",
			[
				("Invoice ID", "invoice_id"), ("Invoice Number", "invoice_number"),
				("Vendor", "vendor_name"), ("Invoice Date", "invoice_date"),
				("Due Date", "due_date"), ("Days Overdue", "days_overdue"),
				("Aging Category", "aging_bracket"), ("Outstanding Amount", "outstanding_amount"),
			],
		),
		"monthly": (
			"monthly_trends",
			[
				("Period", "period"), ("Invoice Count", "invoice_count"),
				("Total Invoiced", "invoiced_amount"),
				("Gross Invoiced", "gross_invoiced_amount"),
				("Unique Invoiced", "unique_invoiced_amount"),
				("Total Payments", "paid_amount"),
				("Approved Outstanding", "outstanding_amount"),
			],
		),
	}

	def get(self, request, report_type):
		if report_type not in self.EXPORTS:
			raise ValidationError({"report_type": "Choose invoices, vendors, aging, or monthly."})
		report = build_report(_validated_filters(request.query_params))
		report_key, columns = self.EXPORTS[report_type]
		rows = report[report_key]
		if report_type == "invoices":
			rows = _report_response_data(report)["invoice_register"]

		response = HttpResponse(content_type="text/csv; charset=utf-8")
		response["Content-Disposition"] = f'attachment; filename="invoicepilot-{report_type}.csv"'
		response.write("\ufeff")
		writer = csv.writer(response)
		writer.writerow([header for header, _field in columns])
		for row in rows:
			writer.writerow([row[field] for _header, field in columns])
		return response

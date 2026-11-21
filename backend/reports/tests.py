import tempfile
from datetime import timedelta
from decimal import Decimal

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from invoices.models import Invoice
from invoices.validation import validate_invoice
from payments.models import Payment

DEFAULT_INVOICE_DATE = object()


class ReportsAPITests(TestCase):
	def setUp(self):
		super().setUp()
		self.media_directory = tempfile.TemporaryDirectory()
		media_settings = override_settings(MEDIA_ROOT=self.media_directory.name)
		media_settings.enable()
		self.addCleanup(media_settings.disable)
		self.addCleanup(self.media_directory.cleanup)
		self.client = APIClient()

	def make_invoice(self, *, number, vendor, status="APPROVED", due_date=None, amount="118.00", tax="18.00", invoice_date=DEFAULT_INVOICE_DATE):
		invoice = Invoice.objects.create(
			invoice_number=number,
			vendor_name=vendor,
			invoice_date=timezone.localdate().replace(day=1) if invoice_date is DEFAULT_INVOICE_DATE else invoice_date,
			due_date=due_date or timezone.localdate() + timedelta(days=14),
			subtotal_amount=Decimal(amount) - Decimal(tax),
			tax_amount=Decimal(tax),
			total_amount=Decimal(amount),
			invoice_file=SimpleUploadedFile(f"{number}.pdf", b"test invoice"),
			status=status,
		)
		validate_invoice(invoice)
		invoice.status = status
		invoice.save(update_fields=["status"])
		return invoice

	def test_summary_vendor_monthly_status_and_aging_use_database_data(self):
		paid = self.make_invoice(number="INV-RPT-PAID", vendor="Report Vendor", status="APPROVED")
		Payment.objects.create(
			invoice=paid,
			amount=Decimal("118.00"),
			payment_date=timezone.localdate(),
			payment_method="UPI",
		)
		paid.status = "PAID"
		paid.save(update_fields=["status"])

		overdue = self.make_invoice(
			number="INV-RPT-OVERDUE",
			vendor="Report Vendor",
			invoice_date=timezone.localdate() - timedelta(days=120),
			due_date=timezone.localdate() - timedelta(days=45),
			amount="218.00",
		)
		self.assertEqual(overdue.status, "APPROVED")
		self.assertEqual(overdue.validation_status, "VALID")
		duplicate = self.make_invoice(
			number="INV-RPT-OVERDUE",
			vendor="Report Vendor",
			invoice_date=timezone.localdate() - timedelta(days=120),
			due_date=timezone.localdate() - timedelta(days=45),
			amount="218.00",
		)
		self.assertTrue(duplicate.is_duplicate)
		self.make_invoice(number="INV-RPT-PENDING", vendor=None, status="PENDING", invoice_date=None)
		self.make_invoice(
			number="INV-RPT-INCOMPLETE",
			vendor="(intentionally missing)",
			status="EXCEPTION",
			amount="0.00",
			tax="0.00",
		)

		response = self.client.get("/api/reports/")

		self.assertEqual(response.status_code, 200)
		self.assertEqual(response.data["summary"]["total_invoices"], 5)
		self.assertEqual(response.data["summary"]["total_invoiced_amount"], Decimal("672.00"))
		self.assertEqual(response.data["summary"]["gross_invoice_amount"], Decimal("672.00"))
		self.assertEqual(response.data["summary"]["unique_invoice_amount"], Decimal("454.00"))
		self.assertEqual(response.data["summary"]["total_paid_amount"], Decimal("118.00"))
		self.assertEqual(response.data["summary"]["paid_invoices_count"], 1)
		self.assertEqual(response.data["status_breakdown"]["PENDING"]["invoice_count"], 1)
		self.assertEqual(
			sum(row["gross_amount"] for row in response.data["status_breakdown"].values()),
			response.data["summary"]["gross_invoice_amount"],
		)
		self.assertEqual(
			sum(row["unique_amount"] for row in response.data["status_breakdown"].values()),
			response.data["summary"]["unique_invoice_amount"],
		)

		vendor = next(row for row in response.data["vendor_summary"] if row["vendor_name"] == "Report Vendor")
		self.assertEqual(vendor["invoice_count"], 3)
		self.assertEqual(vendor["gross_invoiced_amount"], Decimal("554.00"))
		self.assertEqual(vendor["unique_invoiced_amount"], Decimal("336.00"))
		self.assertEqual(vendor["paid_amount"], Decimal("118.00"))
		self.assertEqual(vendor["outstanding_amount"], Decimal("218.00"))

		aging_invoice_ids = {row["invoice_id"] for row in response.data["aging_invoices"]}
		self.assertEqual(aging_invoice_ids, {overdue.pk})
		aging_bucket = next(row for row in response.data["aging_summary"] if row["key"] == "31_60")
		self.assertEqual(aging_bucket["amount"], Decimal("218.00"))
		unknown_vendor = next(row for row in response.data["vendor_summary"] if row["vendor_name"] == "Unknown vendor")
		self.assertEqual(unknown_vendor["invoice_count"], 2)
		self.assertEqual(unknown_vendor["gross_invoiced_amount"], Decimal("118.00"))
		self.assertEqual(
			sum(row["gross_invoiced_amount"] for row in response.data["vendor_summary"]),
			response.data["summary"]["gross_invoice_amount"],
		)
		self.assertEqual(
			sum(row["unique_invoiced_amount"] for row in response.data["vendor_summary"]),
			response.data["summary"]["unique_invoice_amount"],
		)
		self.assertEqual(
			sum(row["gross_invoiced_amount"] for row in response.data["monthly_trends"]),
			response.data["summary"]["gross_invoice_amount"],
		)
		unknown_filter = self.client.get("/api/reports/", {"vendor": "Unknown vendor"})
		self.assertEqual(unknown_filter.data["summary"]["total_invoices"], 2)
		self.assertTrue(response.data["monthly_trends"])
		undated = next(row for row in response.data["monthly_trends"] if row["period"] == "undated")
		self.assertEqual(undated["invoice_count"], 1)
		self.assertEqual(undated["gross_invoiced_amount"], Decimal("118.00"))
		self.assertEqual(undated["unique_invoiced_amount"], Decimal("118.00"))

	def test_filters_and_grouping_are_applied_and_validated(self):
		self.make_invoice(number="INV-FILTER-A", vendor="Alpha", invoice_date=timezone.localdate().replace(day=2))
		self.make_invoice(number="INV-FILTER-B", vendor="Beta", status="PENDING", invoice_date=timezone.localdate().replace(day=3))

		response = self.client.get("/api/reports/", {
			"vendor": "Alpha",
			"status": "APPROVED",
			"start_date": timezone.localdate().replace(day=1).isoformat(),
			"end_date": timezone.localdate().replace(day=5).isoformat(),
			"grouping": "quarterly",
		})
		self.assertEqual(response.status_code, 200)
		self.assertEqual(response.data["summary"]["total_invoices"], 1)
		self.assertEqual(response.data["filters"]["grouping"], "quarterly")

		invalid_range = self.client.get("/api/reports/", {
			"start_date": "2026-12-01",
			"end_date": "2026-01-01",
		})
		self.assertEqual(invalid_range.status_code, 400)

	def test_csv_exports_include_meaningful_headers_and_filters(self):
		self.make_invoice(number="INV-CSV", vendor="CSV Vendor")
		for report_type, expected_header in (
			("invoices", "Invoice Number"),
			("vendors", "Gross Invoiced"),
			("aging", "Aging Category"),
			("monthly", "Total Payments"),
		):
			response = self.client.get(f"/api/reports/export/{report_type}.csv", {"vendor": "CSV"})
			self.assertEqual(response.status_code, 200)
			self.assertIn("text/csv", response["Content-Type"])
			self.assertIn(expected_header, response.content.decode("utf-8-sig"))

	def test_invalid_export_type_returns_client_error(self):
		response = self.client.get("/api/reports/export/unknown.csv")
		self.assertEqual(response.status_code, 400)

import tempfile
from decimal import Decimal

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from invoices.models import Invoice
from invoices.validation import validate_invoice
from .models import Payment


class PaymentRecordingTests(TestCase):
	def setUp(self):
		super().setUp()
		debug_settings = override_settings(DEBUG=True)
		debug_settings.enable()
		self.addCleanup(debug_settings.disable)
		self.media_directory = tempfile.TemporaryDirectory()
		media_settings = override_settings(MEDIA_ROOT=self.media_directory.name)
		media_settings.enable()
		self.addCleanup(media_settings.disable)
		self.addCleanup(self.media_directory.cleanup)
		self.client = APIClient()

	def make_invoice(self, **overrides):
		values = {
			"invoice_number": "INV-PAYMENT-1",
			"vendor_name": "Payment Vendor",
			"invoice_date": "2026-04-01",
			"due_date": "2026-04-30",
			"subtotal_amount": Decimal("100.00"),
			"tax_amount": Decimal("18.00"),
			"total_amount": Decimal("118.00"),
			"invoice_file": SimpleUploadedFile("payment.pdf", b"payment invoice"),
			"status": "APPROVED",
		}
		values.update(overrides)
		invoice = Invoice.objects.create(**values)
		validate_invoice(invoice)
		invoice.status = values["status"]
		invoice.save(update_fields=["status"])
		return invoice

	def payload(self, **overrides):
		data = {
			"amount": "118.00",
			"payment_date": "2026-11-19",
			"payment_method": "UPI",
			"reference_number": "UPI-REF-8091",
			"notes": "Paid from AP test account",
		}
		data.update(overrides)
		return data

	def record(self, invoice, data=None):
		return self.client.post(
			f"/api/invoices/{invoice.pk}/record-payment/",
			data or self.payload(),
			format="json",
		)

	def test_approved_invoice_payment_persists_and_marks_invoice_paid(self):
		invoice = self.make_invoice()

		response = self.record(invoice)

		self.assertEqual(response.status_code, 201)
		invoice.refresh_from_db()
		self.assertEqual(invoice.status, "PAID")
		self.assertEqual(Payment.objects.filter(invoice=invoice).count(), 1)
		self.assertEqual(response.data["payment_history"][0]["amount"], "118.00")
		self.assertEqual(response.data["payment_history"][0]["payment_method"], "UPI")
		self.assertEqual(response.data["payment_history"][0]["reference_number"], "UPI-REF-8091")

		repeat_response = self.record(invoice)
		self.assertEqual(repeat_response.status_code, 400)
		self.assertEqual(Payment.objects.filter(invoice=invoice).count(), 1)

	def test_payment_requires_approved_non_duplicate_invoice(self):
		for status in ("UPLOADED", "PENDING", "REJECTED", "EXCEPTION", "PAID"):
			invoice = self.make_invoice(
				invoice_number=f"INV-STATUS-{status}", status=status
			)
			response = self.record(invoice)
			self.assertEqual(response.status_code, 400, status)
			self.assertEqual(Payment.objects.filter(invoice=invoice).count(), 0)

		invoice = self.make_invoice(invoice_number="INV-DUPLICATE-PAYMENT")
		invoice.is_duplicate = True
		invoice.save(update_fields=["is_duplicate"])
		duplicate_response = self.record(invoice)
		self.assertEqual(duplicate_response.status_code, 400)
		self.assertEqual(Payment.objects.filter(invoice=invoice).count(), 0)

	def test_payment_amount_and_date_are_validated(self):
		invoice = self.make_invoice()
		for amount in ("0.00", "-1.00", "118.01"):
			response = self.record(invoice, self.payload(amount=amount))
			self.assertEqual(response.status_code, 400, amount)
			self.assertEqual(Payment.objects.filter(invoice=invoice).count(), 0)

		future_response = self.record(
			invoice,
			self.payload(payment_date="2099-01-01"),
		)
		self.assertEqual(future_response.status_code, 400)
		self.assertEqual(Payment.objects.filter(invoice=invoice).count(), 0)

		invalid_method_response = self.record(
			invoice,
			self.payload(payment_method="WIRE"),
		)
		self.assertEqual(invalid_method_response.status_code, 400)

	def test_payment_summary_uses_database_records(self):
		paid_invoice = self.make_invoice(invoice_number="INV-PAID-SUMMARY")
		self.record(paid_invoice, self.payload(amount="100.00"))
		self.make_invoice(
			invoice_number="INV-UNPAID-SUMMARY",
			subtotal_amount=Decimal("50.00"),
			tax_amount=Decimal("25.00"),
			total_amount=Decimal("75.00"),
		)
		self.make_invoice(invoice_number="INV-OTHER-SUMMARY", status="PENDING")

		response = self.client.get("/api/invoices/payment-summary/")

		self.assertEqual(response.status_code, 200)
		self.assertEqual(response.data["total_amount_paid"], Decimal("100.00"))
		self.assertEqual(response.data["paid_invoice_count"], 1)
		self.assertEqual(response.data["approved_unpaid_outstanding"], Decimal("75.00"))
		self.assertEqual(response.data["approved_unpaid_count"], 1)

	@override_settings(DEBUG=False)
	def test_payment_action_requires_authorized_user_outside_debug(self):
		invoice = self.make_invoice()
		response = self.record(invoice)
		self.assertEqual(response.status_code, 403)

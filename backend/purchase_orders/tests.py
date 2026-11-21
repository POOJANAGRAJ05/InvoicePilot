import tempfile
from datetime import date
from decimal import Decimal

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from invoices.models import Invoice
from vendors.models import Vendor
from .models import InvoicePurchaseOrderMatch, PurchaseOrder


class PurchaseOrderAndMatchingTests(TestCase):
	def setUp(self):
		super().setUp()
		self.media_directory = tempfile.TemporaryDirectory()
		media_settings = override_settings(MEDIA_ROOT=self.media_directory.name)
		media_settings.enable()
		self.addCleanup(media_settings.disable)
		self.addCleanup(self.media_directory.cleanup)
		self.client = APIClient()
		self.vendor = Vendor.objects.create(name="PO Vendor", vendor_code="PO-VENDOR")

	def create_po(self):
		return self.client.post("/api/purchase-orders/", {
			"vendor": self.vendor.pk,
			"po_number": "po-test-100",
			"po_date": "2026-01-15",
			"expected_delivery_date": "2026-02-15",
			"line_items": [
				{"description": "Widget A", "quantity": "2", "unit_price": "50.00", "tax_rate": "10.00"},
				{"description": "Widget B", "quantity": "1", "unit_price": "100.00", "tax_rate": "0.00"},
			],
		}, format="json")

	def test_po_calculates_totals_and_issued_order_is_not_editable(self):
		response = self.create_po()
		self.assertEqual(response.status_code, 201)
		self.assertEqual(response.data["po_number"], "PO-TEST-100")
		self.assertEqual(Decimal(response.data["subtotal_amount"]), Decimal("200.00"))
		self.assertEqual(Decimal(response.data["tax_amount"]), Decimal("10.00"))
		self.assertEqual(Decimal(response.data["total_amount"]), Decimal("210.00"))
		self.assertEqual(Decimal(response.data["line_items"][0]["total"]), Decimal("110.00"))

		po_id = response.data["id"]
		issued = self.client.post(f"/api/purchase-orders/{po_id}/issue/", {}, format="json")
		self.assertEqual(issued.data["status"], "ISSUED")
		edit = self.client.patch(f"/api/purchase-orders/{po_id}/", {"notes": "unsafe edit"}, format="json")
		self.assertEqual(edit.status_code, 400)
		partial = self.client.post(f"/api/purchase-orders/{po_id}/transition/", {"status": "PARTIALLY_RECEIVED"}, format="json")
		self.assertEqual(partial.data["status"], "PARTIALLY_RECEIVED")
		received = self.client.post(f"/api/purchase-orders/{po_id}/transition/", {"status": "RECEIVED"}, format="json")
		self.assertEqual(received.data["status"], "RECEIVED")
		closed = self.client.post(f"/api/purchase-orders/{po_id}/transition/", {"status": "CLOSED"}, format="json")
		self.assertEqual(closed.data["status"], "CLOSED")

	def test_invalid_line_amount_and_duplicate_po_number_are_rejected(self):
		invalid = self.client.post("/api/purchase-orders/", {
			"vendor": self.vendor.pk,
			"po_date": "2026-01-15",
			"line_items": [{"description": "Bad", "quantity": "0", "unit_price": "5", "tax_rate": "10"}],
		}, format="json")
		self.assertEqual(invalid.status_code, 400)

		self.assertEqual(self.create_po().status_code, 201)
		duplicate = self.create_po()
		self.assertEqual(duplicate.status_code, 400)

	def test_cancel_requires_reason_and_matching_persists_without_invoice_state_change(self):
		po_response = self.create_po()
		po_id = po_response.data["id"]
		missing_reason = self.client.post(f"/api/purchase-orders/{po_id}/cancel/", {}, format="json")
		self.assertEqual(missing_reason.status_code, 400)

		invoice = Invoice.objects.create(
			invoice_number="INV-PO-1",
			vendor_name=self.vendor.name,
			invoice_date=date(2026, 1, 15),
			due_date=date(2026, 2, 15),
			subtotal_amount=Decimal("200.00"),
			tax_amount=Decimal("10.00"),
			total_amount=Decimal("210.00"),
			invoice_file=SimpleUploadedFile("invoice.pdf", b"invoice"),
			status="UPLOADED",
		)
		# A reviewer can enter the invoice PO reference if OCR did not find one.
		match = self.client.post(f"/api/purchase-orders/{po_id}/match-invoice/", {"invoice_id": invoice.pk, "invoice_po_number": "PO-TEST-100"}, format="json")
		self.assertEqual(match.status_code, 201, match.data)
		self.assertEqual(match.data["result"], "PARTIAL_MATCH")
		self.assertTrue(any(item["check"] == "line_items" for item in match.data["explanations"]))
		invoice.refresh_from_db()
		self.assertEqual(invoice.status, "UPLOADED")
		self.assertEqual(invoice.purchase_order_number, "PO-TEST-100")
		self.assertEqual(invoice.vendor, None)
		self.assertEqual(InvoicePurchaseOrderMatch.objects.count(), 1)
		cancelled = self.client.post(f"/api/purchase-orders/{po_id}/cancel/", {"reason": "Supplier cancelled"}, format="json")
		self.assertEqual(cancelled.data["status"], "CANCELLED")
		self.assertEqual(cancelled.data["cancellation_reason"], "Supplier cancelled")

	def test_duplicate_vendor_name_with_linked_vendor_is_unambiguous_and_explicit(self):
		second_vendor = Vendor.objects.create(name="PO Vendor", vendor_code="PO-VENDOR-2", tax_registration_number="29ABCDE1234F1Z5")
		invoice = Invoice.objects.create(
			invoice_number="INV-LINK-1",
			vendor_name="PO Vendor",
			invoice_file=SimpleUploadedFile("invoice-link.pdf", b"invoice"),
		)
		candidates = self.client.get(f"/api/invoices/{invoice.pk}/vendor-link/")
		self.assertEqual(candidates.status_code, 200)
		self.assertEqual(len(candidates.data["candidates"]), 2)
		self.assertFalse(candidates.data["automatic_linking"])
		linked = self.client.post(f"/api/invoices/{invoice.pk}/vendor-link/", {"vendor_id": second_vendor.pk}, format="json")
		self.assertEqual(linked.status_code, 200)
		self.assertEqual(linked.data["vendor_details"]["id"], second_vendor.pk)

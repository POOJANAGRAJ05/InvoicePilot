import tempfile
from decimal import Decimal
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, TestCase, override_settings
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from approvals.models import ApprovalHistory
from .models import Invoice
from .ocr import extract_invoice_data
from .validation import validate_invoice


# Clearly test-only text matching the supplied fictional sample invoice PDF.
OCR_SAMPLE_TEXT = """SAMPLE INVOICE - TEST DATA ONLY
Northwind Office Supplies
42 Example Avenue, Bengaluru, Karnataka 560001
Invoice Number: NW-2026-1042
Invoice Date: 19 November 2026
Due Date: 03 December 2026
Subtotal
9,600.00
GST (18%) 1,728.00
Total Due 11,328.00
"""


class InvoiceDataExtractionTests(SimpleTestCase):
	def test_extracts_invoice_fields_from_ocr_text(self):
		extracted = extract_invoice_data(OCR_SAMPLE_TEXT)

		self.assertEqual(extracted["vendor_name"], "Northwind Office Supplies")
		self.assertEqual(extracted["invoice_number"], "NW-2026-1042")
		self.assertEqual(str(extracted["invoice_date"]), "2026-11-19")
		self.assertEqual(str(extracted["due_date"]), "2026-12-03")
		self.assertEqual(extracted["subtotal_amount"], Decimal("9600.00"))
		self.assertEqual(extracted["tax_amount"], Decimal("1728.00"))
		self.assertEqual(extracted["total_amount"], Decimal("11328.00"))

	def test_missing_fields_remain_empty(self):
		extracted = extract_invoice_data("A document without invoice fields")

		self.assertTrue(all(value is None for value in extracted.values()))

	def test_extracts_purchase_order_reference(self):
		extracted = extract_invoice_data("Vendor: Northwind\nPO Number: PO-2026-0024")
		self.assertEqual(extracted["purchase_order_number"], "PO-2026-0024")


class InvoiceUploadOCRTests(TestCase):
	def setUp(self):
		super().setUp()
		self.media_directory = tempfile.TemporaryDirectory()
		media_settings = override_settings(MEDIA_ROOT=self.media_directory.name)
		media_settings.enable()
		self.addCleanup(media_settings.disable)
		self.addCleanup(self.media_directory.cleanup)
		self.client = APIClient()

	@patch("invoices.views.extract_text_from_invoice", return_value=OCR_SAMPLE_TEXT)
	def test_upload_saves_original_and_persists_extracted_fields(self, _mock_ocr):
		upload = SimpleUploadedFile(
			"sample_invoice_test.pdf", b"test PDF bytes", content_type="application/pdf"
		)

		response = self.client.post(
			"/api/invoices/", {"invoice_file": upload}, format="multipart"
		)

		self.assertEqual(response.status_code, 201)
		self.assertEqual(response.data["ocr_status"], "completed")
		invoice = Invoice.objects.get(pk=response.data["id"])
		self.assertTrue(invoice.invoice_file.storage.exists(invoice.invoice_file.name))
		self.assertEqual(invoice.vendor_name, "Northwind Office Supplies")
		self.assertEqual(invoice.invoice_number, "NW-2026-1042")
		self.assertEqual(invoice.subtotal_amount, Decimal("9600.00"))
		self.assertEqual(invoice.tax_amount, Decimal("1728.00"))
		self.assertEqual(invoice.total_amount, Decimal("11328.00"))

		detail_response = self.client.get(f"/api/invoices/{invoice.pk}/")
		self.assertEqual(detail_response.status_code, 200)
		self.assertEqual(detail_response.data["ocr_status"], "completed")
		self.assertEqual(detail_response.data["ocr_error"], "")
		self.assertTrue(detail_response.data["invoice_file"].endswith("sample_invoice_test.pdf"))

	@patch(
		"invoices.views.extract_text_from_invoice",
		side_effect=RuntimeError("OCR unavailable"),
	)
	def test_ocr_failure_keeps_upload_and_marks_invoice_for_review(self, _mock_ocr):
		upload = SimpleUploadedFile(
			"unreadable_invoice.pdf", b"test PDF bytes", content_type="application/pdf"
		)

		response = self.client.post(
			"/api/invoices/", {"invoice_file": upload}, format="multipart"
		)

		self.assertEqual(response.status_code, 201)
		self.assertEqual(response.data["ocr_status"], "failed")
		invoice = Invoice.objects.get(pk=response.data["id"])
		self.assertEqual(invoice.status, "EXCEPTION")
		self.assertTrue(invoice.invoice_file.storage.exists(invoice.invoice_file.name))
		detail_response = self.client.get(f"/api/invoices/{invoice.pk}/")
		self.assertEqual(detail_response.data["ocr_status"], "failed")
		self.assertTrue(detail_response.data["ocr_error"])


class InvoiceValidationTests(TestCase):
	def setUp(self):
		super().setUp()
		self.media_directory = tempfile.TemporaryDirectory()
		media_settings = override_settings(MEDIA_ROOT=self.media_directory.name)
		media_settings.enable()
		self.addCleanup(media_settings.disable)
		self.addCleanup(self.media_directory.cleanup)
		self.client = APIClient()

	def make_invoice(self, **overrides):
		values = {
			"invoice_number": "INV-VALIDATION-1",
			"vendor_name": "Validation Vendor",
			"invoice_date": "2026-01-10",
			"due_date": "2026-01-20",
			"subtotal_amount": Decimal("100.00"),
			"tax_amount": Decimal("18.00"),
			"total_amount": Decimal("118.00"),
			"invoice_file": SimpleUploadedFile("validation.pdf", b"test PDF"),
		}
		values.update(overrides)
		return Invoice.objects.create(**values)

	def test_valid_invoice_and_one_unit_rounding_tolerance(self):
		invoice = self.make_invoice(total_amount=Decimal("119.00"))

		errors = validate_invoice(invoice)

		self.assertEqual(errors, [])
		invoice.refresh_from_db()
		self.assertEqual(invoice.validation_status, "VALID")
		self.assertEqual(invoice.status, "UPLOADED")

	def test_missing_fields_and_invalid_amounts_are_saved_as_exceptions(self):
		invoice = self.make_invoice(
			vendor_name="",
			invoice_number=None,
			invoice_date=None,
			due_date="2026-01-01",
			subtotal_amount=Decimal("-1.00"),
			tax_amount=Decimal("-2.00"),
			total_amount=Decimal("-3.00"),
		)

		errors = validate_invoice(invoice)

		self.assertIn("Vendor name is missing.", errors)
		self.assertIn("Invoice number is missing.", errors)
		self.assertIn("Invoice date is missing.", errors)
		self.assertIn("Subtotal cannot be negative.", errors)
		self.assertIn("Tax amount cannot be negative.", errors)
		self.assertIn("Total amount cannot be negative.", errors)
		self.assertIn("Tax amount is greater than the total amount.", errors)
		invoice.refresh_from_db()
		self.assertEqual(invoice.validation_status, "EXCEPTION")
		self.assertEqual(invoice.status, "EXCEPTION")

	def test_missing_required_amounts_and_due_date_order_are_reported(self):
		invoice = self.make_invoice(
			due_date="2026-01-01",
			subtotal_amount=None,
			tax_amount=None,
			total_amount=None,
		)

		errors = validate_invoice(invoice)

		self.assertIn("Due date is earlier than invoice date.", errors)
		self.assertIn("Subtotal is missing.", errors)
		self.assertIn("Tax amount is missing.", errors)
		self.assertIn("Total amount is missing.", errors)

	def test_duplicate_is_flagged_but_both_records_are_kept(self):
		original = self.make_invoice()
		validate_invoice(original)
		duplicate = self.make_invoice(
			invoice_number=" inv-validation-1 ",
			vendor_name="  validation   vendor ",
			invoice_file=SimpleUploadedFile("duplicate.pdf", b"duplicate PDF"),
		)

		errors = validate_invoice(duplicate)

		self.assertTrue(any("Duplicate invoice" in error for error in errors))
		duplicate.refresh_from_db()
		self.assertTrue(duplicate.is_duplicate)
		self.assertEqual(duplicate.duplicate_of_id, original.pk)
		self.assertEqual(duplicate.status, "EXCEPTION")
		self.assertEqual(Invoice.objects.count(), 2)

	def test_api_update_revalidates_amounts(self):
		invoice = self.make_invoice()
		validate_invoice(invoice)

		response = self.client.patch(
			f"/api/invoices/{invoice.pk}/",
			{"total_amount": "150.00"},
			format="multipart",
		)

		self.assertEqual(response.status_code, 200)
		self.assertEqual(response.data["validation_status"], "EXCEPTION")
		self.assertIn("Subtotal plus tax does not match the total", response.data["validation_errors"][0])


class InvoiceApprovalWorkflowTests(TestCase):
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
			"invoice_number": "INV-WORKFLOW-1",
			"vendor_name": "Workflow Vendor",
			"invoice_date": "2026-03-01",
			"due_date": "2026-03-15",
			"subtotal_amount": Decimal("250.00"),
			"tax_amount": Decimal("45.00"),
			"total_amount": Decimal("295.00"),
			"invoice_file": SimpleUploadedFile("workflow.pdf", b"workflow PDF"),
		}
		values.update(overrides)
		invoice = Invoice.objects.create(**values)
		validate_invoice(invoice)
		invoice.refresh_from_db()
		return invoice

	def post_action(self, invoice, action, data=None):
		return self.client.post(
			f"/api/invoices/{invoice.pk}/{action}/",
			data or {},
			format="json",
		)

	def test_submit_reject_resubmit_approve_and_audit_history(self):
		invoice = self.make_invoice()

		submitted = self.post_action(invoice, "submit-for-approval")
		self.assertEqual(submitted.status_code, 200)
		self.assertEqual(submitted.data["status"], "PENDING")

		missing_reason = self.post_action(invoice, "reject")
		self.assertEqual(missing_reason.status_code, 400)
		self.assertEqual(missing_reason.data["detail"], "A rejection reason is required.")

		rejected = self.post_action(invoice, "reject", {"reason": "Please correct the purchase order reference."})
		self.assertEqual(rejected.status_code, 200)
		self.assertEqual(rejected.data["status"], "REJECTED")
		self.assertEqual(rejected.data["rejection_reason"], "Please correct the purchase order reference.")
		self.assertIsNotNone(rejected.data["rejected_at"])

		resubmitted = self.post_action(invoice, "resubmit")
		self.assertEqual(resubmitted.status_code, 200)
		self.assertEqual(resubmitted.data["status"], "PENDING")
		self.assertEqual(resubmitted.data["rejection_reason"], "")
		self.assertIsNone(resubmitted.data["rejected_at"])

		approved = self.post_action(invoice, "approve")
		self.assertEqual(approved.status_code, 200)
		self.assertEqual(approved.data["status"], "APPROVED")
		self.assertEqual(len(approved.data["approval_history"]), 4)
		self.assertEqual(
			[entry["action"] for entry in approved.data["approval_history"]],
			["submitted", "rejected", "resubmitted", "approved"],
		)
		self.assertEqual(ApprovalHistory.objects.filter(invoice=invoice).count(), 4)
		self.assertEqual(approved.data["approval_history"][1]["rejection_reason"], "Please correct the purchase order reference.")

	def test_invalid_duplicate_and_wrong_state_actions_are_rejected(self):
		invalid = self.make_invoice(invoice_date=None, invoice_number="INV-MISSING-DATE")
		invalid_response = self.post_action(invalid, "submit-for-approval")
		self.assertEqual(invalid_response.status_code, 400)
		self.assertIn("Invoice date is missing.", invalid_response.data["detail"])
		invalid.refresh_from_db()
		self.assertEqual(invalid.status, "EXCEPTION")
		self.assertIn("Invoice date is missing.", invalid.validation_errors)

		original = self.make_invoice()
		duplicate = self.make_invoice(
			invoice_file=SimpleUploadedFile("duplicate-workflow.pdf", b"duplicate PDF")
		)
		duplicate_response = self.post_action(duplicate, "submit-for-approval")
		self.assertEqual(duplicate_response.status_code, 400)
		self.assertIn("Duplicate invoice", duplicate_response.data["detail"])

		self.assertEqual(self.post_action(original, "approve").status_code, 400)
		self.assertEqual(self.post_action(original, "reject", {"reason": "No"}).status_code, 400)

	def test_approved_invoice_cannot_be_edited_or_reapproved(self):
		invoice = self.make_invoice()
		self.post_action(invoice, "submit-for-approval")
		self.post_action(invoice, "approve")

		edit_response = self.client.patch(
			f"/api/invoices/{invoice.pk}/",
			{"vendor_name": "Changed Vendor"},
			format="json",
		)
		self.assertEqual(edit_response.status_code, 400)
		self.assertIn("Approved invoices cannot be edited.", edit_response.data["detail"])
		self.assertEqual(self.post_action(invoice, "approve").status_code, 400)

	def test_corrected_rejected_invoice_can_be_resubmitted(self):
		invoice = self.make_invoice()
		self.post_action(invoice, "submit-for-approval")
		self.post_action(invoice, "reject", {"reason": "Correct the total amount."})

		invalid_edit = self.client.patch(
			f"/api/invoices/{invoice.pk}/",
			{"total_amount": "400.00"},
			format="json",
		)
		self.assertEqual(invalid_edit.data["status"], "EXCEPTION")

		corrected_edit = self.client.patch(
			f"/api/invoices/{invoice.pk}/",
			{"total_amount": "295.00"},
			format="json",
		)
		self.assertEqual(corrected_edit.data["validation_status"], "VALID")
		self.assertEqual(corrected_edit.data["status"], "REJECTED")
		resubmitted = self.post_action(invoice, "resubmit")
		self.assertEqual(resubmitted.status_code, 200)
		self.assertEqual(resubmitted.data["status"], "PENDING")

	@override_settings(DEBUG=False)
	def test_workflow_action_requires_login_outside_debug(self):
		invoice = self.make_invoice()
		response = self.post_action(invoice, "submit-for-approval")
		self.assertEqual(response.status_code, 403)

		user = get_user_model().objects.create_user(
			username="approver", password="not-used", is_staff=True
		)
		self.client.force_authenticate(user=user)
		authorized_response = self.post_action(invoice, "submit-for-approval")
		self.assertEqual(authorized_response.status_code, 200)
		self.assertEqual(authorized_response.data["approval_history"][0]["performed_by_name"], "approver")

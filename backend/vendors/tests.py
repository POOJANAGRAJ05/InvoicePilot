from rest_framework.test import APITestCase

from .models import Vendor


class VendorManagementTests(APITestCase):
	def payload(self, **overrides):
		data = {
			"name": "Northwind Office Supplies",
			"vendor_code": "NW-001",
			"email": "ap@example.test",
			"tax_registration_number": "29 ABCDE 1234 F1Z5",
			"payment_terms": "Net 30",
		}
		data.update(overrides)
		return data

	def test_vendor_create_normalizes_identity_and_masks_bank_data_from_list(self):
		data = self.payload(bank_name="Demo Bank", account_holder_name="Northwind", bank_account_number="1234567890", ifsc_code="abcd0001234")
		response = self.client.post("/api/vendors/", data, format="json")
		self.assertEqual(response.status_code, 201)
		self.assertEqual(response.data["vendor_code"], "NW-001")
		self.assertEqual(response.data["tax_registration_number"], "29ABCDE1234F1Z5")
		self.assertEqual(response.data["ifsc_code"], "ABCD0001234")
		list_response = self.client.get("/api/vendors/")
		self.assertEqual(list_response.status_code, 200)
		self.assertNotIn("bank_account_number", list_response.data[0])

	def test_duplicate_code_gstin_and_normalized_vendor_identity_rejected(self):
		self.client.post("/api/vendors/", self.payload(), format="json")
		duplicate_code = self.client.post("/api/vendors/", self.payload(name="Another Supplier"), format="json")
		self.assertEqual(duplicate_code.status_code, 400)
		duplicate_identity = self.client.post("/api/vendors/", self.payload(vendor_code="NW-002", name="  NORTHWIND   OFFICE SUPPLIES "), format="json")
		self.assertEqual(duplicate_identity.status_code, 400)
		duplicate_gstin = self.client.post("/api/vendors/", self.payload(vendor_code="NW-003", name="Northwind Branch"), format="json")
		self.assertEqual(duplicate_gstin.status_code, 400)

	def test_same_name_with_distinct_gstin_is_allowed_and_vendor_stats_are_real(self):
		self.client.post("/api/vendors/", self.payload(tax_registration_number="29ABCDE1234F1Z5"), format="json")
		second = self.client.post("/api/vendors/", self.payload(vendor_code="NW-002", tax_registration_number="27ZZZZZ9999X1Z2"), format="json")
		self.assertEqual(second.status_code, 201)
		vendor_id = second.data["id"]
		detail = self.client.get(f"/api/vendors/{vendor_id}/")
		self.assertEqual(detail.status_code, 200)
		self.assertEqual(detail.data["invoice_count"], 0)

	def test_activate_and_deactivate_actions_persist(self):
		vendor = Vendor.objects.create(name="Status Vendor", vendor_code="STAT-1", status="ACTIVE")
		deactivated = self.client.post(f"/api/vendors/{vendor.pk}/deactivate/", {}, format="json")
		self.assertEqual(deactivated.data["status"], "INACTIVE")
		activated = self.client.post(f"/api/vendors/{vendor.pk}/activate/", {}, format="json")
		self.assertEqual(activated.data["status"], "ACTIVE")

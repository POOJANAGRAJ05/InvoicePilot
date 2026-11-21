import re

from django.db import models


class Vendor(models.Model):
	STATUS_CHOICES = [("ACTIVE", "Active"), ("INACTIVE", "Inactive")]

	name = models.CharField(max_length=255)
	vendor_code = models.CharField(max_length=40, unique=True)
	email = models.EmailField(blank=True, default="")
	phone_number = models.CharField(max_length=40, blank=True, default="")
	tax_registration_number = models.CharField(max_length=32, blank=True, null=True, unique=True)
	contact_person = models.CharField(max_length=255, blank=True, default="")
	address = models.TextField(blank=True, default="")
	payment_terms = models.CharField(max_length=80, blank=True, default="")
	bank_name = models.CharField(max_length=255, blank=True, default="")
	account_holder_name = models.CharField(max_length=255, blank=True, default="")
	bank_account_number = models.CharField(max_length=64, blank=True, default="")
	ifsc_code = models.CharField(max_length=20, blank=True, default="")
	status = models.CharField(max_length=12, choices=STATUS_CHOICES, default="ACTIVE")
	created_at = models.DateTimeField(auto_now_add=True)
	updated_at = models.DateTimeField(auto_now=True)

	class Meta:
		ordering = ["name", "id"]
		constraints = [
			models.UniqueConstraint(
				models.functions.Lower("name"),
				condition=models.Q(tax_registration_number__isnull=True) | models.Q(tax_registration_number=""),
				name="vendors_unique_normalized_name_no_gstin",
			),
		]

	@staticmethod
	def normalize_name(value):
		return " ".join((value or "").split()).casefold()

	@staticmethod
	def normalize_tax_id(value):
		return re.sub(r"\s+", "", (value or "")).upper()

	def save(self, *args, **kwargs):
		self.name = " ".join(self.name.split())
		self.vendor_code = self.vendor_code.strip().upper()
		self.tax_registration_number = self.normalize_tax_id(self.tax_registration_number) or None
		self.ifsc_code = (self.ifsc_code or "").strip().upper()
		super().save(*args, **kwargs)

	def __str__(self):
		return f"{self.name} ({self.vendor_code})"

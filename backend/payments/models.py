from django.conf import settings
from django.db import models


class Payment(models.Model):
	PAYMENT_METHOD_CHOICES = [
		("BANK_TRANSFER", "Bank Transfer"),
		("UPI", "UPI"),
		("CHEQUE", "Cheque"),
		("CASH", "Cash"),
		("OTHER", "Other"),
	]

	invoice = models.OneToOneField(
		"invoices.Invoice",
		on_delete=models.PROTECT,
		related_name="payment",
	)
	amount = models.DecimalField(max_digits=12, decimal_places=2)
	payment_date = models.DateField()
	payment_method = models.CharField(max_length=20, choices=PAYMENT_METHOD_CHOICES)
	reference_number = models.CharField(max_length=255, blank=True, default="")
	notes = models.TextField(blank=True, default="")
	created_at = models.DateTimeField(auto_now_add=True)
	created_by = models.ForeignKey(
		settings.AUTH_USER_MODEL,
		on_delete=models.SET_NULL,
		blank=True,
		null=True,
		related_name="invoice_payments_recorded",
	)

	class Meta:
		ordering = ["-payment_date", "-created_at"]
		permissions = [
			("record_invoice_payment", "Can record invoice payments"),
		]

	def __str__(self):
		return f"Payment for invoice {self.invoice_id}: {self.amount}"

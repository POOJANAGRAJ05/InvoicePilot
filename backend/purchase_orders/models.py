from decimal import Decimal
from uuid import uuid4

from django.db import models


class PurchaseOrder(models.Model):
	STATUS_CHOICES = [
		("DRAFT", "Draft"),
		("ISSUED", "Issued"),
		("PARTIALLY_RECEIVED", "Partially Received"),
		("RECEIVED", "Received"),
		("CLOSED", "Closed"),
		("CANCELLED", "Cancelled"),
	]

	po_number = models.CharField(max_length=40, unique=True)
	vendor = models.ForeignKey("vendors.Vendor", on_delete=models.PROTECT, related_name="purchase_orders")
	po_date = models.DateField()
	expected_delivery_date = models.DateField(blank=True, null=True)
	notes = models.TextField(blank=True, default="")
	status = models.CharField(max_length=24, choices=STATUS_CHOICES, default="DRAFT")
	cancellation_reason = models.TextField(blank=True, default="")
	created_at = models.DateTimeField(auto_now_add=True)
	updated_at = models.DateTimeField(auto_now=True)

	class Meta:
		ordering = ["-po_date", "-id"]

	def save(self, *args, **kwargs):
		if not self.po_number:
			self.po_number = f"PO-{uuid4().hex[:12].upper()}"
		else:
			self.po_number = self.po_number.strip().upper()
		super().save(*args, **kwargs)

	@property
	def subtotal_amount(self):
		return sum((item.subtotal for item in self.line_items.all()), Decimal("0.00"))

	@property
	def tax_amount(self):
		return sum((item.tax_amount for item in self.line_items.all()), Decimal("0.00"))

	@property
	def total_amount(self):
		return self.subtotal_amount + self.tax_amount

	def __str__(self):
		return self.po_number


class PurchaseOrderLineItem(models.Model):
	purchase_order = models.ForeignKey(PurchaseOrder, on_delete=models.CASCADE, related_name="line_items")
	description = models.CharField(max_length=500)
	quantity = models.DecimalField(max_digits=12, decimal_places=3)
	unit_price = models.DecimalField(max_digits=12, decimal_places=2)
	tax_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("0.00"))

	class Meta:
		ordering = ["id"]
		constraints = [
			models.CheckConstraint(condition=models.Q(quantity__gt=0), name="purchase_order_item_quantity_positive"),
			models.CheckConstraint(condition=models.Q(unit_price__gte=0), name="purchase_order_item_unit_price_nonnegative"),
			models.CheckConstraint(condition=models.Q(tax_rate__gte=0, tax_rate__lte=100), name="purchase_order_item_tax_rate_range"),
		]

	@property
	def subtotal(self):
		return (self.quantity * self.unit_price).quantize(Decimal("0.01"))

	@property
	def tax_amount(self):
		return (self.subtotal * self.tax_rate / Decimal("100")).quantize(Decimal("0.01"))

	@property
	def total(self):
		return self.subtotal + self.tax_amount

	def __str__(self):
		return self.description


class InvoicePurchaseOrderMatch(models.Model):
	MATCH_CHOICES = [
		("MATCHED", "Matched"),
		("PARTIAL_MATCH", "Partial match"),
		("MISMATCH", "Mismatch"),
		("UNMATCHED", "Unmatched"),
	]

	invoice = models.ForeignKey("invoices.Invoice", on_delete=models.CASCADE, related_name="po_matches")
	purchase_order = models.ForeignKey(PurchaseOrder, on_delete=models.PROTECT, related_name="invoice_matches")
	result = models.CharField(max_length=20, choices=MATCH_CHOICES)
	explanations = models.JSONField(default=list, blank=True)
	created_at = models.DateTimeField(auto_now_add=True)

	class Meta:
		ordering = ["-created_at", "-id"]

	def __str__(self):
		return f"Invoice {self.invoice_id} vs {self.purchase_order.po_number}: {self.result}"

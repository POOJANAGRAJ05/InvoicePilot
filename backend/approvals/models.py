from django.conf import settings
from django.db import models


class ApprovalHistory(models.Model):
	ACTION_CHOICES = [
		("submitted", "Submitted for approval"),
		("approved", "Approved"),
		("rejected", "Rejected"),
		("resubmitted", "Resubmitted"),
	]

	invoice = models.ForeignKey(
		"invoices.Invoice",
		on_delete=models.CASCADE,
		related_name="approval_history",
	)
	previous_status = models.CharField(max_length=20)
	new_status = models.CharField(max_length=20)
	action = models.CharField(max_length=20, choices=ACTION_CHOICES)
	performed_by = models.ForeignKey(
		settings.AUTH_USER_MODEL,
		on_delete=models.SET_NULL,
		blank=True,
		null=True,
		related_name="invoice_approval_actions",
	)
	timestamp = models.DateTimeField(auto_now_add=True)
	rejection_reason = models.TextField(blank=True, default="")

	class Meta:
		ordering = ["timestamp", "pk"]

	def __str__(self):
		return f"Invoice {self.invoice_id}: {self.action}"

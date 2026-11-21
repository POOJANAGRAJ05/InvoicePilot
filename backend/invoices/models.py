
from django.db import models


class Invoice(models.Model):

    STATUS_CHOICES = [
        ('UPLOADED', 'Uploaded'),
        ('PROCESSING', 'Processing'),
        ('PENDING', 'Pending Approval'),
        ('APPROVED', 'Approved'),
        ('REJECTED', 'Rejected'),
        ('PAID', 'Paid'),
        ('EXCEPTION', 'Exception'),
    ]

    invoice_number = models.CharField(max_length=100, blank=True, null=True)

    vendor_name = models.CharField(max_length=255, blank=True, null=True)

    vendor = models.ForeignKey(
        "vendors.Vendor",
        on_delete=models.PROTECT,
        blank=True,
        null=True,
        related_name="invoices",
    )

    purchase_order_number = models.CharField(max_length=40, blank=True, default="")

    invoice_date = models.DateField(blank=True, null=True)

    due_date = models.DateField(blank=True, null=True)

    total_amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        blank=True,
        null=True
    )

    subtotal_amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        blank=True,
        null=True
    )

    tax_amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        blank=True,
        null=True
    )

    invoice_file = models.FileField(upload_to='invoices/')

    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default='UPLOADED'
    )

    ocr_status = models.CharField(max_length=20, blank=True, default='')

    ocr_error = models.TextField(blank=True, default='')

    validation_status = models.CharField(max_length=20, blank=True, default='')

    validation_errors = models.JSONField(default=list, blank=True)

    is_duplicate = models.BooleanField(default=False)

    duplicate_of = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name='duplicate_invoices',
    )

    rejection_reason = models.TextField(blank=True, default='')

    rejected_at = models.DateTimeField(blank=True, null=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        permissions = [
            ("approve_invoice", "Can perform invoice approval workflow actions"),
        ]

    def __str__(self):
        return self.invoice_number or f"Invoice {self.id}"


class InvoiceLineItem(models.Model):

    invoice = models.ForeignKey(
        Invoice,
        on_delete=models.CASCADE,
        related_name="line_items"
    )

    product_code = models.CharField(max_length=100, blank=True, default="")

    description = models.TextField()

    quantity = models.DecimalField(
        max_digits=12,
        decimal_places=3,
        default=1
    )

    unit_price = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0
    )

    line_total = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0
    )

    tax_amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
    blank=True,
        null=True
    )

    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.description} - Invoice {self.invoice_id}"

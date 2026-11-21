import decimal
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("invoices", "0008_invoice_vendor_po_reference"),
        ("vendors", "0001_vendor"),
    ]

    operations = [
        migrations.CreateModel(
            name="PurchaseOrder",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("po_number", models.CharField(max_length=40, unique=True)),
                ("po_date", models.DateField()),
                ("expected_delivery_date", models.DateField(blank=True, null=True)),
                ("notes", models.TextField(blank=True, default="")),
                ("status", models.CharField(choices=[("DRAFT", "Draft"), ("ISSUED", "Issued"), ("PARTIALLY_RECEIVED", "Partially Received"), ("RECEIVED", "Received"), ("CLOSED", "Closed"), ("CANCELLED", "Cancelled")], default="DRAFT", max_length=24)),
                ("cancellation_reason", models.TextField(blank=True, default="")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("vendor", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="purchase_orders", to="vendors.vendor")),
            ],
            options={"ordering": ["-po_date", "-id"]},
        ),
        migrations.CreateModel(
            name="PurchaseOrderLineItem",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("description", models.CharField(max_length=500)),
                ("quantity", models.DecimalField(decimal_places=3, max_digits=12)),
                ("unit_price", models.DecimalField(decimal_places=2, max_digits=12)),
                ("tax_rate", models.DecimalField(decimal_places=2, default=decimal.Decimal("0.00"), max_digits=5)),
                ("purchase_order", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="line_items", to="purchase_orders.purchaseorder")),
            ],
            options={"ordering": ["id"]},
        ),
        migrations.AddConstraint(
            model_name="purchaseorderlineitem",
            constraint=models.CheckConstraint(condition=models.Q(("quantity__gt", 0)), name="purchase_order_item_quantity_positive"),
        ),
        migrations.AddConstraint(
            model_name="purchaseorderlineitem",
            constraint=models.CheckConstraint(condition=models.Q(("unit_price__gte", 0)), name="purchase_order_item_unit_price_nonnegative"),
        ),
        migrations.AddConstraint(
            model_name="purchaseorderlineitem",
            constraint=models.CheckConstraint(condition=models.Q(("tax_rate__gte", 0), ("tax_rate__lte", 100)), name="purchase_order_item_tax_rate_range"),
        ),
        migrations.CreateModel(
            name="InvoicePurchaseOrderMatch",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("result", models.CharField(choices=[("MATCHED", "Matched"), ("PARTIAL_MATCH", "Partial match"), ("MISMATCH", "Mismatch"), ("UNMATCHED", "Unmatched")], max_length=20)),
                ("explanations", models.JSONField(blank=True, default=list)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("invoice", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="po_matches", to="invoices.invoice")),
                ("purchase_order", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="invoice_matches", to="purchase_orders.purchaseorder")),
            ],
            options={"ordering": ["-created_at", "-id"]},
        ),
    ]

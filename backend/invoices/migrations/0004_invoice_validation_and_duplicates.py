from django.db import migrations, models
import django.db.models.deletion
from decimal import Decimal


def populate_validation_results(apps, schema_editor):
    Invoice = apps.get_model("invoices", "Invoice")
    database = schema_editor.connection.alias
    invoices = list(Invoice.objects.using(database).order_by("created_at", "pk"))
    seen = {}

    for invoice in invoices:
        errors = []
        required_fields = (
            ("vendor_name", "Vendor name is missing."),
            ("invoice_number", "Invoice number is missing."),
            ("invoice_date", "Invoice date is missing."),
            ("due_date", "Due date is missing."),
            ("subtotal_amount", "Subtotal is missing."),
            ("tax_amount", "Tax amount is missing."),
            ("total_amount", "Total amount is missing."),
        )
        for field, message in required_fields:
            value = getattr(invoice, field)
            if value is None or (isinstance(value, str) and not value.strip()):
                errors.append(message)

        if invoice.invoice_date and invoice.due_date and invoice.due_date < invoice.invoice_date:
            errors.append("Due date is earlier than invoice date.")

        for field, label in (
            ("subtotal_amount", "Subtotal"),
            ("tax_amount", "Tax amount"),
            ("total_amount", "Total amount"),
        ):
            value = getattr(invoice, field)
            if value is not None and value < 0:
                errors.append(f"{label} cannot be negative.")

        subtotal = invoice.subtotal_amount
        tax = invoice.tax_amount
        total = invoice.total_amount
        if tax is not None and total is not None and tax > total:
            errors.append("Tax amount is greater than the total amount.")
        if subtotal is not None and tax is not None and total is not None:
            if abs(subtotal + tax - total) > Decimal("1.00"):
                errors.append("Subtotal plus tax does not match the total (tolerance: ₹1.00).")

        normalized_vendor = " ".join((invoice.vendor_name or "").split()).casefold()
        normalized_number = " ".join((invoice.invoice_number or "").split()).casefold()
        identity = (normalized_vendor, normalized_number)
        duplicate_of_id = None
        if normalized_vendor and normalized_number:
            duplicate_of_id = seen.get(identity)
            if duplicate_of_id:
                errors.append(
                    f"Duplicate invoice: vendor and invoice number match invoice #{duplicate_of_id}."
                )
            else:
                seen[identity] = invoice.pk

        invoice.is_duplicate = duplicate_of_id is not None
        invoice.duplicate_of_id = duplicate_of_id
        invoice.validation_errors = errors
        invoice.validation_status = "EXCEPTION" if errors else "VALID"
        if errors:
            invoice.status = "EXCEPTION"
        invoice.save(
            using=database,
            update_fields=(
                "is_duplicate",
                "duplicate_of",
                "validation_errors",
                "validation_status",
                "status",
            ),
        )


class Migration(migrations.Migration):

    dependencies = [
        ("invoices", "0003_invoice_ocr_status_error"),
    ]

    operations = [
        migrations.AddField(
            model_name="invoice",
            name="validation_status",
            field=models.CharField(blank=True, default="", max_length=20),
        ),
        migrations.AddField(
            model_name="invoice",
            name="validation_errors",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="invoice",
            name="is_duplicate",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="invoice",
            name="duplicate_of",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="duplicate_invoices",
                to="invoices.invoice",
            ),
        ),
        migrations.RunPython(populate_validation_results, migrations.RunPython.noop),
    ]
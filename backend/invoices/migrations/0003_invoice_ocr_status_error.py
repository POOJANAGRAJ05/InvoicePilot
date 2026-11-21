from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("invoices", "0002_invoice_subtotal_amount"),
    ]

    operations = [
        migrations.AddField(
            model_name="invoice",
            name="ocr_status",
            field=models.CharField(blank=True, default="", max_length=20),
        ),
        migrations.AddField(
            model_name="invoice",
            name="ocr_error",
            field=models.TextField(blank=True, default=""),
        ),
    ]
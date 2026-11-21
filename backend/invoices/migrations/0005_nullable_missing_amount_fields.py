from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("invoices", "0004_invoice_validation_and_duplicates"),
    ]

    operations = [
        migrations.AlterField(
            model_name="invoice",
            name="tax_amount",
            field=models.DecimalField(
                blank=True, decimal_places=2, max_digits=12, null=True
            ),
        ),
        migrations.AlterField(
            model_name="invoice",
            name="total_amount",
            field=models.DecimalField(
                blank=True, decimal_places=2, max_digits=12, null=True
            ),
        ),
    ]
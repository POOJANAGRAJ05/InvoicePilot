from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("invoices", "0007_invoice_approval_permission"),
        ("vendors", "0001_vendor"),
    ]

    operations = [
        migrations.AddField(
            model_name="invoice",
            name="vendor",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="invoices",
                to="vendors.vendor",
            ),
        ),
        migrations.AddField(
            model_name="invoice",
            name="purchase_order_number",
            field=models.CharField(blank=True, default="", max_length=40),
        ),
    ]

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("invoices", "0005_nullable_missing_amount_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="invoice",
            name="rejection_reason",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="invoice",
            name="rejected_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
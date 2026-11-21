from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("invoices", "0007_invoice_approval_permission"),
    ]

    operations = [
        migrations.CreateModel(
            name="Payment",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("amount", models.DecimalField(decimal_places=2, max_digits=12)),
                ("payment_date", models.DateField()),
                (
                    "payment_method",
                    models.CharField(
                        choices=[
                            ("BANK_TRANSFER", "Bank Transfer"),
                            ("UPI", "UPI"),
                            ("CHEQUE", "Cheque"),
                            ("CASH", "Cash"),
                            ("OTHER", "Other"),
                        ],
                        max_length=20,
                    ),
                ),
                ("reference_number", models.CharField(blank=True, default="", max_length=255)),
                ("notes", models.TextField(blank=True, default="")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="invoice_payments_recorded",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "invoice",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="payment",
                        to="invoices.invoice",
                    ),
                ),
            ],
            options={
                "ordering": ["-payment_date", "-created_at"],
                "permissions": [
                    ("record_invoice_payment", "Can record invoice payments"),
                ],
            },
        ),
    ]

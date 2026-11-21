from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("invoices", "0005_nullable_missing_amount_fields"),
    ]

    operations = [
        migrations.CreateModel(
            name="ApprovalHistory",
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
                ("previous_status", models.CharField(max_length=20)),
                ("new_status", models.CharField(max_length=20)),
                (
                    "action",
                    models.CharField(
                        choices=[
                            ("submitted", "Submitted for approval"),
                            ("approved", "Approved"),
                            ("rejected", "Rejected"),
                            ("resubmitted", "Resubmitted"),
                        ],
                        max_length=20,
                    ),
                ),
                ("timestamp", models.DateTimeField(auto_now_add=True)),
                ("rejection_reason", models.TextField(blank=True, default="")),
                (
                    "invoice",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="approval_history",
                        to="invoices.invoice",
                    ),
                ),
                (
                    "performed_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="invoice_approval_actions",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={"ordering": ["timestamp", "pk"]},
        ),
    ]

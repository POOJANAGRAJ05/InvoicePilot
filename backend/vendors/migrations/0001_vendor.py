import django.db.models.functions.text
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="Vendor",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=255)),
                ("vendor_code", models.CharField(max_length=40, unique=True)),
                ("email", models.EmailField(blank=True, default="", max_length=254)),
                ("phone_number", models.CharField(blank=True, default="", max_length=40)),
                ("tax_registration_number", models.CharField(blank=True, max_length=32, null=True, unique=True)),
                ("contact_person", models.CharField(blank=True, default="", max_length=255)),
                ("address", models.TextField(blank=True, default="")),
                ("payment_terms", models.CharField(blank=True, default="", max_length=80)),
                ("bank_name", models.CharField(blank=True, default="", max_length=255)),
                ("account_holder_name", models.CharField(blank=True, default="", max_length=255)),
                ("bank_account_number", models.CharField(blank=True, default="", max_length=64)),
                ("ifsc_code", models.CharField(blank=True, default="", max_length=20)),
                ("status", models.CharField(choices=[("ACTIVE", "Active"), ("INACTIVE", "Inactive")], default="ACTIVE", max_length=12)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={"ordering": ["name", "id"]},
        ),
        migrations.AddConstraint(
            model_name="vendor",
            constraint=models.UniqueConstraint(
                django.db.models.functions.text.Lower("name"),
                condition=models.Q(("tax_registration_number__isnull", True), ("tax_registration_number", ""), _connector="OR"),
                name="vendors_unique_normalized_name_no_gstin",
            ),
        ),
    ]

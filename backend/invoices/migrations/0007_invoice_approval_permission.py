from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("invoices", "0006_invoice_rejection_details"),
    ]

    operations = [
        migrations.AlterModelOptions(
            name="invoice",
            options={
                "permissions": [
                    ("approve_invoice", "Can perform invoice approval workflow actions"),
                ],
            },
        ),
    ]
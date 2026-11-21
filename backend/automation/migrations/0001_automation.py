from django.db import migrations, models
import django.db.models.deletion


def seed_default_rules(apps, schema_editor):
    Rule = apps.get_model("automation", "AutomationRule")
    rules = [
        {
            "rule_key": "block-duplicates",
            "name": "Block duplicate invoices",
            "description": "Duplicate invoices are not routed to approval.",
            "priority": 1000,
            "conditions": {"is_duplicate": True},
            "outcome": "DUPLICATE_BLOCKED",
        },
        {
            "rule_key": "validation-exceptions",
            "name": "Route validation exceptions",
            "description": "Invoices with validation errors remain in exception handling.",
            "priority": 900,
            "conditions": {"validation_status": "EXCEPTION"},
            "outcome": "EXCEPTION",
        },
        {
            "rule_key": "inactive-vendor-review",
            "name": "Review inactive vendors",
            "description": "Do not route invoices from inactive vendors into approval.",
            "priority": 800,
            "conditions": {"vendor_status": ["INACTIVE"]},
            "outcome": "VENDOR_REVIEW_REQUIRED",
        },
        {
            "rule_key": "unregistered-vendor-review",
            "name": "Review unregistered vendors",
            "description": "Unregistered, missing, or ambiguous vendors require human review.",
            "priority": 700,
            "conditions": {"vendor_status": ["UNREGISTERED", "MISSING", "AMBIGUOUS"]},
            "outcome": "VENDOR_REVIEW_REQUIRED",
        },
        {
            "rule_key": "high-value-review",
            "name": "High-value invoice review",
            "description": "Invoices above ₹50,000 are flagged for higher-level review; no approver is assumed.",
            "priority": 600,
            "conditions": {"validation_status": "VALID", "is_duplicate": False, "amount_greater_than": "50000"},
            "outcome": "READY_FOR_REVIEW",
        },
        {
            "rule_key": "mid-value-review",
            "name": "Mid-value invoice review",
            "description": "Invoices from ₹10,000 through ₹50,000 are queued for manual review.",
            "priority": 500,
            "conditions": {"validation_status": "VALID", "is_duplicate": False, "amount_min": "10000", "amount_max": "50000"},
            "outcome": "READY_FOR_REVIEW",
        },
        {
            "rule_key": "standard-approval-routing",
            "name": "Standard approval routing",
            "description": "Valid invoices up to ₹10,000 from active vendors are eligible for manual approval submission.",
            "priority": 400,
            "conditions": {"validation_status": "VALID", "is_duplicate": False, "vendor_status": ["ACTIVE"], "amount_less_than_or_equal": "10000"},
            "outcome": "ROUTED_FOR_APPROVAL",
        },
    ]
    for rule in rules:
        Rule.objects.using(schema_editor.connection.alias).get_or_create(
            rule_key=rule["rule_key"], defaults={**rule, "is_active": True}
        )


def remove_default_rules(apps, schema_editor):
    Rule = apps.get_model("automation", "AutomationRule")
    Rule.objects.using(schema_editor.connection.alias).filter(
        rule_key__in=[
            "block-duplicates", "validation-exceptions", "inactive-vendor-review",
            "unregistered-vendor-review", "high-value-review", "mid-value-review",
            "standard-approval-routing",
        ]
    ).delete()


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        ("invoices", "0008_invoice_vendor_po_reference"),
        ("vendors", "0001_vendor"),
    ]

    operations = [
        migrations.CreateModel(
            name="AutomationConfig",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("enabled", models.BooleanField(default=True)),
                ("last_run_at", models.DateTimeField(blank=True, null=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
        ),
        migrations.CreateModel(
            name="AutomationRule",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("rule_key", models.SlugField(max_length=80, unique=True)),
                ("name", models.CharField(max_length=160)),
                ("description", models.TextField(blank=True, default="")),
                ("priority", models.PositiveIntegerField(default=100)),
                ("conditions", models.JSONField(blank=True, default=dict)),
                ("outcome", models.CharField(choices=[("READY_FOR_REVIEW", "Ready for review"), ("ROUTED_FOR_APPROVAL", "Routed for approval"), ("EXCEPTION", "Exception"), ("DUPLICATE_BLOCKED", "Duplicate blocked"), ("VENDOR_REVIEW_REQUIRED", "Vendor review required")], max_length=32)),
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={"ordering": ["-priority", "id"], "permissions": [("manage_automation_rules", "Can manage invoice automation rules")]},
        ),
        migrations.CreateModel(
            name="AutomationRun",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("trigger", models.CharField(choices=[("MANUAL", "Manual"), ("UPLOAD", "Invoice upload"), ("SCHEDULED", "Scheduled")], max_length=16)),
                ("started_at", models.DateTimeField(auto_now_add=True)),
                ("finished_at", models.DateTimeField(blank=True, null=True)),
                ("processed_count", models.PositiveIntegerField(default=0)),
                ("reminder_count", models.PositiveIntegerField(default=0)),
                ("failure_count", models.PositiveIntegerField(default=0)),
                ("success", models.BooleanField(default=True)),
                ("explanation", models.TextField(blank=True, default="")),
            ],
            options={"ordering": ["-started_at", "-id"]},
        ),
        migrations.CreateModel(
            name="AutomationActivity",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("trigger", models.CharField(max_length=24)),
                ("action", models.CharField(max_length=40)),
                ("result", models.CharField(max_length=32)),
                ("explanation", models.TextField(blank=True, default="")),
                ("success", models.BooleanField(default=True)),
                ("idempotency_key", models.CharField(max_length=180, unique=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("invoice", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="automation_activities", to="invoices.invoice")),
                ("rule", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="executions", to="automation.automationrule")),
                ("run", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="activities", to="automation.automationrun")),
            ],
            options={"ordering": ["-created_at", "-id"]},
        ),
        migrations.CreateModel(
            name="AutomationNotification",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("notification_type", models.CharField(choices=[("UPCOMING_DUE", "Upcoming due date"), ("OVERDUE", "Overdue invoice"), ("EXCEPTION", "Invoice exception"), ("DUPLICATE", "Duplicate detected"), ("APPROVAL_REQUIRED", "Approval required"), ("AUTOMATION", "Automation action completed"), ("VENDOR_ISSUE", "Vendor issue"), ("DUE_DATE_MISSING", "Missing due date")], max_length=24)),
                ("title", models.CharField(max_length=200)),
                ("message", models.TextField()),
                ("period_key", models.CharField(max_length=32)),
                ("is_read", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("invoice", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name="automation_notifications", to="invoices.invoice")),
            ],
            options={"ordering": ["-created_at", "-id"]},
        ),
        migrations.AddConstraint(
            model_name="automationnotification",
            constraint=models.UniqueConstraint(fields=("invoice", "notification_type", "period_key"), name="automation_unique_invoice_notification_period"),
        ),
        migrations.RunPython(seed_default_rules, remove_default_rules),
    ]

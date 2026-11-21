from django.conf import settings
from django.db import models


class AutomationRule(models.Model):
    OUTCOME_CHOICES = [
        ("READY_FOR_REVIEW", "Ready for review"),
        ("ROUTED_FOR_APPROVAL", "Routed for approval"),
        ("EXCEPTION", "Exception"),
        ("DUPLICATE_BLOCKED", "Duplicate blocked"),
        ("VENDOR_REVIEW_REQUIRED", "Vendor review required"),
    ]

    rule_key = models.SlugField(max_length=80, unique=True)
    name = models.CharField(max_length=160)
    description = models.TextField(blank=True, default="")
    priority = models.PositiveIntegerField(default=100)
    conditions = models.JSONField(default=dict, blank=True)
    outcome = models.CharField(max_length=32, choices=OUTCOME_CHOICES)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-priority", "id"]
        permissions = [("manage_automation_rules", "Can manage invoice automation rules")]

    def __str__(self):
        return self.name


class AutomationConfig(models.Model):
    """Single persisted feature switch; it does not change invoice workflow state."""

    enabled = models.BooleanField(default=True)
    last_run_at = models.DateTimeField(blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)

    @classmethod
    def current(cls):
        config, _created = cls.objects.get_or_create(pk=1, defaults={"enabled": True})
        return config

    def __str__(self):
        return "Invoice automation settings"


class AutomationRun(models.Model):
    TRIGGER_CHOICES = [("MANUAL", "Manual"), ("UPLOAD", "Invoice upload"), ("SCHEDULED", "Scheduled")]

    trigger = models.CharField(max_length=16, choices=TRIGGER_CHOICES)
    started_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(blank=True, null=True)
    processed_count = models.PositiveIntegerField(default=0)
    reminder_count = models.PositiveIntegerField(default=0)
    failure_count = models.PositiveIntegerField(default=0)
    success = models.BooleanField(default=True)
    explanation = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-started_at", "-id"]


class AutomationActivity(models.Model):
    invoice = models.ForeignKey(
        "invoices.Invoice", on_delete=models.SET_NULL, blank=True, null=True,
        related_name="automation_activities",
    )
    rule = models.ForeignKey(
        AutomationRule, on_delete=models.SET_NULL, blank=True, null=True,
        related_name="executions",
    )
    run = models.ForeignKey(
        AutomationRun, on_delete=models.SET_NULL, blank=True, null=True,
        related_name="activities",
    )
    trigger = models.CharField(max_length=24)
    action = models.CharField(max_length=40)
    result = models.CharField(max_length=32)
    explanation = models.TextField(blank=True, default="")
    success = models.BooleanField(default=True)
    idempotency_key = models.CharField(max_length=180, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]


class AutomationNotification(models.Model):
    TYPE_CHOICES = [
        ("UPCOMING_DUE", "Upcoming due date"),
        ("OVERDUE", "Overdue invoice"),
        ("EXCEPTION", "Invoice exception"),
        ("DUPLICATE", "Duplicate detected"),
        ("APPROVAL_REQUIRED", "Approval required"),
        ("AUTOMATION", "Automation action completed"),
        ("VENDOR_ISSUE", "Vendor issue"),
        ("DUE_DATE_MISSING", "Missing due date"),
    ]

    invoice = models.ForeignKey(
        "invoices.Invoice", on_delete=models.CASCADE, blank=True, null=True,
        related_name="automation_notifications",
    )
    notification_type = models.CharField(max_length=24, choices=TYPE_CHOICES)
    title = models.CharField(max_length=200)
    message = models.TextField()
    period_key = models.CharField(max_length=32)
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["invoice", "notification_type", "period_key"],
                name="automation_unique_invoice_notification_period",
            ),
        ]

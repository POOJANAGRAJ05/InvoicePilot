from rest_framework import serializers

from invoices.models import Invoice
from .models import AutomationActivity, AutomationConfig, AutomationNotification, AutomationRule, AutomationRun


class AutomationRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = AutomationRule
        fields = ("id", "rule_key", "name", "description", "priority", "conditions", "outcome", "is_active", "created_at", "updated_at")
        read_only_fields = ("id", "created_at", "updated_at")

    def validate_conditions(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("Conditions must be a JSON object.")
        supported = {
            "amount_min", "amount_max", "amount_greater_than", "amount_less_than_or_equal",
            "validation_status", "is_duplicate", "vendor_status", "invoice_status", "vendor_id",
        }
        unknown = set(value) - supported
        if unknown:
            raise serializers.ValidationError(f"Unsupported condition field(s): {', '.join(sorted(unknown))}.")
        if "amount_min" in value and "amount_max" in value:
            if float(value["amount_min"]) > float(value["amount_max"]):
                raise serializers.ValidationError("amount_min cannot exceed amount_max.")
        for field in ("amount_min", "amount_max", "amount_greater_than", "amount_less_than_or_equal"):
            if field in value:
                try:
                    if float(value[field]) < 0:
                        raise serializers.ValidationError(f"{field} cannot be negative.")
                except (TypeError, ValueError):
                    raise serializers.ValidationError(f"{field} must be a number.") from None
        if "vendor_status" in value and not isinstance(value["vendor_status"], list):
            raise serializers.ValidationError("vendor_status must be a list of statuses.")
        if "invoice_status" in value and not isinstance(value["invoice_status"], list):
            raise serializers.ValidationError("invoice_status must be a list of statuses.")
        return value

    def validate(self, attrs):
        conditions = attrs.get("conditions", getattr(self.instance, "conditions", {}))
        priority = attrs.get("priority", getattr(self.instance, "priority", 100))
        if "outcome" in attrs or "conditions" in attrs or "priority" in attrs:
            outcome = attrs.get("outcome", getattr(self.instance, "outcome", None))
            peers = AutomationRule.objects.filter(priority=priority, conditions=conditions)
            if self.instance:
                peers = peers.exclude(pk=self.instance.pk)
            if outcome and peers.exclude(outcome=outcome).exists():
                raise serializers.ValidationError({
                    "priority": "A rule with the same priority and conditions already routes to a different outcome. Change priority or conditions to avoid a conflict."
                })
        return attrs


class AutomationActivitySerializer(serializers.ModelSerializer):
    invoice_number = serializers.SerializerMethodField()
    vendor_name = serializers.SerializerMethodField()
    rule_name = serializers.CharField(source="rule.name", read_only=True, default="")

    class Meta:
        model = AutomationActivity
        fields = ("id", "invoice", "invoice_number", "vendor_name", "rule", "rule_name", "run", "trigger", "action", "result", "explanation", "success", "created_at")
        read_only_fields = fields

    def get_invoice_number(self, activity):
        return (activity.invoice.invoice_number or f"Invoice #{activity.invoice_id}") if activity.invoice_id else "System"

    def get_vendor_name(self, activity):
        if not activity.invoice_id:
            return "—"
        return activity.invoice.vendor.name if activity.invoice.vendor_id else (activity.invoice.vendor_name or "Unknown vendor")


class AutomationNotificationSerializer(serializers.ModelSerializer):
    invoice_number = serializers.SerializerMethodField()

    class Meta:
        model = AutomationNotification
        fields = ("id", "invoice", "invoice_number", "notification_type", "title", "message", "period_key", "is_read", "created_at")
        read_only_fields = ("id", "invoice", "invoice_number", "notification_type", "title", "message", "period_key", "created_at")

    def get_invoice_number(self, notification):
        if not notification.invoice_id:
            return ""
        return notification.invoice.invoice_number or f"Invoice #{notification.invoice_id}"


class AutomationConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = AutomationConfig
        fields = ("enabled", "last_run_at", "updated_at")
        read_only_fields = ("last_run_at", "updated_at")


class AutomationRunSerializer(serializers.ModelSerializer):
    class Meta:
        model = AutomationRun
        fields = ("id", "trigger", "started_at", "finished_at", "processed_count", "reminder_count", "failure_count", "success", "explanation")
        read_only_fields = fields

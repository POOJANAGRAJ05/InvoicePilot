from datetime import timedelta

from django.conf import settings
from django.db.models import Count
from django.utils import timezone
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import AllowAny, BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from invoices.models import Invoice
from .models import AutomationActivity, AutomationConfig, AutomationNotification, AutomationRule, AutomationRun
from .serializers import (
    AutomationActivitySerializer,
    AutomationConfigSerializer,
    AutomationNotificationSerializer,
    AutomationRuleSerializer,
    AutomationRunSerializer,
)
from .services import run_automation


class RuleManagementPermission(BasePermission):
    message = "Only authorized administrators can manage automation rules."

    def has_permission(self, request, view):
        if settings.DEBUG:
            return True
        user = request.user
        return bool(user and user.is_authenticated and (user.is_staff or user.has_perm("automation.manage_automation_rules")))


class AutomationDashboardAPIView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        config = AutomationConfig.current()
        today = timezone.localdate()
        invoice_base = Invoice.objects.all()
        reminder_base = invoice_base.exclude(status__in=("PAID", "REJECTED")).filter(is_duplicate=False)
        activity_outcomes = [choice[0] for choice in AutomationRule.OUTCOME_CHOICES]
        recent = AutomationActivity.objects.select_related("invoice", "invoice__vendor", "rule")[:30]
        return Response({
            "summary": {
                "total_rules": AutomationRule.objects.count(),
                "active_rules": AutomationRule.objects.filter(is_active=True).count(),
                "inactive_rules": AutomationRule.objects.filter(is_active=False).count(),
                "invoices_automatically_processed": AutomationActivity.objects.filter(
                    success=True, invoice__isnull=False, action__in=activity_outcomes
                ).values("invoice_id").distinct().count(),
                "invoices_awaiting_approval": invoice_base.filter(status="PENDING").count(),
                "upcoming_due_invoices": reminder_base.filter(due_date__gte=today, due_date__lte=today + timedelta(days=7)).count(),
                "overdue_invoices": reminder_base.filter(due_date__lt=today).count(),
                "exception_invoices": invoice_base.filter(status="EXCEPTION").count(),
                "unread_notifications": AutomationNotification.objects.filter(is_read=False).count(),
            },
            "config": AutomationConfigSerializer(config).data,
            "last_run": AutomationRunSerializer(AutomationRun.objects.first()).data if AutomationRun.objects.exists() else None,
            "recent_activity": AutomationActivitySerializer(recent, many=True).data,
        })


class AutomationRunAPIView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        run = run_automation(trigger="MANUAL", include_due_reminders=True)
        return Response(AutomationRunSerializer(run).data, status=status.HTTP_200_OK)


class AutomationConfigAPIView(APIView):
    permission_classes = [RuleManagementPermission]

    def get(self, request):
        return Response(AutomationConfigSerializer(AutomationConfig.current()).data)

    def patch(self, request):
        config = AutomationConfig.current()
        serializer = AutomationConfigSerializer(config, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class AutomationRuleViewSet(viewsets.ModelViewSet):
    queryset = AutomationRule.objects.all()
    serializer_class = AutomationRuleSerializer
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["name", "description", "rule_key"]
    ordering_fields = ["priority", "name", "created_at", "is_active"]
    ordering = ["-priority", "id"]

    def get_permissions(self):
        if self.action in {"list", "retrieve", "history"}:
            return [AllowAny()]
        return [RuleManagementPermission()]

    @action(detail=True, methods=["get"])
    def history(self, request, pk=None):
        rule = self.get_object()
        activities = rule.executions.select_related("invoice", "invoice__vendor").order_by("-created_at")[:100]
        return Response(AutomationActivitySerializer(activities, many=True).data)


class AutomationActivityViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = AutomationActivity.objects.select_related("invoice", "invoice__vendor", "rule", "run")
    serializer_class = AutomationActivitySerializer
    filter_backends = [filters.OrderingFilter]
    ordering_fields = ["created_at", "success", "result", "trigger"]
    ordering = ["-created_at"]


class AutomationNotificationViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = AutomationNotification.objects.select_related("invoice")
    serializer_class = AutomationNotificationSerializer
    filter_backends = [filters.OrderingFilter]
    ordering_fields = ["created_at", "is_read", "notification_type"]
    ordering = ["-created_at"]

    def get_queryset(self):
        queryset = super().get_queryset()
        notification_type = self.request.query_params.get("type")
        is_read = self.request.query_params.get("is_read")
        if notification_type:
            queryset = queryset.filter(notification_type=notification_type)
        if is_read in {"true", "false"}:
            queryset = queryset.filter(is_read=(is_read == "true"))
        return queryset

    @action(detail=True, methods=["post"], url_path="mark-read")
    def mark_read(self, request, pk=None):
        notification = self.get_object()
        if not notification.is_read:
            notification.is_read = True
            notification.save(update_fields=["is_read"])
        return Response(AutomationNotificationSerializer(notification).data)

    @action(detail=False, methods=["post"], url_path="mark-all-read")
    def mark_all_read(self, request):
        updated = self.get_queryset().filter(is_read=False).update(is_read=True)
        return Response({"updated_count": updated})


class AutomationRunHistoryViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = AutomationRun.objects.all()
    serializer_class = AutomationRunSerializer
    filter_backends = [filters.OrderingFilter]
    ordering_fields = ["started_at", "finished_at", "success"]
    ordering = ["-started_at"]

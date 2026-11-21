from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    AutomationActivityViewSet,
    AutomationConfigAPIView,
    AutomationDashboardAPIView,
    AutomationNotificationViewSet,
    AutomationRuleViewSet,
    AutomationRunAPIView,
    AutomationRunHistoryViewSet,
)

router = DefaultRouter()
router.register("rules", AutomationRuleViewSet, basename="automation-rule")
router.register("activity", AutomationActivityViewSet, basename="automation-activity")
router.register("notifications", AutomationNotificationViewSet, basename="automation-notification")
router.register("runs", AutomationRunHistoryViewSet, basename="automation-run-history")

urlpatterns = [
    path("dashboard/", AutomationDashboardAPIView.as_view(), name="automation-dashboard"),
    path("run/", AutomationRunAPIView.as_view(), name="automation-run"),
    path("config/", AutomationConfigAPIView.as_view(), name="automation-config"),
    path("", include(router.urls)),
]

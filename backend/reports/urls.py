from django.urls import path

from .views import ReportExportAPIView, ReportsAPIView

urlpatterns = [
    path("", ReportsAPIView.as_view(), name="reports-summary"),
    path("export/<str:report_type>.csv", ReportExportAPIView.as_view(), name="reports-export"),
]

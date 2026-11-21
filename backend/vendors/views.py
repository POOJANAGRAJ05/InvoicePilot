from django.db.models import Count, Q, Sum
from rest_framework import filters, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Vendor
from .serializers import VendorDetailSerializer, VendorListSerializer


class VendorViewSet(viewsets.ModelViewSet):
	queryset = Vendor.objects.all()
	filter_backends = [filters.SearchFilter, filters.OrderingFilter]
	search_fields = ["name", "vendor_code", "email", "phone_number", "tax_registration_number", "contact_person"]
	ordering_fields = ["name", "vendor_code", "status", "created_at"]
	ordering = ["name", "id"]

	def get_queryset(self):
		return Vendor.objects.annotate(
			invoice_count=Count("invoices", distinct=True),
			gross_invoiced_amount=Sum("invoices__total_amount"),
			unique_invoiced_amount=Sum("invoices__total_amount", filter=Q(invoices__is_duplicate=False)),
			total_invoiced_amount=Sum("invoices__total_amount"),
			outstanding_amount=Sum(
				"invoices__total_amount",
				filter=Q(
					invoices__status="APPROVED",
					invoices__validation_status="VALID",
					invoices__is_duplicate=False,
					invoices__payment__isnull=True,
				),
			),
			paid_amount=Sum("invoices__payment__amount"),
		).order_by("name", "id")

	def get_serializer_class(self):
		if self.action in {"retrieve", "create", "update", "partial_update"}:
			return VendorDetailSerializer
		return VendorListSerializer

	def perform_create(self, serializer):
		vendor = serializer.save()
		serializer.instance = self.get_queryset().get(pk=vendor.pk)

	@action(detail=True, methods=["post"])
	def activate(self, request, pk=None):
		vendor = self.get_object()
		vendor.status = "ACTIVE"
		vendor.save(update_fields=["status", "updated_at"])
		return Response(VendorDetailSerializer(vendor, context=self.get_serializer_context()).data)

	@action(detail=True, methods=["post"])
	def deactivate(self, request, pk=None):
		vendor = self.get_object()
		vendor.status = "INACTIVE"
		vendor.save(update_fields=["status", "updated_at"])
		return Response(VendorDetailSerializer(vendor, context=self.get_serializer_context()).data)

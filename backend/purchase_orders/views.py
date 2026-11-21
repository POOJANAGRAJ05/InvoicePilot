from django.db import IntegrityError, transaction
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from invoices.models import Invoice
from .models import InvoicePurchaseOrderMatch, PurchaseOrder
from .serializers import InvoicePurchaseOrderMatchSerializer, PurchaseOrderSerializer
from .services import PurchaseOrderMatchError, create_invoice_match


class PurchaseOrderViewSet(viewsets.ModelViewSet):
	queryset = PurchaseOrder.objects.select_related("vendor").prefetch_related("line_items").all()
	serializer_class = PurchaseOrderSerializer
	filter_backends = [filters.SearchFilter, filters.OrderingFilter]
	search_fields = ["po_number", "vendor__name", "vendor__vendor_code"]
	ordering_fields = ["po_number", "po_date", "expected_delivery_date", "status", "created_at"]
	ordering = ["-po_date", "-id"]

	def perform_create(self, serializer):
		try:
			with transaction.atomic():
				serializer.save()
		except IntegrityError as error:
			raise ValidationError({"po_number": "A purchase order with this number already exists."}) from error

	def perform_update(self, serializer):
		if serializer.instance.status != "DRAFT":
			raise ValidationError({"detail": "Only draft purchase orders can be edited."})
		try:
			with transaction.atomic():
				serializer.save()
		except IntegrityError as error:
			raise ValidationError({"po_number": "A purchase order with this number already exists."}) from error

	@action(detail=True, methods=["post"])
	def issue(self, request, pk=None):
		purchase_order = self.get_object()
		if purchase_order.status != "DRAFT":
			raise ValidationError({"detail": "Only draft purchase orders can be issued."})
		if not purchase_order.line_items.exists():
			raise ValidationError({"detail": "Add at least one line item before issuing the PO."})
		purchase_order.status = "ISSUED"
		purchase_order.save(update_fields=["status", "updated_at"])
		return Response(self.get_serializer(purchase_order).data)

	@action(detail=True, methods=["post"])
	def cancel(self, request, pk=None):
		purchase_order = self.get_object()
		reason = str(request.data.get("reason", "")).strip()
		if not reason:
			raise ValidationError({"reason": "A cancellation reason is required."})
		if purchase_order.status in {"CLOSED", "CANCELLED"}:
			raise ValidationError({"detail": f"A {purchase_order.status.lower()} purchase order cannot be cancelled."})
		purchase_order.status = "CANCELLED"
		purchase_order.cancellation_reason = reason
		purchase_order.save(update_fields=["status", "cancellation_reason", "updated_at"])
		return Response(self.get_serializer(purchase_order).data)

	@action(detail=True, methods=["post"], url_path="transition")
	def transition(self, request, pk=None):
		purchase_order = self.get_object()
		requested_status = str(request.data.get("status", "")).upper()
		allowed = {
			"ISSUED": {"PARTIALLY_RECEIVED", "RECEIVED"},
			"PARTIALLY_RECEIVED": {"RECEIVED"},
			"RECEIVED": {"CLOSED"},
		}
		if requested_status not in allowed.get(purchase_order.status, set()):
			raise ValidationError({"status": f"Cannot transition a {purchase_order.status} PO to {requested_status or 'an unspecified status'}."})
		purchase_order.status = requested_status
		purchase_order.save(update_fields=["status", "updated_at"])
		return Response(self.get_serializer(purchase_order).data)

	@action(detail=True, methods=["post"], url_path="match-invoice")
	def match_invoice(self, request, pk=None):
		purchase_order = self.get_object()
		invoice_id = request.data.get("invoice_id")
		if not invoice_id:
			raise ValidationError({"invoice_id": "Invoice ID is required."})
		try:
			match = create_invoice_match(
				invoice_id,
				purchase_order.pk,
				request.data.get("invoice_po_number"),
			)
		except (Invoice.DoesNotExist, PurchaseOrder.DoesNotExist) as error:
			raise ValidationError({"detail": "Invoice or purchase order was not found."}) from error
		except PurchaseOrderMatchError as error:
			raise ValidationError({"detail": str(error)}) from error
		except (TypeError, ValueError) as error:
			raise ValidationError({"invoice_id": "Invoice ID must be a valid integer."}) from error
		return Response(InvoicePurchaseOrderMatchSerializer(match).data, status=status.HTTP_201_CREATED)


class InvoiceMatchViewSet(viewsets.ReadOnlyModelViewSet):
	queryset = InvoicePurchaseOrderMatch.objects.select_related(
		"invoice", "purchase_order", "purchase_order__vendor"
	)
	serializer_class = InvoicePurchaseOrderMatchSerializer
	filter_backends = [filters.OrderingFilter]
	ordering_fields = ["created_at", "result"]
	ordering = ["-created_at"]

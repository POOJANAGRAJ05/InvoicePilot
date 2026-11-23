
import logging
from datetime import timedelta

from django.utils import timezone
from django.db import transaction
from django.db.models import Count, Q, Sum

from rest_framework import viewsets, status
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError

from approvals.services import WorkflowTransitionError, transition_invoice
from payments.models import Payment
from payments.permissions import PaymentRecordingPermission
from payments.serializers import PaymentHistorySerializer, PaymentInputSerializer
from payments.services import PaymentRecordingError, record_invoice_payment
from vendors.models import Vendor
from vendors.serializers import VendorListSerializer

from .models import Invoice, InvoiceLineItem
from .serializers import InvoiceSerializer
from .ocr import (
    extract_invoice_data,
    extract_invoice_line_items,
    extract_text_from_invoice,
)
from .permissions import ApprovalWorkflowPermission
from .validation import validate_invoice


logger = logging.getLogger(__name__)


class InvoiceViewSet(viewsets.ModelViewSet):

    queryset = Invoice.objects.select_related(
        "vendor", "payment"
    ).prefetch_related(
        "approval_history__performed_by",
        "po_matches__purchase_order",
    ).order_by("-created_at")

    serializer_class = InvoiceSerializer

    parser_classes = [MultiPartParser, FormParser, JSONParser]

    # Temporary access for local development
    permission_classes = [AllowAny]

    def get_permissions(self):
        if self.action in {
            "submit_for_approval",
            "approve",
            "reject",
            "resubmit",
        }:
            return [ApprovalWorkflowPermission()]

        if self.action == "record_payment":
            return [PaymentRecordingPermission()]

        return super().get_permissions()

    def _perform_workflow_action(self, request, action_name, reason=""):
        try:
            invoice = transition_invoice(
                self.get_object().pk,
                action_name,
                actor=request.user,
                reason=reason,
            )
        except WorkflowTransitionError as error:
            raise ValidationError({"detail": str(error)}) from error

        return Response(
            self.get_serializer(invoice).data,
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=["post"], url_path="submit-for-approval")
    def submit_for_approval(self, request, pk=None):
        return self._perform_workflow_action(request, "submitted")

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        return self._perform_workflow_action(request, "approved")

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        return self._perform_workflow_action(
            request,
            "rejected",
            request.data.get("reason", ""),
        )

    @action(detail=True, methods=["post"])
    def resubmit(self, request, pk=None):
        return self._perform_workflow_action(request, "resubmitted")

    @action(detail=True, methods=["get", "post"], url_path="vendor-link")
    def vendor_link(self, request, pk=None):
        invoice = self.get_object()

        if request.method == "GET":
            normalized = " ".join((invoice.vendor_name or "").split())
            candidates = Vendor.objects.none()

            if normalized:
                candidates = Vendor.objects.filter(
                    name__iexact=normalized
                ).order_by("name")

                if not candidates.exists():
                    candidates = Vendor.objects.filter(
                        name__icontains=normalized
                    ).order_by("name")

            candidates = candidates.annotate(
                invoice_count=Count("invoices", distinct=True),
                gross_invoiced_amount=Sum("invoices__total_amount"),
                unique_invoiced_amount=Sum(
                    "invoices__total_amount",
                    filter=Q(invoices__is_duplicate=False),
                ),
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
            )

            return Response({
                "linked_vendor": self.get_serializer(invoice).data.get(
                    "vendor_details"
                ),
                "candidates": VendorListSerializer(
                    candidates, many=True
                ).data,
                "automatic_linking": False,
            })

        vendor_id = request.data.get("vendor_id")

        try:
            vendor = Vendor.objects.get(pk=vendor_id)
        except (Vendor.DoesNotExist, TypeError, ValueError) as error:
            raise ValidationError(
                {"vendor_id": "Select an existing vendor."}
            ) from error

        invoice.vendor = vendor
        invoice.save(update_fields=["vendor"])

        return Response(self.get_serializer(invoice).data)

    @action(detail=True, methods=["post"], url_path="record-payment")
    def record_payment(self, request, pk=None):
        payment_serializer = PaymentInputSerializer(data=request.data)
        payment_serializer.is_valid(raise_exception=True)

        try:
            invoice, payment = record_invoice_payment(
                self.get_object().pk,
                payment_serializer.validated_data,
                actor=request.user,
            )
        except PaymentRecordingError as error:
            raise ValidationError({"detail": str(error)}) from error

        response_data = self.get_serializer(invoice).data

        response_data["recorded_payment"] = PaymentHistorySerializer(
            payment,
            context=self.get_serializer_context(),
        ).data

        return Response(
            response_data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=False, methods=["get"], url_path="payment-summary")
    def payment_summary(self, request):
        approved_invoices = Invoice.objects.filter(
            status="APPROVED",
            is_duplicate=False,
            validation_status="VALID",
        )

        paid_amount = Payment.objects.aggregate(
            total=Sum("amount")
        )["total"] or 0

        outstanding_amount = approved_invoices.aggregate(
            total=Sum("total_amount")
        )["total"] or 0

        return Response({
            "total_amount_paid": paid_amount,
            "paid_invoice_count": Invoice.objects.filter(
                status="PAID"
            ).count(),
            "approved_unpaid_outstanding": outstanding_amount,
            "approved_unpaid_count": approved_invoices.count(),
        })

    # --------------------------------------------------
    # INVOICE AGING & OVERDUE SUMMARY
    # --------------------------------------------------
        # --------------------------------------------------
    # INVOICE AGING & OVERDUE SUMMARY
    # --------------------------------------------------
    @action(detail=False, methods=["get"], url_path="aging-summary")
    def aging_summary(self, request):
        today = timezone.localdate()

        # Include approved and exception invoices.
        # EXCEPTION invoices must not disappear from the aging tracker.
        unpaid = Invoice.objects.filter(
            status__in=["APPROVED", "EXCEPTION"],
            is_duplicate=False,
            payment__isnull=True,
        ).exclude(
            due_date__isnull=True
        )

        # Overdue invoices: due date is before today
        overdue = unpaid.filter(
            due_date__lt=today
        )

        # Due soon: today through the next 7 days
        due_soon = unpaid.filter(
            due_date__gte=today,
            due_date__lte=today + timedelta(days=7),
        )

        # Aging buckets
        aging = {
            "0_30_days": 0,
            "31_60_days": 0,
            "61_90_days": 0,
            "90_plus_days": 0,
        }

        for invoice in overdue:
            days_overdue = (today - invoice.due_date).days
            amount = float(invoice.total_amount or 0)

            if days_overdue <= 30:
                aging["0_30_days"] += amount
            elif days_overdue <= 60:
                aging["31_60_days"] += amount
            elif days_overdue <= 90:
                aging["61_90_days"] += amount
            else:
                aging["90_plus_days"] += amount

        total_outstanding = unpaid.aggregate(
            total=Sum("total_amount")
        )["total"] or 0

        overdue_amount = overdue.aggregate(
            total=Sum("total_amount")
        )["total"] or 0

        due_soon_amount = due_soon.aggregate(
            total=Sum("total_amount")
        )["total"] or 0

        return Response({
            "total_outstanding": float(total_outstanding),
            "overdue_amount": float(overdue_amount),
            "due_soon_amount": float(due_soon_amount),
            "overdue_invoice_count": overdue.count(),
            "due_soon_invoice_count": due_soon.count(),
            "aging_buckets": aging,
        })

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # Save first so an OCR/Tesseract failure never discards
        # the original upload.
        invoice = serializer.save()

        try:
            with invoice.invoice_file.open("rb") as uploaded_file:
                extracted_text = extract_text_from_invoice(uploaded_file)

            extracted_data = extract_invoice_data(extracted_text)

            if not any(
                value is not None for value in extracted_data.values()
            ):
                raise ValueError(
                    "No invoice fields could be identified in the OCR text"
                )

            # Save extracted invoice header fields.
            for field, value in extracted_data.items():
                if value is not None:
                    setattr(invoice, field, value)

            invoice.ocr_status = "completed"
            invoice.ocr_error = ""

            invoice.save(
                update_fields=[
                    *extracted_data.keys(),
                    "ocr_status",
                    "ocr_error",
                ]
            )

            # ---------------------------------------------
            # Extract and save invoice line items
            # ---------------------------------------------
            try:
                extracted_items = extract_invoice_line_items(
                    extracted_text
                )

                # Remove previous OCR-generated items to prevent duplicates
                invoice.line_items.all().delete()

                line_items_to_create = []

                for item in extracted_items:
                    line_items_to_create.append(
                        InvoiceLineItem(
                            invoice=invoice,
                            product_code=item.get("product_code", ""),
                            description=item.get("description", ""),
                            quantity=item.get("quantity", 1),
                            unit_price=item.get("unit_price", 0),
                            line_total=item.get("line_total", 0),
                            tax_amount=item.get("tax_amount"),
                        )
                    )

                if line_items_to_create:
                    InvoiceLineItem.objects.bulk_create(
                        line_items_to_create
                    )

                logger.info(
                    "Extracted %s line items for invoice %s",
                    len(line_items_to_create),
                    invoice.pk,
                )

            except Exception:
                # Line-item failure should not fail header OCR.
                logger.exception(
                    "Line-item extraction failed for invoice %s",
                    invoice.pk,
                )

            # Run invoice validation.
            validate_invoice(invoice)

            ocr_status = "completed"
            ocr_error = None

        except Exception:
            logger.exception(
                "OCR processing failed for invoice %s",
                invoice.pk,
            )

            invoice.status = "EXCEPTION"
            invoice.ocr_status = "failed"

            ocr_status = "failed"

            ocr_error = (
                "The invoice was uploaded, but OCR could not extract "
                "its details. The original file is saved for review."
            )

            invoice.ocr_error = ocr_error

            invoice.save(
                update_fields=["ocr_status", "ocr_error"]
            )

            validate_invoice(invoice)

        response_data = self.get_serializer(invoice).data

        response_data["ocr_status"] = ocr_status
        response_data["ocr_error"] = ocr_error

        return Response(
            response_data,
            status=status.HTTP_201_CREATED,
        )

    # --------------------------------------------------
    # DELETE ALL INVOICES
    # --------------------------------------------------
    @action(
        detail=False,
        methods=["delete"],
        url_path="delete-all",
    )
    def delete_all(self, request):
        with transaction.atomic():
            invoices = Invoice.objects.all()
            invoice_count = invoices.count()

            invoices.delete()

        return Response(
            {
                "message": f"{invoice_count} invoices deleted successfully.",
                "deleted_count": invoice_count,
            },
            status=status.HTTP_200_OK,
        )

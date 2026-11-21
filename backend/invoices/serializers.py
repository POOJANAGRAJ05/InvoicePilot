
from rest_framework import serializers
from approvals.models import ApprovalHistory
from payments.models import Payment
from payments.serializers import PaymentHistorySerializer
from purchase_orders.models import InvoicePurchaseOrderMatch
from purchase_orders.serializers import InvoicePurchaseOrderMatchSerializer
from .models import Invoice, InvoiceLineItem
from .validation import revalidate_duplicate_group, validate_invoice


class InvoiceLineItemSerializer(serializers.ModelSerializer):

    class Meta:
        model = InvoiceLineItem
        fields = (
            "id",
            "product_code",
            "description",
            "quantity",
            "unit_price",
            "line_total",
            "tax_amount",
            "created_at",
        )
        read_only_fields = fields


class ApprovalHistorySerializer(serializers.ModelSerializer):
    performed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = ApprovalHistory
        fields = (
            "id",
            "previous_status",
            "new_status",
            "action",
            "performed_by_name",
            "timestamp",
            "rejection_reason",
        )
        read_only_fields = fields

    def get_performed_by_name(self, history):
        user = history.performed_by
        if not user:
            return None
        return user.get_full_name() or user.get_username()


class InvoiceSerializer(serializers.ModelSerializer):
    approval_history = ApprovalHistorySerializer(many=True, read_only=True)
    payment_history = serializers.SerializerMethodField()
    vendor_details = serializers.SerializerMethodField()
    latest_po_match = serializers.SerializerMethodField()
    line_items = InvoiceLineItemSerializer(many=True, read_only=True)

    class Meta:
        model = Invoice
        fields = "__all__"
        read_only_fields = (
            "validation_status",
            "validation_errors",
            "is_duplicate",
            "duplicate_of",
            "status",
            "rejection_reason",
            "rejected_at",
            "approval_history",
            "payment_history",
            "vendor_details",
            "latest_po_match",
            "line_items",
        )

    def create(self, validated_data):
        invoice = super().create(validated_data)
        validate_invoice(invoice)
        return invoice

    def update(self, instance, validated_data):
        if instance.status == "APPROVED":
            raise serializers.ValidationError(
                {"detail": "Approved invoices cannot be edited."}
            )

        if instance.status == "PAID":
            raise serializers.ValidationError(
                {"detail": "Paid invoices cannot be edited."}
            )

        old_identity = (instance.vendor_name, instance.invoice_number)

        invoice = super().update(instance, validated_data)

        new_identity = (invoice.vendor_name, invoice.invoice_number)

        if old_identity != new_identity:
            revalidate_duplicate_group(*old_identity)
            revalidate_duplicate_group(*new_identity)

        validate_invoice(invoice)
        return invoice

    def get_payment_history(self, invoice):
        try:
            payment = invoice.payment
        except Payment.DoesNotExist:
            return []

        return [
            PaymentHistorySerializer(
                payment,
                context=self.context,
            ).data
        ]

    def get_vendor_details(self, invoice):
        vendor = invoice.vendor

        if not vendor:
            return None

        return {
            "id": vendor.pk,
            "name": vendor.name,
            "vendor_code": vendor.vendor_code,
            "status": vendor.status,
        }

    def get_latest_po_match(self, invoice):
        matches = list(invoice.po_matches.all())
        match = matches[0] if matches else None

        if not match:
            return None

        return InvoicePurchaseOrderMatchSerializer(
            match,
            context=self.context,
        ).data

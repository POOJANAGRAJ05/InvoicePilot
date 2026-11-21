from rest_framework import serializers

from invoices.models import Invoice
from .models import Vendor


class VendorListSerializer(serializers.ModelSerializer):
    invoice_count = serializers.IntegerField(read_only=True)
    gross_invoiced_amount = serializers.DecimalField(max_digits=16, decimal_places=2, read_only=True, allow_null=True)
    unique_invoiced_amount = serializers.DecimalField(max_digits=16, decimal_places=2, read_only=True, allow_null=True)
    total_invoiced_amount = serializers.DecimalField(max_digits=16, decimal_places=2, read_only=True)
    outstanding_amount = serializers.DecimalField(max_digits=16, decimal_places=2, read_only=True, allow_null=True)
    paid_amount = serializers.DecimalField(max_digits=16, decimal_places=2, read_only=True, allow_null=True)

    class Meta:
        model = Vendor
        fields = (
            "id", "name", "vendor_code", "email", "phone_number",
            "tax_registration_number", "contact_person", "payment_terms",
            "status", "created_at", "updated_at", "invoice_count",
            "gross_invoiced_amount", "unique_invoiced_amount", "total_invoiced_amount",
            "outstanding_amount", "paid_amount",
        )
        read_only_fields = ("created_at", "updated_at", "invoice_count", "total_invoiced_amount", "outstanding_amount", "paid_amount")

    def validate_name(self, value):
        normalized = Vendor.normalize_name(value)
        tax_value = self.initial_data.get(
            "tax_registration_number",
            self.instance.tax_registration_number if self.instance else "",
        )
        tax_id = Vendor.normalize_tax_id(tax_value)
        matches = Vendor.objects.all()
        if self.instance:
            matches = matches.exclude(pk=self.instance.pk)
        for existing in matches:
            if Vendor.normalize_name(existing.name) != normalized:
                continue
            existing_tax_id = Vendor.normalize_tax_id(existing.tax_registration_number)
            if not tax_id or not existing_tax_id or tax_id == existing_tax_id:
                raise serializers.ValidationError("A vendor with this normalized name and GSTIN identity already exists.")
        return " ".join(value.split())

    def validate_vendor_code(self, value):
        normalized = value.strip().upper()
        matches = Vendor.objects.filter(vendor_code__iexact=normalized)
        if self.instance:
            matches = matches.exclude(pk=self.instance.pk)
        if matches.exists():
            raise serializers.ValidationError("A vendor with this vendor code already exists.")
        return normalized

    def validate_tax_registration_number(self, value):
        normalized = Vendor.normalize_tax_id(value)
        if not normalized:
            return None
        matches = Vendor.objects.exclude(tax_registration_number="").filter(tax_registration_number__iexact=normalized)
        if self.instance:
            matches = matches.exclude(pk=self.instance.pk)
        if matches.exists():
            raise serializers.ValidationError("A vendor with this tax registration number already exists.")
        return normalized


class VendorDetailSerializer(VendorListSerializer):
    invoices = serializers.SerializerMethodField()

    class Meta(VendorListSerializer.Meta):
        fields = VendorListSerializer.Meta.fields + (
            "address", "bank_name", "account_holder_name",
            "bank_account_number", "ifsc_code", "invoices",
        )

    def get_invoices(self, vendor):
        invoices = Invoice.objects.filter(vendor=vendor).order_by("-created_at")
        return [{
            "id": invoice.pk,
            "invoice_number": invoice.invoice_number or "",
            "invoice_date": invoice.invoice_date,
            "total_amount": invoice.total_amount,
            "status": invoice.status,
            "is_duplicate": invoice.is_duplicate,
        } for invoice in invoices]

from django.db import transaction
from rest_framework import serializers
from .models import InvoicePurchaseOrderMatch, PurchaseOrder, PurchaseOrderLineItem


class PurchaseOrderLineItemSerializer(serializers.ModelSerializer):
    subtotal = serializers.DecimalField(max_digits=16, decimal_places=2, read_only=True)
    tax_amount = serializers.DecimalField(max_digits=16, decimal_places=2, read_only=True)
    total = serializers.DecimalField(max_digits=16, decimal_places=2, read_only=True)

    class Meta:
        model = PurchaseOrderLineItem
        fields = ("id", "description", "quantity", "unit_price", "tax_rate", "subtotal", "tax_amount", "total")
        read_only_fields = ("id", "subtotal", "tax_amount", "total")

    def validate_description(self, value):
        if not value.strip():
            raise serializers.ValidationError("Item description is required.")
        return value.strip()

    def validate_quantity(self, value):
        if value <= 0:
            raise serializers.ValidationError("Quantity must be greater than zero.")
        return value

    def validate_unit_price(self, value):
        if value < 0:
            raise serializers.ValidationError("Unit price cannot be negative.")
        return value

    def validate_tax_rate(self, value):
        if value < 0 or value > 100:
            raise serializers.ValidationError("Tax rate must be between 0 and 100 percent.")
        return value


class PurchaseOrderSerializer(serializers.ModelSerializer):
    vendor_name = serializers.CharField(source="vendor.name", read_only=True)
    vendor_code = serializers.CharField(source="vendor.vendor_code", read_only=True)
    line_items = PurchaseOrderLineItemSerializer(many=True)
    subtotal_amount = serializers.DecimalField(max_digits=16, decimal_places=2, read_only=True)
    tax_amount = serializers.DecimalField(max_digits=16, decimal_places=2, read_only=True)
    total_amount = serializers.DecimalField(max_digits=16, decimal_places=2, read_only=True)

    class Meta:
        model = PurchaseOrder
        fields = (
            "id", "po_number", "vendor", "vendor_name", "vendor_code", "po_date",
            "expected_delivery_date", "line_items", "subtotal_amount", "tax_amount",
            "total_amount", "notes", "status", "cancellation_reason", "created_at", "updated_at",
        )
        read_only_fields = ("id", "vendor_name", "vendor_code", "subtotal_amount", "tax_amount", "total_amount", "status", "cancellation_reason", "created_at", "updated_at")
        extra_kwargs = {"po_number": {"required": False, "allow_blank": True}}

    def validate_vendor(self, vendor):
        if vendor.status != "ACTIVE":
            raise serializers.ValidationError("Purchase orders can only be created for active vendors.")
        return vendor

    def validate_expected_delivery_date(self, value):
        po_date = self.initial_data.get("po_date")
        if value and po_date and value.isoformat() < str(po_date):
            raise serializers.ValidationError("Expected delivery date cannot be earlier than the PO date.")
        return value

    def validate_line_items(self, items):
        if not items:
            raise serializers.ValidationError("At least one line item is required.")
        return items

    def create(self, validated_data):
        items = validated_data.pop("line_items")
        with transaction.atomic():
            purchase_order = PurchaseOrder.objects.create(**validated_data)
            PurchaseOrderLineItem.objects.bulk_create([
                PurchaseOrderLineItem(purchase_order=purchase_order, **item)
                for item in items
            ])
        return purchase_order

    def update(self, instance, validated_data):
        if instance.status != "DRAFT":
            raise serializers.ValidationError({"detail": "Only draft purchase orders can be edited."})
        items = validated_data.pop("line_items", None)
        with transaction.atomic():
            for field, value in validated_data.items():
                setattr(instance, field, value)
            instance.save()
            if items is not None:
                instance.line_items.all().delete()
                PurchaseOrderLineItem.objects.bulk_create([
                    PurchaseOrderLineItem(purchase_order=instance, **item)
                    for item in items
                ])
        return instance


class InvoicePurchaseOrderMatchSerializer(serializers.ModelSerializer):
    purchase_order_number = serializers.CharField(source="purchase_order.po_number", read_only=True)

    class Meta:
        model = InvoicePurchaseOrderMatch
        fields = ("id", "invoice", "purchase_order", "purchase_order_number", "result", "explanations", "created_at")
        read_only_fields = fields

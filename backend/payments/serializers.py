from rest_framework import serializers

from .models import Payment


class PaymentInputSerializer(serializers.Serializer):
    amount = serializers.DecimalField(max_digits=12, decimal_places=2)
    payment_date = serializers.DateField()
    payment_method = serializers.ChoiceField(choices=Payment.PAYMENT_METHOD_CHOICES)
    reference_number = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")
    notes = serializers.CharField(required=False, allow_blank=True, default="")

    def validate_amount(self, amount):
        if amount <= 0:
            raise serializers.ValidationError("Payment amount must be greater than zero.")
        return amount


class PaymentHistorySerializer(serializers.ModelSerializer):
    payment_method_display = serializers.CharField(source="get_payment_method_display", read_only=True)
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Payment
        fields = (
            "id",
            "amount",
            "payment_date",
            "payment_method",
            "payment_method_display",
            "reference_number",
            "notes",
            "created_at",
            "created_by_name",
        )
        read_only_fields = fields

    def get_created_by_name(self, payment):
        user = payment.created_by
        if not user:
            return None
        return user.get_full_name() or user.get_username()

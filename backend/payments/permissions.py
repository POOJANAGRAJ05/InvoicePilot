from django.conf import settings
from rest_framework.permissions import BasePermission


class PaymentRecordingPermission(BasePermission):
    """Allow local testing; production users need payment permission or staff status."""

    message = "You do not have permission to record invoice payments."

    def has_permission(self, request, view):
        if settings.DEBUG:
            return True
        user = request.user
        return bool(
            user
            and user.is_authenticated
            and (
                user.is_staff
                or user.has_perm("payments.record_invoice_payment")
            )
        )

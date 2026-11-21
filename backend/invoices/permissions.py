from django.conf import settings
from rest_framework.permissions import BasePermission


class ApprovalWorkflowPermission(BasePermission):
    """Allow local development access; require login for workflow actions otherwise."""

    message = "Sign in to perform invoice approval workflow actions."

    def has_permission(self, request, view):
        if settings.DEBUG:
            return True
        user = request.user
        return bool(
            user
            and user.is_authenticated
            and (
                user.is_staff
                or user.has_perm("invoices.approve_invoice")
            )
        )

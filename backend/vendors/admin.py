from django.contrib import admin

from .models import Vendor


@admin.register(Vendor)
class VendorAdmin(admin.ModelAdmin):
	list_display = ("name", "vendor_code", "status", "tax_registration_number", "created_at")
	list_filter = ("status",)
	search_fields = ("name", "vendor_code", "tax_registration_number", "email")

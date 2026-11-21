from django.contrib import admin

from .models import InvoicePurchaseOrderMatch, PurchaseOrder, PurchaseOrderLineItem


class PurchaseOrderLineItemInline(admin.TabularInline):
	model = PurchaseOrderLineItem
	extra = 0


@admin.register(PurchaseOrder)
class PurchaseOrderAdmin(admin.ModelAdmin):
	list_display = ("po_number", "vendor", "po_date", "status", "created_at")
	list_filter = ("status", "po_date")
	search_fields = ("po_number", "vendor__name", "vendor__vendor_code")
	inlines = [PurchaseOrderLineItemInline]


@admin.register(InvoicePurchaseOrderMatch)
class InvoicePurchaseOrderMatchAdmin(admin.ModelAdmin):
	list_display = ("invoice", "purchase_order", "result", "created_at")
	list_filter = ("result", "created_at")
	readonly_fields = ("invoice", "purchase_order", "result", "explanations", "created_at")

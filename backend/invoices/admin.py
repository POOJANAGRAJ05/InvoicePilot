from django.contrib import admin
from .models import Invoice, InvoiceLineItem


class InvoiceLineItemInline(admin.TabularInline):
    model = InvoiceLineItem
    extra = 0


@admin.register(Invoice)
class InvoiceAdmin(admin.ModelAdmin):
    list_display = (
        "invoice_number",
        "vendor_name",
        "invoice_date",
        "due_date",
        "total_amount",
        "status",
    )

    list_filter = ("status", "validation_status", "is_duplicate")
    search_fields = ("invoice_number", "vendor_name")
    inlines = [InvoiceLineItemInline]


admin.site.register(InvoiceLineItem)

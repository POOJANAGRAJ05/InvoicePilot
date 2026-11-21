from rest_framework.routers import DefaultRouter

from .views import InvoiceMatchViewSet, PurchaseOrderViewSet

router = DefaultRouter()
router.register("purchase-orders", PurchaseOrderViewSet, basename="purchase-order")
router.register("po-matches", InvoiceMatchViewSet, basename="po-match")
urlpatterns = router.urls

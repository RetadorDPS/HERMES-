"""Esquemas Pydantic del microservicio: entrada y salida normalizada."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, HttpUrl


class ScrapeRequest(BaseModel):
    url: HttpUrl
    supplier: str | None = Field(default=None, description="ALIEXPRESS|AMAZON|CJ_DROPSHIPPING|...")
    country: str = "ES"
    proxy: str | None = None
    translate_to: str | None = None
    include_reviews: bool = True
    include_shipping: bool = True
    max_reviews: int = 40
    timeout_ms: int = 45_000


class Variant(BaseModel):
    supplierVariantId: str
    sku: str
    title: str
    color: str | None = None
    size: str | None = None
    material: str | None = None
    option1Name: str | None = None
    option1Value: str | None = None
    option2Name: str | None = None
    option2Value: str | None = None
    price: float
    compareAtPrice: float | None = None
    stock: int = 0
    imageUrl: str | None = None
    weightGrams: int | None = None


class ShippingOption(BaseModel):
    method: str
    carrier: str | None = None
    cost: float
    currency: str = "USD"
    minDays: int | None = None
    maxDays: int | None = None
    isTracked: bool = True
    destinationCountry: str | None = None


class Shipping(BaseModel):
    options: list[ShippingOption] = []
    cheapestCost: float = 0
    fastest: ShippingOption | None = None
    shipsTo: list[str] = []


class Review(BaseModel):
    supplierReviewId: str | None = None
    rating: int
    author: str | None = None
    authorCountry: str | None = None
    text: str | None = None
    date: str | None = None
    images: list[str] = []
    helpfulCount: int = 0
    variantSku: str | None = None


class ProductImage(BaseModel):
    url: str
    hdUrl: str | None = None
    alt: str | None = None


class ScrapeResponse(BaseModel):
    ok: bool = True
    data: "ScrapedPayload | None" = None
    error: str | None = None
    warnings: list[str] = []


class ScrapedPayload(BaseModel):
    sourceUrl: str
    supplier: str
    supplierProductId: str | None = None
    title: str
    seoTitle: str | None = None
    description: str = ""
    bullets: list[str] = []
    category: str | None = None
    categoryPath: list[str] = []
    tags: list[str] = []
    brand: str | None = None
    currency: str = "USD"
    images: list[ProductImage] = []
    variants: list[Variant] = []
    shipping: Shipping = Shipping()
    reviews: list[Review] = []
    ratingAvg: float = 0
    ratingCount: int = 0
    ordersCount: int = 0
    stockTotal: int = 0
    specs: dict[str, str] = {}
    warnings: list[str] = []
    extractionMeta: dict[str, Any] = {}


ScrapeResponse.model_rebuild()


class ProxyTestRequest(BaseModel):
    proxies: list[str] = Field(..., description="URLs http://user:pass@host:port a validar")
    target_url: str | None = Field(default="https://es.aliexpress.com/item/1005006123456789.html", description="URL del proveedor para comprobar bloqueos")
    ip_check_url: str = "https://api.ipify.org?format=json"
    timeout_ms: int = 25_000


class ProxyTestResult(BaseModel):
    proxy: str
    ok: bool
    status: str  # ok | blocked | error
    exitIp: str | None = None
    latencyMs: int = 0
    targetUrl: str | None = None
    error: str | None = None


class ProxyTestResponse(BaseModel):
    ok: bool
    tested: int
    working: int
    fastest: int | None = None
    results: list[ProxyTestResult] = []


class HealthResponse(BaseModel):
    status: str = "ok"
    browser_ready: bool
    proxies_configured: int
    active_jobs: int
    uptime_seconds: float
    version: str
    checked_at: datetime = Field(default_factory=datetime.utcnow)

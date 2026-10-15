"""Registro de extractores por proveedor."""
from __future__ import annotations

from typing import Awaitable, Callable

from playwright.async_api import Page

from models import ScrapedPayload
from . import aliexpress, amazon, cj, generic

ExtractorFn = Callable[..., Awaitable[ScrapedPayload]]

EXTRACTORS: dict[str, ExtractorFn] = {
    "ALIEXPRESS": aliexpress.extract,
    "AMAZON": amazon.extract,
    "CJ_DROPSHIPPING": cj.extract,
    # AliExpress y CJ comparten estructura suficiente para reutilizar extractores
    "ALIBABA": aliexpress.extract,
    "TEMU": aliexpress.extract,
    # Cualquier otra tienda (mayorista local, Shopify, WooCommerce, PrestaShop…)
    "GENERIC": generic.extract,
}

DOMAIN_MAP: list[tuple[str, str]] = [
    ("aliexpress.", "ALIEXPRESS"),
    ("amazon.", "AMAZON"),
    ("cjdropshipping.", "CJ_DROPSHIPPING"),
    ("alibaba.com", "ALIBABA"),
    ("1688.com", "ALIBABA"),
    ("temu.com", "TEMU"),
]


def detect_supplier(url: str) -> str | None:
    from urllib.parse import urlparse

    host = (urlparse(url).hostname or "").lower()
    for frag, key in DOMAIN_MAP:
        if frag in host:
            return key
    return None


def get_extractor(supplier: str | None, url: str) -> tuple[ExtractorFn, str]:
    """Devuelve el extractor adecuado. Nunca falla por proveedor desconocido:
    si la tienda no está en la lista, se usa el extractor GENÉRICO (datos
    estructurados: Shopify JSON, JSON-LD, OpenGraph y heurística de DOM)."""
    key = (supplier or detect_supplier(url) or "").upper()
    if key in EXTRACTORS:
        return EXTRACTORS[key], key
    return EXTRACTORS["GENERIC"], "GENERIC"

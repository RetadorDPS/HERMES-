"""Extractor GENÉRICO: cualquier tienda que no sea uno de los proveedores conocidos.

Idea: si el usuario pega la URL de un mayorista español, una tienda Shopify, una
WooCommerce, un PrestaShop o cualquier otra web con un producto, la plataforma
debe poder extraerlo. Nadie debería quedarse fuera porque su proveedor no esté
en una lista.

Estrategia, de la fuente más fiable a la menos:
  1. **Shopify JSON**  → cualquier tienda Shopify expone `/products/<handle>.json`
     (precio, comparativa, variantes, stock, imágenes, SKU: todo exacto).
  2. **JSON-LD schema.org/Product** → el estándar que usan WooCommerce, PrestaShop,
     Magento, Shopify… (nombre, precio, moneda, disponibilidad, valoración).
  3. **OpenGraph / microdata** → `og:title`, `og:image`, `product:price:amount`,
     `itemprop="price"`.
  4. **Heurística de DOM** → `h1`, primer precio con aspecto de precio, imágenes
     del bloque principal.

Regla de oro (igual que en el resto del producto): **no inventar**. Si no se
encuentra el precio, se devuelve 0 y se avisa en `warnings`; el usuario decide.
"""
from __future__ import annotations

import json
import re
from typing import Any
from urllib.parse import urljoin, urlparse

from playwright.async_api import Page

from models import ProductImage, Review, ScrapedPayload, Shipping, Variant
from .base import attr_of, parse_price, text_of

EXTRACTOR_VERSION = "generic-1.0"

_CURRENCY_SYMBOLS = {"€": "EUR", "$": "USD", "£": "GBP", "MXN": "MXN", "US$": "USD"}

IPV4_RE = re.compile(r"^\d{1,3}(\.\d{1,3}){3}$")

BLOCK_MARKERS = (
    "captcha",
    "are you a human",
    "access denied",
    "unusual traffic",
    "just a moment",
)


def _clean_title(value: str | None) -> str:
    return re.sub(r"\s+", " ", (value or "")).strip()


def _abs(url: str | None, base: str) -> str | None:
    if not url:
        return None
    if url.startswith("data:"):
        return None
    return urljoin(base, url)


def _currency_of(raw: str | None) -> str | None:
    if not raw:
        return None
    raw = raw.strip().upper()
    if len(raw) == 3 and raw.isalpha():
        return raw
    for symbol, code in _CURRENCY_SYMBOLS.items():
        if symbol in raw:
            return code
    return None


def _flatten_ld(node: Any) -> list[dict]:
    """Aplana @graph y listas en una lista de diccionarios."""
    out: list[dict] = []
    if isinstance(node, list):
        for item in node:
            out.extend(_flatten_ld(item))
    elif isinstance(node, dict):
        out.append(node)
        if "@graph" in node:
            out.extend(_flatten_ld(node["@graph"]))
        for key in ("itemListElement", "item", "offers", "mainEntity"):
            if key in node and isinstance(node[key], (dict, list)):
                out.extend(_flatten_ld(node[key]))
    return out


def _type_matches(node: dict, wanted: str) -> bool:
    t = node.get("@type") or node.get("type") or ""
    if isinstance(t, list):
        return any(wanted.lower() == str(x).lower() for x in t)
    return wanted.lower() == str(t).lower()


async def _shopify_json(page: Page, url: str) -> dict | None:
    """
    Cualquier tienda Shopify publica el producto en <url>.json. Es la fuente más
    exacta que existe sin usar su API privada (precio, variantes, stock, SKU).
    """
    path = urlparse(url).path
    if "/products/" not in path:
        return None
    handle = path.split("/products/")[-1].split("/")[0].split("?")[0]
    if not handle:
        return None
    candidate = f"{urlparse(url).scheme}://{urlparse(url).netloc}/products/{handle}.json"
    try:
        response = await page.request.get(candidate, timeout=15_000)
        if response.status != 200:
            return None
        data = await response.json()
    except Exception:
        return None
    product = (data or {}).get("product")
    return product if isinstance(product, dict) else None


def _from_shopify(product: dict, url: str, warnings: list[str]) -> ScrapedPayload:
    images: list[ProductImage] = []
    for img in product.get("images") or []:
        src = _abs(img.get("src"), url)
        if src:
            images.append(ProductImage(url=src, hdUrl=src, alt=img.get("alt")))

    variants: list[Variant] = []
    for i, v in enumerate(product.get("variants") or []):
        price = parse_price(v.get("price"))
        compare = parse_price(v.get("compare_at_price")) if v.get("compare_at_price") else None
        stock = v.get("inventory_quantity")
        variants.append(
            Variant(
                supplierVariantId=str(v.get("id") or f"gen-{i}"),
                sku=str(v.get("sku") or product.get("handle") or f"GEN-{i + 1}"),
                title=str(v.get("title") or f"Variante {i + 1}"),
                option1Name=v.get("option1") and "Opción 1" or None,
                option1Value=v.get("option1"),
                option2Name=v.get("option2") and "Opción 2" or None,
                option2Value=v.get("option2"),
                price=price,
                compareAtPrice=compare,
                stock=int(stock) if isinstance(stock, (int, float)) else 0,
                imageUrl=images[i % len(images)].url if images else None,
                weightGrams=int(v["grams"]) if isinstance(v.get("grams"), (int, float)) else None,
            )
        )

    tags = [t for t in (product.get("tags") or []) if isinstance(t, str)]
    return ScrapedPayload(
        sourceUrl=url,
        supplier="GENERIC",
        supplierProductId=str(product.get("id") or product.get("handle") or ""),
        title=_clean_title(product.get("title")) or "Producto",
        description=product.get("body_html") or "",
        category=product.get("product_type") or None,
        categoryPath=[product["product_type"]] if product.get("product_type") else [],
        tags=tags[:20],
        brand=product.get("vendor") or None,
        currency="EUR",
        images=images,
        variants=variants,
        shipping=Shipping(options=[], cheapestCost=0, shipsTo=[]),
        stockTotal=sum(v.stock for v in variants),
        warnings=warnings + ["Precio de envío del proveedor no publicado: se desconoce hasta confirmar el pedido"],
        extractionMeta={"strategy": "shopify-json", "extractor": EXTRACTOR_VERSION},
    )


async def extract(
    page: Page,
    url: str,
    *,
    include_reviews: bool = True,
    country: str = "ES",
    max_reviews: int = 40,
) -> ScrapedPayload:
    warnings: list[str] = [f"Extractor genérico ({EXTRACTOR_VERSION}) · tienda no reconocida: se usan datos estructurados de la página"]

    # ── 1. Shopify JSON ──────────────────────────────────────────────────────
    if (shopify := await _shopify_json(page, url)) is not None:
        return _from_shopify(shopify, url, warnings)

    html = await page.content()
    if any(marker in html.lower() for marker in BLOCK_MARKERS) and len(html) < 12_000:
        raise RuntimeError("GENERIC_BLOCKED: la tienda pidió verificación anti-bot")

    # ── 2. JSON-LD ───────────────────────────────────────────────────────────
    ld_blocks = await page.query_selector_all('script[type="application/ld+json"]')
    nodes: list[dict] = []
    for block in ld_blocks:
        try:
            raw = await block.inner_text()
            nodes.extend(_flatten_ld(json.loads(raw)))
        except Exception:
            continue

    product = next((n for n in nodes if _type_matches(n, "product")), None)
    used = "json-ld"
    currency_guess: str | None = None

    title = _clean_title((product or {}).get("name"))
    description = (product or {}).get("description") or ""
    brand = (product or {}).get("brand")
    if isinstance(brand, dict):
        brand = brand.get("name")
    category = (product or {}).get("category")
    sku = (product or {}).get("sku")
    images: list[ProductImage] = []

    for img in (product or {}).get("image") if isinstance((product or {}).get("image"), list) else [(product or {}).get("image")]:
        src = _abs(img.get("url") if isinstance(img, dict) else (img if isinstance(img, str) else None), url)
        if src:
            images.append(ProductImage(url=src, hdUrl=src))

    offers = (product or {}).get("offers")
    if isinstance(offers, list):
        offers = offers[0] if offers else None
    if isinstance(offers, dict) and isinstance(offers.get("offers"), list):
        offers = offers["offers"][0]

    price = parse_price((offers or {}).get("price") or (offers or {}).get("lowPrice"))
    compare = parse_price((offers or {}).get("highPrice")) if (offers or {}).get("highPrice") else None
    structured_currency = _currency_of((offers or {}).get("priceCurrency"))
    currency = structured_currency or "EUR"
    availability = str((offers or {}).get("availability") or "")
    in_stock = "outofstock" not in availability.lower() and "soldout" not in availability.lower()

    rating_avg = 0.0
    rating_count = 0
    agg = (product or {}).get("aggregateRating")
    if isinstance(agg, dict):
        try:
            rating_avg = float(agg.get("ratingValue") or 0)
            rating_count = int(float(agg.get("reviewCount") or agg.get("ratingCount") or 0))
        except Exception:
            pass

    reviews: list[Review] = []
    if include_reviews:
        for rv in ((product or {}).get("review") or [])[:max_reviews]:
            if not isinstance(rv, dict):
                continue
            try:
                reviews.append(
                    Review(
                        supplierReviewId=str(rv.get("identifier") or ""),
                        rating=int(float((rv.get("reviewRating") or {}).get("ratingValue") or 0)) or 5,
                        author=(rv.get("author") or {}).get("name") if isinstance(rv.get("author"), dict) else None,
                        text=rv.get("reviewBody"),
                        date=rv.get("datePublished"),
                    )
                )
            except Exception:
                continue

    # ── 3. OpenGraph / microdata (rellena huecos) ────────────────────────────
    if not title:
        used = "opengraph"
        title = _clean_title(await attr_of(page, ['meta[property="og:title"]', 'meta[name="twitter:title"]'], "content")) or _clean_title(await text_of(page, ["h1"]))
    if not description:
        description = await attr_of(page, ['meta[property="og:description"]', 'meta[name="description"]'], "content") or ""
    if not price:
        price = parse_price(
            await attr_of(page, ['meta[property="product:price:amount"]', 'meta[property="og:price:amount"]', 'meta[itemprop="price"]'], "content")
        )
        if not price:
            price = parse_price(await attr_of(page, ['[itemprop="price"]'], "content"))
    if not structured_currency:
        structured_currency = _currency_of(
            await attr_of(page, ['meta[property="product:price:currency"]', 'meta[property="og:price:currency"]'], "content")
        )
        if structured_currency:
            currency = structured_currency
    if not images:
        og_images = await page.eval_on_selector_all(
            'meta[property="og:image"], meta[name="twitter:image"]',
            "els => els.map(e => e.content).filter(Boolean)",
        )
        for src in og_images or []:
            if (abs_url := _abs(src, url)) and abs_url not in [i.url for i in images]:
                images.append(ProductImage(url=abs_url, hdUrl=abs_url))

    # ── 4. Heurística de DOM ─────────────────────────────────────────────────
    if not title:
        used = "dom-heuristic"
        title = _clean_title(await text_of(page, ["h1", "h1.product_title", ".product-title", "#title"]))
    if not images:
        for selector in (".woocommerce-product-gallery img", ".product-gallery img", "#product_gallery img", "main img", "article img"):
            urls = await page.eval_on_selector_all(selector, "els => els.map(e => e.currentSrc || e.src).filter(Boolean)")
            for src in (urls or [])[:8]:
                if (abs_url := _abs(src, url)) and not abs_url.startswith("data:"):
                    images.append(ProductImage(url=abs_url, hdUrl=abs_url))
            if images:
                break
    if not price:
        candidates = await page.eval_on_selector_all(
            ".price, .product-price, [class*=price]",
            "els => els.slice(0, 8).map(e => (e.textContent || '').trim()).filter(Boolean)",
        )
        for text in candidates or []:
            match = re.search(r"(\d{1,6}[.,]\d{2})", str(text))
            if match:
                price = parse_price(match.group(1))
                if price:
                    # La moneda suele venir en el MISMO texto que el precio («£51.77»)
                    currency_guess = _currency_of(str(text))
                    break
    if currency_guess:
        currency = currency_guess

    if not title:
        raise RuntimeError("GENERIC_PARSE_ERROR: no he podido encontrar ni el título del producto")

    if not price:
        warnings.append("No se ha encontrado el precio en la página (¿precio tras registro?): el producto se guardará con coste 0 y podrás corregirlo")
    elif not structured_currency:
        warnings.append(f"La tienda no publica la moneda del precio: se asume {currency}. Corrígelo antes de publicar si no coincide")
    if not images:
        warnings.append("No se han encontrado imágenes del producto en la página")
    warnings.append("Precio de envío del proveedor no publicado: se desconoce hasta confirmar el pedido")

    # variantes mínimas: la información del proveedor genérico no siempre existe
    variants = [
        Variant(
            supplierVariantId=str(sku or "default"),
            sku=str(sku or (urlparse(url).path.rstrip('/').split('/')[-1] or "GEN-1")),
            title="Único",
            price=price or 0,
            stock=50 if in_stock else 0,
            imageUrl=images[0].url if images else None,
        )
    ]

    return ScrapedPayload(
        sourceUrl=url,
        supplier="GENERIC",
        supplierProductId=str(sku or urlparse(url).path.rstrip("/").split("/")[-1] or ""),
        title=title,
        seoTitle=title[:70],
        description=description,
        category=category or None,
        categoryPath=[category] if category else [],
        brand=brand or None,
        currency=currency,
        images=images[:8],
        variants=variants,
        shipping=Shipping(options=[], cheapestCost=0, shipsTo=[]),
        reviews=reviews,
        ratingAvg=rating_avg,
        ratingCount=rating_count,
        stockTotal=variants[0].stock,
        specs={},
        warnings=warnings,
        extractionMeta={"strategy": used, "extractor": EXTRACTOR_VERSION, "structuredData": bool(nodes)},
    )

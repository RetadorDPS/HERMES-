"""Extractor de CJ Dropshipping.

CJ expone API pública (developers.cjdropshipping.com) que preferimos cuando hay
API key; si no, se cae al scraping DOM de la PDP.
"""
from __future__ import annotations

import os
import re
from typing import Any

import httpx
from playwright.async_api import Page

from models import ProductImage, Review, ScrapedPayload, Shipping, ShippingOption, Variant
from .base import all_attrs, detect_blocked, parse_price, text_of, to_hd, wait_any

SUPPLIER = "CJ_DROPSHIPPING"
EXTRACTOR_VERSION = "cj.hybrid_v1"
API_BASE = "https://developers.cjdropshipping.com/api2.0/v1"

SEL = {
    "title": ["h1.product-title", ".product-info h1", "h1"],
    "price": [".product-price", ".price-item", "[class*='price']"],
    "images": [".product-gallery img", ".swiper-slide img", "img[class*='product']"],
    "description": [".product-description", "#description"],
    "variants": [".sku-item", "[class*='variant-item']", "[class*='sku-']"],
    "reviews": [".review-item", "[class*='comment-item']"],
}


async def extract(page: Page, url: str, *, include_reviews: bool = True, country: str = "ES", max_reviews: int = 40) -> ScrapedPayload:
    warnings: list[str] = [f"Extractor CJ ({EXTRACTOR_VERSION})"]

    pid = _extract_pid(url)
    api_key = os.getenv("CJ_API_KEY")
    if pid and api_key:
        try:
            return await _from_api(pid, url, country, include_reviews, max_reviews, warnings, api_key)
        except Exception as exc:  # API caída o key inválida → fallback DOM
            warnings.append(f"API CJ no disponible ({exc}): usando DOM")

    html = await page.content()
    if detect_blocked(html):
        raise RuntimeError("CJ_BLOCKED: verificación anti-bot")

    await wait_any(page, SEL["title"], timeout_ms=12_000)
    title = await text_of(page, SEL["title"])
    if not title:
        raise RuntimeError("CJ_PARSE_ERROR: sin título")

    price = parse_price(await text_of(page, SEL["price"]))
    imgs = await all_attrs(page, SEL["images"], "src")
    images = [ProductImage(url=to_hd(u, SUPPLIER), hdUrl=to_hd(u, SUPPLIER)) for u in dict.fromkeys(imgs) if u and not u.startswith("data:")]

    variants: list[Variant] = []
    for i, el in enumerate((await page.query_selector_all(", ".join(SEL["variants"])))[:60]):
        try:
            label = (await el.inner_text()).strip().split("\n")[0]
            if not label:
                continue
            variants.append(
                Variant(
                    supplierVariantId=f"cj-dom-{i}",
                    sku=f"CJ-{pid or 'X'}-{i + 1}",
                    title=label,
                    option1Name="Variante",
                    option1Value=label,
                    price=price,
                    stock=0 if re.search(r"agotado|out of stock", label, re.I) else 50,
                    imageUrl=images[i % len(images)].url if images else None,
                )
            )
        except Exception:
            continue

    reviews: list[Review] = []
    if include_reviews:
        for el in (await page.query_selector_all(", ".join(SEL["reviews"])))[:max_reviews]:
            try:
                txt = (await el.inner_text()).strip()
                stars = int(re.search(r"(\d)\s*/\s*5", txt).group(1)) if re.search(r"(\d)\s*/\s*5", txt) else 5
                reviews.append(Review(rating=min(max(stars, 1), 5), text=txt[:600], images=[]))
            except Exception:
                continue

    warnings.append("Extracción DOM de CJ: revisa stock antes de publicar")

    return ScrapedPayload(
        sourceUrl=url,
        supplier=SUPPLIER,
        supplierProductId=pid,
        title=title,
        seoTitle=title[:70],
        description=await text_of(page, SEL["description"]) or "",
        images=images,
        variants=variants or [Variant(supplierVariantId="default", sku=f"CJ-{pid}", title="Estándar", price=price, stock=50)],
        shipping=Shipping(
            options=[
                ShippingOption(method="CJ Packet", carrier="CJPacket", cost=2.1, currency="USD", minDays=8, maxDays=15, isTracked=True, destinationCountry=country),
                ShippingOption(method="DHL", carrier="DHL", cost=9.5, currency="USD", minDays=4, maxDays=8, isTracked=True, destinationCountry=country),
            ],
            cheapestCost=2.1,
            shipsTo=[country, "US", "FR", "DE"],
        ),
        reviews=reviews,
        stockTotal=sum(v.stock for v in variants),
        warnings=warnings,
        extractionMeta={"extractorVersion": EXTRACTOR_VERSION, "strategy": "dom"},
    )


async def _from_api(
    pid: str,
    url: str,
    country: str,
    include_reviews: bool,
    max_reviews: int,
    warnings: list[str],
    api_key: str,
) -> ScrapedPayload:
    async with httpx.AsyncClient(timeout=25.0) as client:
        res = await client.get(f"{API_BASE}/product/query", params={"pid": pid}, headers={"CJ-Access-Token": api_key})
        res.raise_for_status()
        body = res.json()
        if not body.get("result"):
            raise RuntimeError(body.get("message", "producto no encontrado en API CJ"))
        p = body["data"]

    images = [
        ProductImage(url=to_hd(u, SUPPLIER), hdUrl=to_hd(u, SUPPLIER))
        for u in (p.get("productImageSet") or p.get("productImages") or [])
    ]
    variants: list[Variant] = []
    for v in p.get("variants", [])[:200]:
        variants.append(
            Variant(
                supplierVariantId=str(v.get("vid")),
                sku=v.get("variantSku") or f"CJ-{v.get('vid')}",
                title=v.get("variantNameEn") or v.get("variantKey") or "Variante",
                color=v.get("variantColor"),
                size=v.get("variantSize"),
                option1Name="Color",
                option1Value=v.get("variantColor") or v.get("variantKey") or "Estándar",
                option2Name="Talla" if v.get("variantSize") else None,
                option2Value=v.get("variantSize"),
                price=parse_price(v.get("variantSellPrice") or p.get("sellPrice")),
                stock=int(v.get("variantStandard") or 0) if str(v.get("variantStandard")).isdigit() else int(v.get("variantSellableStock") or 0),
                imageUrl=v.get("variantImage"),
                weightGrams=int(float(v.get("variantWeight") or 0) * 1000) or None,
            )
        )

    warnings.append("Datos obtenidos vía API oficial de CJ (sin scraping)")

    return ScrapedPayload(
        sourceUrl=url,
        supplier=SUPPLIER,
        supplierProductId=pid,
        title=p.get("productNameEn") or p.get("productName"),
        seoTitle=(p.get("productNameEn") or p.get("productName") or "")[:70],
        description=p.get("description") or "",
        category=p.get("categoryName"),
        categoryPath=[p.get("categoryName")] if p.get("categoryName") else [],
        tags=(p.get("productKeyEn") or "").split(","),
        brand=p.get("supplierName") or "CJ",
        currency="USD",
        images=images,
        variants=variants,
        shipping=Shipping(
            options=[
                ShippingOption(
                    method=p.get("shippingMethod") or "CJ Packet",
                    cost=parse_price(p.get("shippingPrice")),
                    currency="USD",
                    minDays=7,
                    maxDays=16,
                    isTracked=True,
                    destinationCountry=country,
                )
            ],
            cheapestCost=parse_price(p.get("shippingPrice")),
            shipsTo=[country, "US", "FR", "DE", "IT"],
        ),
        reviews=[],
        ratingAvg=0,
        ratingCount=0,
        stockTotal=sum(v.stock for v in variants),
        specs={"Peso": str(p.get("productWeight") or ""), "SKU padre": str(p.get("productSku") or "")},
        warnings=warnings,
        extractionMeta={"extractorVersion": EXTRACTOR_VERSION, "strategy": "official_api"},
    )


def _extract_pid(url: str) -> str | None:
    m = re.search(r"[?&]pid=([A-Za-z0-9-]+)", url) or re.search(r"product/([A-Za-z0-9-]+)", url)
    return m.group(1) if m else None

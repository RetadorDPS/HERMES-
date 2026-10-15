"""Extractor de AliExpress (PDP v2).

Funciona en dos capas:
  1. Payload embebido `window._dida_config_._init_data_.data` → datos completos
     (variantes, stock por SKU, envío por país, reseñas) sin tocar el DOM.
  2. Fallback DOM (selectores de la PDP internacional / ES).
"""
from __future__ import annotations

import asyncio
import re
from typing import Any

from playwright.async_api import Page

from models import ProductImage, Review, ScrapedPayload, Shipping, ShippingOption, Variant
from .base import all_attrs, attr_of, click_all, detect_blocked, eval_json, parse_price, text_of, to_hd, wait_any

SUPPLIER = "ALIEXPRESS"
EXTRACTOR_VERSION = "aliexpress.pdp_v2"

INIT_DATA_JS = "JSON.stringify(window._dida_config_?._init_data_?.data ?? null)"

DOM_SELECTORS = {
    "title": ["h1[data-pl='product-title']", ".product-title-text", "h1.product-title", "h1"],
    "price": [".product-price-value", "[class*='price--currentPriceText']", ".es--wrap--Ms9Zv"],
    "images": ["[class*='image-viewer'] img", ".magnifier-image", "img[class*='pdp']"],
    "description": ["[class*='detail-desc']", ".product-description"],
}


async def extract(page: Page, url: str, *, include_reviews: bool = True, country: str = "ES", max_reviews: int = 40) -> ScrapedPayload:
    warnings: list[str] = ["Extractor AliExpress PDP v2"]
    html = await page.content()
    if detect_blocked(html):
        raise RuntimeError("ALIEXPRESS_BLOCKED: captcha o verificación anti-bot")

    init_data = await eval_json(page, INIT_DATA_JS)

    if init_data:
        payload = _from_init_data(init_data, url, country, include_reviews, max_reviews, warnings)
        if payload and payload.variants:
            return payload
        warnings.append("Payload _dida_config_ incompleto: usando fallback DOM")

    payload = await _from_dom(page, url, country, include_reviews, max_reviews, warnings)
    if payload:
        return payload

    raise RuntimeError("ALIEXPRESS_PARSE_ERROR: no se pudo extraer el producto ni por payload ni por DOM")


def _from_init_data(
    data: dict[str, Any],
    url: str,
    country: str,
    include_reviews: bool,
    max_reviews: int,
    warnings: list[str],
) -> ScrapedPayload | None:
    module = data.get("data", data)
    product = module.get("productInfoComponent") or module.get("productInfo") or module
    title = product.get("subject") or product.get("title")
    if not title:
        return None

    product_id = str(product.get("productId") or product.get("id") or "")

    # ── Precio base
    price_module = product.get("priceComponent", {}) or {}
    currency = price_module.get("currencyCode") or product.get("currencyCode", "USD")
    min_price = parse_price(
        price_module.get("minActivityAmount", {}).get("value")
        or price_module.get("minAmount", {}).get("value")
        or 0
    )
    max_price = parse_price(price_module.get("maxAmount", {}).get("value") or min_price)

    # ── Variantes (SKU)
    sku_module = product.get("skuComponent", {}) or {}
    sku_props = sku_module.get("productSKUPropertyList", []) or sku_module.get("skuProperties", [])
    prop_name_by_id: dict[str, str] = {}
    prop_values: dict[str, list[dict]] = {}
    for prop in sku_props:
        pid = str(prop.get("skuPropertyId"))
        prop_name_by_id[pid] = prop.get("skuPropertyName") or "Opción"
        prop_values[pid] = prop.get("skuPropertyValues", [])

    variants: list[Variant] = []
    for sku in sku_module.get("skuPriceList", []) or sku_module.get("skuList", []):
        price = parse_price(sku.get("skuActivityAmount", {}).get("value") or sku.get("skuAmount", {}).get("value") or min_price)
        prop_path = [p.strip() for p in str(sku.get("skuPropIds", "")).split(",") if p.strip()]
        labels: list[str] = []
        images: list[str] = []
        color = size = None
        opt1_name = opt1_val = opt2_name = opt2_val = None
        for idx, pid in enumerate(prop_path):
            name = prop_name_by_id.get(pid, f"Opción {idx + 1}")
            value = next((v for v in prop_values.get(pid, []) if str(v.get("propertyValueId")) == pid), None)
            label = (value or {}).get("propertyValueDisplayName") or (value or {}).get("propertyValueName") or pid
            img = (value or {}).get("skuPropertyImagePath")
            if img:
                images.append(to_hd(img, SUPPLIER))
            labels.append(label)
            low = name.lower()
            if "color" in low or "colour" in low:
                color = label
            elif "size" in low or "talla" in low or "尺寸" in name:
                size = label
            elif "material" in low:
                pass
            if idx == 0:
                opt1_name, opt1_val = name, label
            elif idx == 1:
                opt2_name, opt2_val = name, label

        variants.append(
            Variant(
                supplierVariantId=str(sku.get("skuId") or sku.get("skuIdStr") or len(variants)),
                sku=str(sku.get("skuCode") or sku.get("skuId") or f"AE-{product_id}-{len(variants) + 1}"),
                title=" / ".join(labels) or "Estándar",
                color=color,
                size=size,
                option1Name=opt1_name or "Opción",
                option1Value=opt1_val or "Estándar",
                option2Name=opt2_name,
                option2Value=opt2_val,
                price=price,
                compareAtPrice=max_price if max_price > price else None,
                stock=int(sku.get("skuVal", {}).get("inventory") or sku.get("inventory") or 0),
                imageUrl=images[0] if images else None,
            )
        )

    # ── Imágenes
    gallery = product.get("imageComponent", {}).get("imagePathList") or product.get("imageList") or []
    images = [ProductImage(url=to_hd(u, SUPPLIER), hdUrl=to_hd(u, SUPPLIER)) for u in gallery if u]

    # ── Envío por país
    shipping_options: list[ShippingOption] = []
    freight = product.get("freightComponent") or product.get("webGeneralFreightCalculateComponent") or {}
    for opt in (freight.get("freightResult") or freight.get("freightList") or [])[:10]:
        amount = opt.get("freightAmount") or {}
        shipping_options.append(
            ShippingOption(
                method=opt.get("serviceName") or opt.get("company") or "Envío estándar",
                carrier=opt.get("company") or opt.get("deliveryProviderCode"),
                cost=parse_price(amount.get("value") or opt.get("freightAmountValue") or 0),
                currency=amount.get("currency") or currency,
                minDays=int(opt.get("deliveryDayMin") or opt.get("minDeliveryDays") or 0) or None,
                maxDays=int(opt.get("deliveryDayMax") or opt.get("maxDeliveryDays") or 0) or None,
                isTracked=bool(opt.get("tracking", True)),
                destinationCountry=country,
            )
        )
    if not shipping_options:
        warnings.append(f"Sin cotizaciones de envío para {country}: se usará tarifa estimada")

    # ── Reseñas
    reviews: list[Review] = []
    if include_reviews:
        review_module = product.get("feedbackComponent") or {}
        for r in (review_module.get("evaViewList") or [])[:max_reviews]:
            reviews.append(
                Review(
                    supplierReviewId=str(r.get("id") or ""),
                    rating=int(r.get("evaStarRating") or 5),
                    author=r.get("buyerName") or "Anónimo",
                    authorCountry=r.get("buyerCountry"),
                    text=r.get("buyerFeedback") or r.get("reviewContent"),
                    date=r.get("evaDate"),
                    images=[i.get("url") if isinstance(i, dict) else str(i) for i in (r.get("images") or [])],
                    helpfulCount=int(r.get("upVoteCount") or 0),
                    variantSku=r.get("skuInfo"),
                )
            )
        if not reviews:
            warnings.append("Payload sin reseñas embebidas: se intentará DOM si include_reviews=True")

    specs = {}
    for prop in (product.get("specsModule", {}) or {}).get("props", []) or []:
        if prop.get("name") and prop.get("value"):
            specs[str(prop["name"])] = str(prop["value"])

    rating = module.get("titleComponent", {}).get("feedbackRating") or {}
    stock_total = sum(v.stock for v in variants)

    return ScrapedPayload(
        sourceUrl=url,
        supplier=SUPPLIER,
        supplierProductId=product_id,
        title=title,
        seoTitle=title[:70],
        description=(product.get("descriptionModule") or {}).get("description") or product.get("description") or "",
        bullets=[],
        category=(product.get("categoryComponent") or {}).get("categoryName") or product.get("categoryName"),
        categoryPath=(product.get("categoryComponent") or {}).get("categoryPath") or [],
        tags=(product.get("keywords") or "").split(",")[:20] if product.get("keywords") else [],
        brand=product.get("brandName"),
        currency=currency,
        images=images,
        variants=variants,
        shipping=Shipping(
            options=shipping_options,
            cheapestCost=min([s.cost for s in shipping_options], default=0.0),
            fastest=min(
                [s for s in shipping_options if s.isTracked], key=lambda s: s.maxDays or 99, default=None
            ),
            shipsTo=["ES", "FR", "DE", "IT", "PT", "US", "MX", "GB"],
        ),
        reviews=reviews,
        ratingAvg=float(rating.get("averageStar") or rating.get("averageStarRate") or 0),
        ratingCount=int(rating.get("totalValidNum") or rating.get("totalNum") or 0),
        ordersCount=int((product.get("titleComponent") or {}).get("tradeCount") or 0),
        stockTotal=stock_total,
        specs=specs,
        warnings=warnings,
        extractionMeta={"extractorVersion": EXTRACTOR_VERSION, "strategy": "embedded_init_data"},
    )


async def _from_dom(
    page: Page,
    url: str,
    country: str,
    include_reviews: bool,
    max_reviews: int,
    warnings: list[str],
) -> ScrapedPayload | None:
    await wait_any(page, DOM_SELECTORS["title"], timeout_ms=12_000)
    title = await text_of(page, DOM_SELECTORS["title"])
    if not title:
        return None

    price_raw = await text_of(page, DOM_SELECTORS["price"])
    price = parse_price(price_raw)

    img_urls = await all_attrs(page, DOM_SELECTORS["images"], "src")
    img_urls += await all_attrs(page, ["[class*='image-viewer'] img"], "data-src")
    seen: set[str] = set()
    images: list[ProductImage] = []
    for u in img_urls:
        if not u or u.startswith("data:") or u in seen:
            continue
        seen.add(u)
        hd = to_hd(u, SUPPLIER)
        images.append(ProductImage(url=hd, hdUrl=hd))

    # Variantes visibles (no siempre reflejan stock real → se marca en warnings)
    variants: list[Variant] = []
    for el in (await page.query_selector_all("[class*='sku-item'], [class*='SkuProperty']"))[:80]:
        try:
            label = (await el.inner_text()).strip().split("\n")[0]
            if not label:
                continue
            variants.append(
                Variant(
                    supplierVariantId=f"dom-{len(variants)}",
                    sku=f"AE-DOM-{len(variants) + 1}",
                    title=label,
                    option1Name="Opción",
                    option1Value=label,
                    price=price,
                    stock=0 if "agotado" in (await el.inner_text()).lower() or "sold out" in (await el.inner_text()).lower() else 99,
                )
            )
        except Exception:
            continue

    reviews: list[Review] = []
    if include_reviews:
        await click_all(page, ["[class*='review'] button", "button:has-text('Ver más')", "button:has-text('View more')"])
        for el in (await page.query_selector_all("[class*='review-item'], [class*='feedback-item']"))[:max_reviews]:
            try:
                txt = (await el.inner_text()).strip()
                stars = len(await el.query_selector_all("svg[class*='star'], .star"))
                reviews.append(Review(rating=min(max(stars, 3), 5), text=txt[:600], images=[]))
            except Exception:
                continue

    warnings.append("Extracción DOM: stock y variantes pueden ser aproximados")

    return ScrapedPayload(
        sourceUrl=url,
        supplier=SUPPLIER,
        supplierProductId=url.split("/item/")[-1].split(".")[0] if "/item/" in url else None,
        title=title,
        seoTitle=title[:70],
        description=await text_of(page, DOM_SELECTORS["description"]) or "",
        category=None,
        images=images,
        variants=variants or [
            Variant(supplierVariantId="default", sku="AE-DEFAULT", title="Estándar", price=price, stock=99)
        ],
        shipping=Shipping(options=[], cheapestCost=0, shipsTo=[country]),
        reviews=reviews,
        ratingAvg=0,
        ratingCount=0,
        stockTotal=sum(v.stock for v in variants),
        warnings=warnings,
        extractionMeta={"extractorVersion": EXTRACTOR_VERSION, "strategy": "dom_fallback"},
    )

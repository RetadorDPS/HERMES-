"""Extractor de Amazon (PDP v3) — JSON-LD + DOM + variaciones por twister.

Amazon bloquea agresivamente: el extractor asume proxy residencial y, si detecta
la página 'Enter the characters you see below', lanza BLOCKED para que el
ProxyManager rote IP y el cliente reintente.
"""
from __future__ import annotations

import asyncio
import json
import re
from typing import Any

from playwright.async_api import Page

from models import ProductImage, Review, ScrapedPayload, Shipping, ShippingOption, Variant
from .base import (
    all_attrs,
    attr_of,
    click_all,
    detect_blocked,
    eval_json,
    parse_price,
    text_of,
    to_hd,
    wait_any,
)

SUPPLIER = "AMAZON"
EXTRACTOR_VERSION = "amazon.pdp_v3"

SEL = {
    "title": ["#productTitle", "h1#title", "h1 span#productTitle"],
    "price": [
        ".a-price .a-offscreen",
        "#corePriceDisplay_desktop_feature_div .a-offscreen",
        "#priceblock_ourprice",
        "#price_inside_buybox",
    ],
    "bullets": ["#feature-bullets li span.a-list-item", "#feature-bullets ul li"],
    "description": ["#productDescription", "#aplus", "#bookDescription_feature_div"],
    "availability": ["#availability span", "#outOfStock"],
    "rating": ["#acrPopover span.a-icon-alt", "span[data-hook='rating-out-of-text']"],
    "review_count": ["#acrCustomerReviewText"],
    "reviews": ["div[data-hook='review']", "li[data-hook='review']"],
    "gallery": ["#altImages img", "#imageBlock img", "#landingImage"],
    "brand": ["#bylineInfo", "a#bylineInfo"],
    "breadcrumb": ["#wayfinding-breadcrumbs_feature_div a"],
    "variation_rows": ["#variation_color_name", "#variation_size_name", "#variation_style_name"],
}

JSONLD_JS = """() => {
  const nodes = [...document.querySelectorAll('script[type="application/ld+json"]')];
  for (const n of nodes) {
    try {
      const j = JSON.parse(n.textContent);
      const arr = Array.isArray(j) ? j : (j['@graph'] || [j]);
      for (const node of arr) {
        if (String(node['@type'] || '').toLowerCase().includes('product')) return JSON.stringify(node);
      }
    } catch (e) {}
  }
  return null;
}"""


async def extract(page: Page, url: str, *, include_reviews: bool = True, country: str = "ES", max_reviews: int = 40) -> ScrapedPayload:
    warnings: list[str] = ["Extractor Amazon PDP v3"]
    html = await page.content()
    if detect_blocked(html):
        raise RuntimeError("AMAZON_BLOCKED: captcha/robot check detectado")
    if await page.query_selector("#nav-bb-logo") and "Page Not Found" in html:
        raise RuntimeError("AMAZON_NOT_FOUND")

    await wait_any(page, SEL["title"], timeout_ms=12_000)
    ld = await eval_json(page, JSONLD_JS) or {}

    title = (await text_of(page, SEL["title"])) or ld.get("name") or ""
    if not title:
        raise RuntimeError("AMAZON_PARSE_ERROR: sin título (posible página intersticial)")

    asin = _asin(url)
    price = parse_price(
        (await text_of(page, SEL["price"]))
        or (ld.get("offers") or {}).get("price")
        or (ld.get("offers") or [{}])[0].get("price")
    )
    bullets = [b for b in await _all_texts(page, SEL["bullets"]) if b][:8]

    # ── Imágenes (galería en alta resolución)
    raw_imgs = await all_attrs(page, SEL["gallery"], "src")
    raw_imgs += await all_attrs(page, ["#altImages img"], "data-old-hires")
    dyn = await eval_json(
        page,
        """() => {
      const dyn = globalThis.__PRELOADED_STATE__?.imageGalleryData || [];
      return JSON.stringify(dyn.map(d => d.mainUrl).slice(0, 20));
    }""",
    )
    if isinstance(dyn, list):
        raw_imgs += [str(u) for u in dyn]
    seen, images = set(), []
    for u in raw_imgs:
        if not u or u.startswith("data:") or u in seen:
            continue
        seen.add(u)
        hd = to_hd(u, SUPPLIER)
        images.append(ProductImage(url=hd, hdUrl=hd))

    # ── Variaciones (twister) → variantes
    variants = await _extract_variations(page, asin, price, images)

    # ── Disponibilidad y stock
    availability = (await text_of(page, SEL["availability"])) or ""
    in_stock = not re.search(r"no disponible|unavailable|agotado|out of stock", availability, re.I)
    stock_estimate = 0 if not in_stock else _stock_hint(html) or 25

    # ── Reseñas
    reviews: list[Review] = []
    if include_reviews:
        await click_all(page, ["a[data-hook='see-all-reviews-link-foot']", "button:has-text('Ver más reseñas')"], max_clicks=2)
        blocks = await page.query_selector_all(", ".join(SEL["reviews"]))
        for el in blocks[:max_reviews]:
            try:
                rating_txt = await el.query_selector("i[data-hook='review-star-rating'] span, span[data-hook='review-star-rating']")
                rating = parse_price((await rating_txt.inner_text())[:3]) if rating_txt else 5
                author_el = await el.query_selector(".a-profile-name")
                body_el = await el.query_selector("span[data-hook='review-body']")
                date_el = await el.query_selector("span[data-hook='review-date']")
                img_urls = [await i.get_attribute("src") for i in await el.query_selector_all("img.review-image-tile")]
                reviews.append(
                    Review(
                        rating=int(round(rating)) or 5,
                        author=(await author_el.inner_text()).strip() if author_el else None,
                        authorCountry=_country_from_date((await date_el.inner_text()) if date_el else ""),
                        text=(await body_el.inner_text()).strip()[:800] if body_el else None,
                        date=(await date_el.inner_text()).strip() if date_el else None,
                        images=[u for u in img_urls if u],
                    )
                )
            except Exception:
                continue

    rating_avg = parse_price((await text_of(page, SEL["rating"]) or "0")[:3])
    rating_txt = (await text_of(page, SEL["review_count"])) or "0"
    rating_count = int(re.sub(r"\D", "", rating_txt) or 0)
    breadcrumbs = [t for t in await _all_texts(page, SEL["breadcrumb"]) if t]

    # Amazon no expone tarifas de envío por API pública: se estiman y se marcan.
    shipping_options = [
        ShippingOption(method="Amazon Prime (estimado)", carrier="Amazon Logistics", cost=0.0, currency="EUR", minDays=2, maxDays=4, isTracked=True, destinationCountry=country),
        ShippingOption(method="Envío estándar (estimado)", carrier="Correos", cost=3.99, currency="EUR", minDays=4, maxDays=7, isTracked=True, destinationCountry=country),
    ]
    warnings.append("Tarifas de envío ESTIMADAS (Amazon no publica costes sin cuenta de vendedor)")

    return ScrapedPayload(
        sourceUrl=url,
        supplier=SUPPLIER,
        supplierProductId=asin,
        title=title,
        seoTitle=title[:70],
        description=(await text_of(page, SEL["description"])) or ld.get("description") or "",
        bullets=bullets,
        category=breadcrumbs[-1] if breadcrumbs else None,
        categoryPath=breadcrumbs,
        tags=[],
        brand=(await text_of(page, SEL["brand"])) or "",
        currency="EUR" if ".es" in url else "USD",
        images=images,
        variants=variants,
        shipping=Shipping(
            options=shipping_options,
            cheapestCost=0.0,
            fastest=shipping_options[0],
            shipsTo=[country, "FR", "DE", "IT", "PT"],
        ),
        reviews=reviews,
        ratingAvg=rating_avg,
        ratingCount=rating_count,
        ordersCount=0,
        stockTotal=stock_estimate * max(len(variants), 1),
        specs={},
        warnings=warnings,
        extractionMeta={"extractorVersion": EXTRACTOR_VERSION, "strategy": "jsonld+dom", "asin": asin},
    )


async def _extract_variations(page: Page, asin: str, base_price: float, images: list[ProductImage]) -> list[Variant]:
    variants: list[Variant] = []
    for row_sel in SEL["variation_rows"]:
        row = await page.query_selector(row_sel)
        if not row:
            continue
        name = (await row.inner_text()).split("\n")[0].strip().rstrip(":")
        options = await row.query_selector_all("li, option")
        for i, opt in enumerate(options[:40]):
            try:
                label = (await opt.inner_text()).strip() or (await opt.get_attribute("value") or f"Opción {i + 1}")
                disabled = await opt.get_attribute("class") or ""
                stock = 0 if "unavailable" in disabled else 25
                variants.append(
                    Variant(
                        supplierVariantId=f"{asin}-{name}-{i}",
                        sku=f"{asin}-{i + 1}"[:40],
                        title=label,
                        option1Name=name or "Opción",
                        option1Value=label,
                        price=base_price,
                        stock=stock,
                        imageUrl=images[i % len(images)].url if images else None,
                    )
                )
            except Exception:
                continue
        if variants:
            break  # sólo la primera dimensión (evita explosión combinatoria)
    if not variants:
        variants = [
            Variant(
                supplierVariantId=asin or "default",
                sku=asin or "AMZ-DEFAULT",
                title="Estándar",
                option1Name="Opción",
                option1Value="Estándar",
                price=base_price,
                stock=25,
            )
        ]
    return variants


def _asin(url: str) -> str | None:
    m = re.search(r"/dp/([A-Z0-9]{10})", url) or re.search(r"/gp/product/([A-Z0-9]{10})", url)
    return m.group(1) if m else None


def _stock_hint(html: str) -> int | None:
    m = re.search(r"Only (\d+) left in stock", html, re.I)
    return int(m.group(1)) if m else None


def _country_from_date(text: str) -> str | None:
    m = re.search(r"Reviewed in ([A-Za-z\s]+) on", text)
    return m.group(1).strip() if m else None


async def _all_texts(page: Page, selectors: list[str]) -> list[str]:
    out: list[str] = []
    for sel in selectors:
        try:
            for el in await page.query_selector_all(sel):
                t = (await el.inner_text()).strip()
                if t:
                    out.append(t)
        except Exception:
            continue
    return out

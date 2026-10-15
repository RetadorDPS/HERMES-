"""Utilidades compartidas por los extractores."""
from __future__ import annotations

import json
import re
from typing import Any

from playwright.async_api import Page, TimeoutError as PWTimeout

HD_JUNK = re.compile(r"_\d+x\d+(q\d+)?\.(jpg|jpeg|png|webp)", re.I)
AMZ_JUNK = re.compile(r"\._[A-Z0-9_,]+_\.(jpg|jpeg|png|webp)", re.I)
PRICE_RE = re.compile(r"(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)")


def parse_price(raw: str | float | int | None) -> float:
    """Convierte '12,99 €', 'US $12.99', '1.234,56' a float."""
    if raw is None:
        return 0.0
    if isinstance(raw, (int, float)):
        return round(float(raw), 2)
    text = str(raw).replace("\xa0", " ").strip()
    match = PRICE_RE.search(text)
    if not match:
        return 0.0
    value = match.group(1)
    # Heurística de separadores: el último separador es el decimal
    if "," in value and "." in value:
        value = value.replace(".", "").replace(",", ".") if value.rfind(",") > value.rfind(".") else value.replace(",", "")
    elif "," in value:
        value = value.replace(",", ".")
    try:
        return round(float(value), 2)
    except ValueError:
        return 0.0


def to_hd(url: str, supplier: str) -> str:
    if not url:
        return url
    url = url.replace("\\/", "/")
    if supplier == "AMAZON":
        return AMZ_JUNK.sub(r".\1", url)
    return HD_JUNK.sub(r".\2", url)


async def wait_any(page: Page, selectors: list[str], timeout_ms: int = 15_000) -> str | None:
    """Espera a que aparezca el primero de varios selectores y lo devuelve."""
    import asyncio

    deadline = asyncio.get_event_loop().time() + timeout_ms / 1000
    while asyncio.get_event_loop().time() < deadline:
        for sel in selectors:
            el = await page.query_selector(sel)
            if el:
                return sel
        await asyncio.sleep(0.25)
    return None


async def text_of(page: Page, selectors: list[str]) -> str | None:
    for sel in selectors:
        try:
            el = await page.query_selector(sel)
            if el:
                txt = (await el.inner_text()).strip()
                if txt:
                    return txt
        except Exception:
            continue
    return None


async def attr_of(page: Page, selectors: list[str], attr: str = "src") -> str | None:
    for sel in selectors:
        try:
            el = await page.query_selector(sel)
            if el:
                val = await el.get_attribute(attr)
                if val:
                    return val
        except Exception:
            continue
    return None


async def all_attrs(page: Page, selectors: list[str], attr: str = "src") -> list[str]:
    out: list[str] = []
    for sel in selectors:
        try:
            els = await page.query_selector_all(sel)
            for el in els:
                val = await el.get_attribute(attr)
                if val:
                    out.append(val)
        except Exception:
            continue
    return out


async def eval_json(page: Page, js: str) -> Any | None:
    """Ejecuta JS en la página y normaliza el resultado (dict/list/str|null)."""
    try:
        raw = await page.evaluate(js)
    except Exception:
        return None
    if raw is None:
        return None
    if isinstance(raw, (dict, list)):
        return raw
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return None


async def click_all(page: Page, selectors: list[str], max_clicks: int = 6) -> None:
    """Pulsa 'ver más' / paginación de reseñas, ignorando errores."""
    for sel in selectors:
        for _ in range(max_clicks):
            try:
                el = await page.query_selector(sel)
                if not el or not await el.is_visible():
                    break
                await el.click(timeout=2500)
                await page.wait_for_timeout(700)
            except Exception:
                break


def detect_blocked(html: str) -> bool:
    """Detecta páginas de captcha/verificación en el HTML resultante."""
    markers = [
        "captcha",
        "Enter the characters you see below",
        "api-services-support@amazon.com",
        "punish",
        "SliderCaptcha",
        "nc_wrapper",
        "Verify you are human",
        "Access Denied",
    ]
    lowered = html.lower()
    return any(m.lower() in lowered for m in markers)


def clean_html(html: str) -> str:
    return re.sub(r"\s+", " ", html).strip()

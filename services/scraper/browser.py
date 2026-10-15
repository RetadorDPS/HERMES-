"""Gestión del navegador Playwright: contexto por request, stealth patches y
bloqueo de recursos para acelerar la navegación."""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from playwright.async_api import Browser, BrowserContext, Page, Playwright, async_playwright

from config import get_settings

log = logging.getLogger("scraper.browser")

STEALTH_SCRIPT = """
// ── Parches anti-detección básicos (se aplican antes de cargar cualquier script) ──
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
Object.defineProperty(navigator, 'languages', { get: () => ['es-ES', 'es', 'en-US', 'en'] });
Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
window.chrome = window.chrome || { runtime: {} };
const origQuery = window.navigator.permissions.query;
window.navigator.permissions.query = (p) =>
  p.name === 'notifications' ? Promise.resolve({ state: Notification.permission }) : origQuery(p);
const getParameter = WebGLRenderingContext.prototype.getParameter;
WebGLRenderingContext.prototype.getParameter = function (parameter) {
  if (parameter === 37445) return 'Intel Inc.';
  if (parameter === 37446) return 'Intel Iris OpenGL Engine';
  return getParameter.apply(this, [parameter]);
};
"""

BLOCKED_RESOURCE_TYPES = {"font", "media"}
BLOCKED_URL_PATTERNS = ("google-analytics", "doubleclick", "hotjar", "facebook.net", "segment.io", "clarity.ms")


class BrowserPool:
    """Un Chromium compartido + un contexto aislado por request (proxy distinto)."""

    def __init__(self) -> None:
        self._playwright: Playwright | None = None
        self._browser: Browser | None = None
        self._lock = asyncio.Lock()
        self._semaphore = asyncio.Semaphore(get_settings().max_concurrency)
        self.active_jobs = 0

    async def start(self) -> None:
        async with self._lock:
            if self._browser is not None:
                return
            settings = get_settings()
            self._playwright = await async_playwright().start()
            self._browser = await self._playwright.chromium.launch(
                headless=settings.headless,
                args=[
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-blink-features=AutomationControlled",
                    "--disable-features=IsolateOrigins,site-per-process",
                    "--window-size=1440,900",
                ],
            )
            log.info("Chromium listo (concurrency=%s)", settings.max_concurrency)

    async def stop(self) -> None:
        if self._browser:
            await self._browser.close()
        if self._playwright:
            await self._playwright.stop()
        self._browser = None
        self._playwright = None

    @asynccontextmanager
    async def page(self, proxy: str | None = None, locale: str = "es-ES") -> AsyncIterator[Page]:
        await self.start()
        assert self._browser is not None
        settings = get_settings()

        async with self._semaphore:
            self.active_jobs += 1
            context_args: dict[str, Any] = {
                "locale": locale,
                "timezone_id": "Europe/Madrid",
                "viewport": {"width": 1440, "height": 900},
                "user_agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
                ),
                "extra_http_headers": {
                    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
                    "Sec-Ch-Ua": '"Chromium";v="127", "Not)A;Brand";v="99"',
                    "Sec-Ch-Ua-Platform": '"Windows"',
                },
                "java_script_enabled": True,
                "ignore_https_errors": True,
            }
            if proxy:
                # formato esperado: http://user:pass@host:port
                from urllib.parse import urlparse

                p = urlparse(proxy)
                context_args["proxy"] = {
                    "server": f"{p.scheme}://{p.hostname}:{p.port}",
                    **({"username": p.username} if p.username else {}),
                    **({"password": p.password} if p.password else {}),
                }

            context = await self._browser.new_context(**context_args)
            if settings.stealth_patch:
                await context.add_init_script(STEALTH_SCRIPT)

            if settings.block_resources:
                async def route_handler(route):
                    req = route.request
                    if req.resource_type in BLOCKED_RESOURCE_TYPES or any(b in req.url for b in BLOCKED_URL_PATTERNS):
                        await route.abort()
                    else:
                        await route.continue_()

                await context.route("**/*", route_handler)

            page = await context.new_page()
            page.set_default_timeout(settings.browser_timeout_ms)
            page.set_default_navigation_timeout(settings.navigation_timeout_ms)
            try:
                yield page
            finally:
                self.active_jobs -= 1
                await context.close()

    async def humanize(self, page: Page) -> None:
        """Pequeños gestos humanos: movimiento de ratón, scroll suave, pausa."""
        settings = get_settings()
        try:
            await page.mouse.move(180 + (hash(page.url) % 200), 220 + (hash(page.url) % 140), steps=8)
            await page.mouse.wheel(0, 380)
            await asyncio.sleep(settings.human_delay_ms / 1000)
            await page.mouse.wheel(0, -140)
        except Exception:  # el navegador puede haberse cerrado
            pass


pool = BrowserPool()

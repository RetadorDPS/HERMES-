"""Captura visual del dashboard DropshipPilot (para enseñar la app al usuario)."""
import asyncio, os, pathlib
from playwright.async_api import async_playwright

BASE = "http://localhost:3000"
OUT = pathlib.Path("/home/user/autods-clone/docs/screenshots")
OUT.mkdir(parents=True, exist_ok=True)
PRODUCT_ID = "cmv8noj3f001k4arrqynqgb0p"
ALI = "https://es.aliexpress.com/item/1005006123456789.html"

PAGES = [
    ("00-login", "/login", None),
    ("01-dashboard", "/dashboard", None),
    ("03-productos", "/products", None),
    ("04-producto-detalle", f"/products/{PRODUCT_ID}", None),
    ("05-pedidos", "/orders", None),
    ("06-monitor-sync", "/monitor", None),
    ("07-proxies", "/proxies", None),
    ("08-tiendas", "/stores", None),
    ("09-precios", "/pricing", None),
    ("10-configuracion", "/settings", None),
]


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(args=["--no-sandbox"])
        ctx = await browser.new_context(viewport={"width": 1500, "height": 940}, device_scale_factor=1.25, locale="es-ES")
        page = await ctx.new_page()

        for name, path, _ in PAGES:
            await page.goto(BASE + path, wait_until="networkidle", timeout=45000)
            await page.wait_for_timeout(1400)
            await page.screenshot(path=OUT / f"{name}.jpg", type="jpeg", quality=82)
            print("captura:", name, "ok")

        # ── Importador: extraer un producto real del flujo y capturar la previsualización
        await page.goto(BASE + "/import", wait_until="networkidle", timeout=45000)
        await page.wait_for_timeout(800)
        await page.fill('input[placeholder*="aliexpress"]', ALI)
        await page.click('button:has-text("Extraer producto")')
        try:
            await page.wait_for_selector('button:has-text("Importar a")', state="visible", timeout=40000)
            await page.wait_for_timeout(1600)
            await page.screenshot(path=OUT / "02-importar.jpg", type="jpeg", quality=82)

            # baja a la zona de variantes / envío / reseñas
            await page.evaluate("window.scrollBy(0, 780)")
            await page.wait_for_timeout(1200)
            await page.screenshot(path=OUT / "02b-importar-variantes.jpg", type="jpeg", quality=82)
            print("captura: importar (con producto extraído) ok")
        except Exception as e:
            await page.screenshot(path=OUT / "02-importar.jpg", type="jpeg", quality=82)
            print("captura: importar SIN producto extraído →", type(e).__name__, e)

        await browser.close()


asyncio.run(main())

#!/usr/bin/env python3
"""
Captura un recorrido visual de la app en marcha (para el tour MIRA-LA-APP.html).

    cd services/scraper && ./.venv/bin/python ../../scripts/capture-tour.py

Abre cada página del panel con Chromium real (Playwright) y guarda una foto
JPEG en `capturas/`. Sirve para que se pueda ver la aplicación sin depender de
la vista previa del sandbox (que exige un token de acceso).
"""
import pathlib
import sys

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
OUT = pathlib.Path(__file__).resolve().parent.parent / "capturas"

PAGES = [
    ("dashboard", "/dashboard", "Portada: ventas, beneficio, cola de trabajo en vivo y alertas"),
    ("catalog", "/catalog", "Catálogo precargado: categorías con imagen, buscador y filtros"),
    ("import", "/import", "Importar por URL: extracción real y precios recalculados al mover el margen"),
    ("products", "/products", "Gestión de productos: estado de sincronización, stock y precio"),
    ("orders", "/orders", "Pedidos: envío al proveedor, seguimiento y beneficio real"),
    ("monitor", "/monitor", "Monitor 24/7: qué está haciendo el robot en este momento"),
    ("pricing", "/pricing", "Reglas de margen y simulador de precios"),
    ("stores", "/stores", "Tiendas conectadas (Shopify / WooCommerce) y sus webhooks"),
    ("proxies", "/proxies", "Proxies y anti-bot: validador con navegador real"),
    ("settings", "/settings", "Configuración: 2FA, avisos por correo y tus datos (descargar/borrar)"),
    ("setup", "/setup", "Puesta en marcha: las piezas del sistema comprobadas en vivo"),
    ("admin", "/admin", "Administración (sólo operador): clientes, consumo y catálogo de plataforma"),
]


def main() -> int:
    OUT.mkdir(exist_ok=True)
    only = sys.argv[1:] or None
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
        ok = 0
        for name, path, caption in PAGES:
            if only and name not in only:
                continue
            try:
                page.goto(BASE + path, wait_until="load", timeout=45_000)
                page.wait_for_timeout(2200)  # gráficas y colas en vivo
                page.screenshot(path=str(OUT / f"{name}.jpg"), type="jpeg", quality=68)
                size = (OUT / f"{name}.jpg").stat().st_size // 1024
                print(f"✔ {path:<12} {size:>4} KB  · {caption}")
                ok += 1
            except Exception as exc:  # noqa: BLE001
                print(f"✘ {path:<12} {exc}")
        browser.close()
    print(f"\n{ok} captura(s) en {OUT}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())

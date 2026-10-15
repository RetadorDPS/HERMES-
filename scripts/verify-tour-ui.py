#!/usr/bin/env python3
"""
Recorre el tutorial guiado como lo haría un cliente, con navegador real, y
guarda capturas en `capturas/tour-*.jpg`.

    cd services/scraper && ./.venv/bin/python ../../scripts/verify-tour-ui.py

Comprueba: que sale la tarjeta, que al aceptar aparece el primer paso señalando
la pantalla, que «Siguiente» cambia de pestaña de verdad, que «Saltar» lo cierra
y que al recargar ya no vuelve a salir. Deja la cuenta como estaba (pendiente).
"""
import pathlib
import subprocess
import sys

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "capturas"
PSQL = ["psql", "-h", "localhost", "-U", "autods", "-d", "autods", "-tAc"]


def sql(statement: str) -> str:
    import os

    env = dict(os.environ, PGPASSWORD="autods")
    return subprocess.run(PSQL + [statement], env=env, capture_output=True, text=True).stdout.strip()


passed = failed = 0


def check(ok: bool, msg: str, extra: str = "") -> None:
    global passed, failed
    print(f"{'✔' if ok else '✘'} {msg}{f' — {extra}' if extra else ''}")
    passed += 1 if ok else 0
    failed += 0 if ok else 1


def main() -> int:
    print("\nRecorrido guiado con navegador real\n")
    sql('update "User" set "tourVersion"=0, "tourSeenAt"=null;')

    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 1440, "height": 900})

        # 1. La tarjeta de bienvenida
        page.goto(f"{BASE}/dashboard", wait_until="load", timeout=45_000)
        page.wait_for_timeout(1500)
        card = page.locator('[data-tour-card]')
        check(card.count() == 1, "Al entrar por primera vez sale la tarjeta de bienvenida")
        check("12 pasos" in page.inner_text("body"), "La tarjeta dice cuántos pasos son")
        page.screenshot(path=str(OUT / "tour-1-bienvenida.jpg"), type="jpeg", quality=68)

        # 2. Aceptar → primer paso señalando la portada
        page.get_by_role("button", name="Sí, enséñame").click()
        page.wait_for_timeout(1800)
        body = page.inner_text("body")
        check("Paso 1 de 12" in body, "Al aceptar arranca el recorrido en el paso 1", body.split("Paso")[-1][:12].strip() if "Paso" in body else "sin paso")
        check("Esta es tu portada" in body, "El paso 1 explica la portada")
        glow = page.locator(".dp-tour-glow").count()
        check(glow >= 1, "La pestaña que toca queda iluminada en el menú", f"{glow} elemento(s)")
        page.screenshot(path=str(OUT / "tour-2-paso1.jpg"), type="jpeg", quality=68)

        # 3. Siguiente → cambia de pestaña de verdad (catálogo)
        page.get_by_role("button", name="Siguiente").click()
        page.wait_for_timeout(2500)
        check("/catalog" in page.url, "«Siguiente» cambia de pestaña de verdad", page.url.replace(BASE, ""))
        body = page.inner_text("body")
        check("Paso 2 de 12" in body and "Tu escaparate" in body, "El paso 2 explica el catálogo")
        page.screenshot(path=str(OUT / "tour-3-paso2-catalogo.jpg"), type="jpeg", quality=68)

        # 4. Atrás y volver a avanzar: el recorrido no se descuadra
        page.get_by_role("button", name="Atrás").click()
        page.wait_for_timeout(2000)
        check("Paso 1 de 12" in page.inner_text("body"), "«Atrás» vuelve al paso anterior")
        page.get_by_role("button", name="Siguiente").click()
        page.wait_for_timeout(2200)

        # 5. Recargar a media faena: se reanuda sin volver a preguntar
        page.reload(wait_until="load")
        page.wait_for_timeout(2000)
        body = page.inner_text("body")
        check("Paso" in body and "Toca" not in body.split("Paso")[0][-40:], "Si recarga a mitad, el recorrido se reanuda solo")

        # 6. Saltar: se cierra y no vuelve
        page.goto(f"{BASE}/dashboard", wait_until="load")
        page.wait_for_timeout(1500)
        page.get_by_role("button", name="Saltar el tutorial").click()
        page.wait_for_timeout(1500)
        version = sql('select "tourVersion" from "User" order by "createdAt" limit 1;')
        check(sql('select count(*) from "AuditLog" where action=\'tour.dismiss\';') != "0", "Al saltarlo queda registrado en la auditoría")
        page.reload(wait_until="load")
        page.wait_for_timeout(1800)
        check(page.locator('[data-tour-card]').count() == 0, "Tras saltarlo ya no vuelve a salir solo", f"tourVersion={version}")

        # 7. Y se puede recuperar desde Configuración
        page.goto(f"{BASE}/settings", wait_until="load")
        page.wait_for_timeout(1500)
        check("Ayuda y tutorial guiado" in page.inner_text("body"), "En Configuración está el bloque de ayuda")
        page.get_by_role("button", name="Ver el tutorial otra vez").click()
        page.wait_for_timeout(2600)
        check("12 pasos" in page.inner_text("body"), "El botón de Configuración lo vuelve a ofrecer")
        page.screenshot(path=str(OUT / "tour-4-settings-ayuda.jpg"), type="jpeg", quality=68)

        # 8. Y cómo se ve en el móvil
        phone = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2)
        phone.goto(f"{BASE}/dashboard", wait_until="load")
        phone.wait_for_timeout(1600)
        phone.get_by_role("button", name="Sí, enséñame").click()
        phone.wait_for_timeout(2200)
        check("Paso 1 de 12" in phone.inner_text("body"), "En el móvil también funciona (burbuja abajo, sin taparlo todo)")
        phone.screenshot(path=str(OUT / "tour-5-movil.jpg"), type="jpeg", quality=68)

        browser.close()

    # Dejarlo como estaba de cara al usuario: pendiente de verlo
    sql('update "User" set "tourVersion"=0, "tourSeenAt"=null;')
    print(f"\n{passed} comprobaciones superadas · {failed} fallidas")
    print("Cuentas de prueba dejadas en «pendiente de ver el tutorial»\n")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

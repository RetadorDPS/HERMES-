#!/usr/bin/env python3
"""
Prueba en navegador real la lista «Tus primeros pasos» y el tutorial del
operador, y guarda capturas en `capturas/`.

    cd services/scraper && ./.venv/bin/python ../../scripts/verify-onboarding-ui.py

Deja las cuentas preparadas para que el usuario vea las dos cosas al abrir el
panel: la lista visible y el recorrido del operador pendiente.
"""
import pathlib
import subprocess
import sys

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "capturas"
PSQL = ["psql", "-h", "localhost", "-U", "autods", "-d", "autods", "-tAc"]

passed = failed = 0


def check(ok: bool, msg: str, extra: str = "") -> None:
    global passed, failed
    print(f"{'✔' if ok else '✘'} {msg}{f' — {extra}' if extra else ''}")
    passed += 1 if ok else 0
    failed += 0 if ok else 1


def sql(statement: str) -> str:
    import os

    env = dict(os.environ, PGPASSWORD="autods")
    return subprocess.run(PSQL + [statement], env=env, capture_output=True, text=True).stdout.strip()


def main() -> int:
    print("\nPrimeros pasos y tutorial del operador, con navegador real\n")
    # Estado original de la suscripción: se restaura al terminar (la prueba toca el
    # plan de forma temporal para tener una tarea pendiente que ocultar/recuperar).
    orden = sql('select email from "User" order by "createdAt" limit 1;')
    original = sql(f'select s.plan || \'|\' || coalesce(s."stripeCustomerId", \'\') || \'|\' || coalesce(s."lemonCustomerId", \'\') from "Subscription" s join "User" u on u.id = s."userId" where u.email = \'{orden}\';')
    # La cuenta de pruebas empieza como un cliente nuevo: sin el tutorial visto
    sql('update "User" set "tourVersion"=0, "tourSeenAt"=null, "adminTourVersion"=0, "adminTourSeenAt"=null, "onboardingHiddenAt"=null;')

    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 1440, "height": 900})

        # ── La lista de primeros pasos ────────────────────────────────────────
        page.goto(f"{BASE}/dashboard", wait_until="load", timeout=45_000)
        page.wait_for_timeout(1600)

        # Primero: la lista existe debajo de la tarjeta del tutorial y trae sus 5 tareas
        body = page.inner_text("body")
        check("Tus primeros pasos" in body, "La portada trae la lista de primeros pasos")
        for label in ["Haz el recorrido guiado", "Conecta tu tienda", "Importa tu primer producto", "Deja que el robot lo vigile", "Elige cómo cobrar"]:
            check(label in body, f"Aparece la tarea «{label}»")
        check(page.get_by_role("button", name="Ver").count() == 1, "La tarea del tutorial trae su botón para arrancarlo")

        # El botón de la lista arranca el recorrido (se pulsa aunque la tarjeta lo tape:
        # es lo que pasaría si el cliente decidiera verlo más tarde desde la lista)
        page.get_by_role("button", name="Ver").dispatch_event("click")
        page.wait_for_timeout(2600)
        check("Paso 1 de 12" in page.inner_text("body"), "El botón «Ver» de la lista arranca el tutorial guiado")

        page.wait_for_selector("text=Saltar el tutorial", timeout=20000)
        page.locator("text=Saltar el tutorial").click()
        page.wait_for_timeout(2400)

        # Al resolver el tutorial (verlo o saltarlo), esa casilla se marca sola
        version = sql('select "tourVersion" from "User" order by "createdAt" limit 1;')
        body = page.inner_text("body")
        check(version == "2", "Al saltarlo, la casilla del tutorial queda hecha sola", f"tourVersion={version}")
        # La casilla del tutorial se marca sola. Si además quedaban tareas pendientes,
        # la tarjeta sigue en la portada; si ya estaban las 5, desaparece (correcto).
        import json as _json
        import urllib.request as _url

        estado = _json.load(_url.urlopen(f"{BASE}/api/account/onboarding", timeout=10))
        tarea_tour = next(t for t in estado["tasks"] if t["key"] == "tour")
        check(tarea_tour["done"] is True, "El servidor confirma que la tarea del tutorial está hecha")
        if estado["done"] < estado["total"]:
            check("Tus primeros pasos" in body, "Quedan tareas pendientes: la tarjeta sigue en la portada", f"{estado['done']} de {estado['total']}")
        else:
            check("Tus primeros pasos" not in body, "Con las 5 hechas la tarjeta se retira sola (ya no hace falta)", f"{estado['done']} de {estado['total']}")
        page.screenshot(path=str(OUT / "onboarding-1-lista.jpg"), type="jpeg", quality=68)

        # ── Ocultar y recuperar ────────────────────────────────────────────────
        # En esta cuenta ya están las 5 hechas (por eso la lista desapareció sola,
        # que es lo correcto). Para probar ocultar/recuperar se deja una pendiente
        # de forma temporal: como si el cliente aún no hubiera elegido cómo cobrar.
        sql(f'update "Subscription" s set plan=\'TRIAL\', "stripeCustomerId"=null, "lemonCustomerId"=null from "User" u where u.id = s."userId" and u.email = \'{orden}\';')
        page.goto(f"{BASE}/dashboard", wait_until="load")
        page.wait_for_timeout(1800)
        check("Tus primeros pasos" in page.inner_text("body"), "Con una tarea pendiente la lista vuelve a la portada")
        check("4 de 5" in page.inner_text("body"), "Y el contador refleja lo que falta", "4 de 5")
        page.screenshot(path=str(OUT / "onboarding-1b-lista-4de5.jpg"), type="jpeg", quality=68)
        page.get_by_role("button", name="Ocultar").click()
        page.wait_for_timeout(1800)
        check("Tus primeros pasos" not in page.inner_text("body"), "Se puede ocultar la lista desde la portada")
        page.goto(f"{BASE}/settings", wait_until="load")
        page.wait_for_timeout(1500)
        check("Volver a mostrar mis primeros pasos" in page.inner_text("body"), "En Configuración aparece el botón para recuperarla")
        page.screenshot(path=str(OUT / "onboarding-3-settings-ayuda.jpg"), type="jpeg", quality=68)
        page.get_by_role("button", name="Volver a mostrar mis primeros pasos").click()
        page.wait_for_timeout(2200)
        page.goto(f"{BASE}/dashboard", wait_until="load")
        page.wait_for_timeout(1500)
        check("Tus primeros pasos" in page.inner_text("body"), "Al recuperarla, vuelve a la portada")
        # Se deja la cuenta EXACTAMENTE como estaba (plan y clientes de pago)
        plan, _, resto = original.partition("|")
        stripe, _, lemon = resto.partition("|")
        sql(f'update "Subscription" s set plan=\'{plan}\', "stripeCustomerId"=nullif(\'{stripe}\',\'\'), "lemonCustomerId"=nullif(\'{lemon}\',\'\') from "User" u where u.id = s."userId" and u.email = \'{orden}\';')

        # ── El tutorial del operador ──────────────────────────────────────────
        check("zona de operador" not in page.inner_text("body"), "El recorrido del operador no aparece en las pantallas del cliente")
        page.goto(f"{BASE}/admin", wait_until="load")
        page.wait_for_timeout(1800)
        body = page.inner_text("body")
        check("¿Te enseño la zona de operador?" in body, "Al operador le sale SU recorrido (5 pasos), no el del cliente")
        check("5 pasos" in body, "Y se presenta como recorrido corto de administración")
        page.screenshot(path=str(OUT / "onboarding-4-tour-operador.jpg"), type="jpeg", quality=68)

        page.get_by_role("button", name="Sí, enséñame la administración").click()
        page.wait_for_timeout(2200)
        body = page.inner_text("body")
        check("Paso 1 de 5" in body and "Tu negocio" in body, "Arranca el recorrido del operador por las métricas")

        for _ in range(4):
            page.get_by_role("button", name="Siguiente").click()
            page.wait_for_timeout(1600)
        body = page.inner_text("body")
        check("Paso 5 de 5" in body, "Llega hasta el paso 5 (lo que se mantiene solo)", body.split("Paso")[-1][:22].strip())
        page.screenshot(path=str(OUT / "onboarding-5-tour-operador-paso5.jpg"), type="jpeg", quality=68)
        page.get_by_role("button", name="Terminar").click()
        page.wait_for_timeout(2600)
        check("Panel de operador, visto" in page.inner_text("body"), "Y se despide reconociendo al operador")
        page.screenshot(path=str(OUT / "onboarding-6-despedida-operador.jpg"), type="jpeg", quality=68)

        browser.close()

    plan_final = sql(f'select s.plan from "Subscription" s join "User" u on u.id = s."userId" where u.email = \'{orden}\';')
    check(plan_final == original.split("|")[0], "La prueba deja el plan del cliente como estaba", f"{plan_final} (era {original.split('|')[0]})")
    admin_version = sql('select "adminTourVersion" from "User" order by "createdAt" limit 1;')
    check(admin_version == "2", "El recorrido del operador no volverá a salir solo", f"adminTourVersion={admin_version}")
    # Se deja pendiente para que el usuario lo vea al abrir el panel
    sql('update "User" set "adminTourVersion"=0, "adminTourSeenAt"=null;')

    print(f"\n{passed} comprobaciones superadas · {failed} fallidas\n")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

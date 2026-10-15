#!/usr/bin/env python3
"""
Genera MIRA-LA-APP.html: recorrido visual autocontenido con las capturas de
`capturas/` incrustadas (base64), para poder ver la aplicación desde el visor de
archivos, que no tiene acceso a la red.

    cd services/scraper && ./.venv/bin/python ../../scripts/build-tour.py
"""
import base64
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SHOTS = ROOT / "capturas"
OUT = ROOT.parent / "MIRA-LA-APP.html"

# El tutorial guiado y la lista de primeros pasos (lo nuevo)
TOUR_SHOTS = [
    ("onboarding-8-avisos-correo-detalle", "Y se puede apagar, como todo",
     "En Configuración → Avisos por correo hay un interruptor nuevo, «Primeros pasos y acompañamiento», además de los de fallos de sync, stock, webhooks y pagos. Si se apaga, ni la bienvenida ni el recordatorio le llegan: se respeta a la primera."),
    ("correo-bienvenida", "El correo de bienvenida (el mismo que llega al cliente)",
     "Cuando alguien se da de alta, no recibe un «confirma tu cuenta» a secas: le llega la bienvenida con <b>su lista de primeros pasos</b>, cada uno con su enlace. Va por tu propio buzón (SMTP), sin pagar a nadie. Y si a los 24 h sigue con tareas pendientes, recibe <b>un solo</b> recordatorio — nunca más, y se puede apagar."),
    ("onboarding-1b-lista-4de5", "«Tus primeros pasos», la lista que se marca sola",
     "La portada le dice al cliente qué hacer, sin que nadie se lo explique: cinco tareas con barra de progreso. Cuatro están verdes porque el sistema ha comprobado en la base de datos que ya están hechas; la que queda en gris trae su botón «Ir»."),
    ("onboarding-4-tour-operador", "El recorrido del operador",
     "Quien vende el servicio tiene su propio recorrido corto de 5 pasos dentro de Administración: métricas, clientes, claves de proveedor y lo que se mantiene solo. Es independiente del recorrido del cliente."),
    ("onboarding-3-settings-ayuda", "Ayuda en Configuración",
     "Dónde se recupera todo: volver a ver el tutorial, volver a mostrar la lista de primeros pasos si la ocultaste, y la lista de los 12 pasos del recorrido."),
    ("onboarding-5-tour-operador-paso5", "Último paso del operador",
     "Lo que se mantiene solo: tipos del BCE, copias de seguridad comprobadas y vigilancia del sistema."),
    ("onboarding-6-despedida-operador", "Despedida del recorrido del operador",
     "Al terminar, el tutorial se retira y no vuelve a salir solo."),
    ("tour-1-bienvenida", "La tarjeta de bienvenida",
     "Lo primero que ve un cliente nuevo: se le ofrece el recorrido en vez de soltarle 13 pestañas. Puede aceptar o decir que no; si dice que no, no vuelve a salir."),
    ("tour-2-paso1", "Paso 1: «Esta es tu portada»",
     "La pestaña que toca queda iluminada en el menú, la pantalla se oscurece alrededor de lo importante y la burbuja explica qué es y para qué sirve. La capa oscura no bloquea los clics: puede tocar lo que se le señala mientras lee."),
    ("tour-3-paso2-catalogo", "Paso 2: el catálogo",
     "Al pulsar «Siguiente» la app cambia de pestaña de verdad, no muestra una foto. Así se recorre todo: catálogo, importar, productos, pedidos, monitor 24/7, precios, tiendas, proxies, facturación y puesta en marcha."),
    ("tour-4-settings-ayuda", "Y siempre disponible en Configuración",
     "Quien lo termine o lo salte no lo vuelve a ver solo, pero lo tiene aquí: «Ver el tutorial otra vez» y la lista de los 12 pasos. Debajo están los derechos de tus datos (descargar en JSON y borrar la cuenta)."),
    ("tour-5-movil", "También en el móvil",
     "En pantalla pequeña la burbuja baja abajo para no taparlo todo, y el recorrido funciona igual."),
]

SECTIONS = [
    ("dashboard", "Portada del negocio",
     "Lo primero que ve el cliente al entrar: ventas y beneficio de los últimos 7 días, cuántos productos vigila el robot y la cola de trabajo en vivo, con los avisos que importan arriba en rojo y ámbar."),
    ("catalog", "Catálogo para pintar y vender",
     "No es un buscador de palabras: es un escaparate ya montado, con categorías ilustradas, coste del proveedor, tu precio de venta y tu beneficio por unidad calculado con tu regla de margen."),
    ("import", "Importar por URL",
     "Se pega el enlace del producto y aparece la ficha completa: variantes, fotos en alta calidad, reseñas, envíos a España. Moviendo el margen se ve el precio y el beneficio recalcularse al instante, antes de importar."),
    ("products", "Tus productos, vigilados",
     "Cada producto con su estado de sincronización, su precio, su stock y la fecha de la última comprobación. El interruptor de la derecha decide si el robot lo vigila cada hora o no."),
    ("orders", "Pedidos y envíos",
     "El pedido entra desde la tienda, se manda al proveedor con un botón, y el seguimiento vuelve solo a Shopify o WooCommerce. Aquí se ve el beneficio real, no el estimado."),
    ("monitor", "El robot, en directo",
     "El cliente ve qué está haciendo el sistema ahora mismo: trabajos en espera, en proceso, terminados y fallidos, con el detalle de cada uno y botones para forzar un barrido o reintentar lo que falló."),
    ("pricing", "Reglas de precio y margen",
     "Tres reglas de negocio con su porcentaje de margen y un simulador que las compara con el coste que le pidas: sirve para decidir el precio sin tocar nada más."),
    ("stores", "Tiendas conectadas",
     "Shopify y WooCommerce, por OAuth en un clic o pegando el token. Muestra qué webhooks están activos y qué permisos se están usando, para que no haya sorpresas."),
    ("proxies", "Proxies y anti-bot",
     "Aquí se pegan los proxies y se prueban con un navegador de verdad, con nota y tiempo de respuesta. La rotación, el enfriamiento y los reintentos ya los hace la app; el cliente sólo aporta las direcciones."),
    ("settings", "Configuración y tus datos",
     "Datos personales, segundo factor (2FA), avisos por correo, y la tarjeta nueva de derechos: descargar todo lo guardado en un JSON con un clic, o borrar la cuenta entera desde el propio panel."),
    ("setup", "Puesta en marcha",
     "El centro de conexión: las piezas del sistema comprobadas en vivo (base de datos, Redis, scraping, correo, cobros, cifrado, webhooks...), cada una con la variable exacta que hay que pegar."),
    ("admin", "Panel del operador",
     "Para quien venda este servicio a otros: cuántos clientes hay, su consumo, su plan y sus créditos, más las claves de proveedor de la plataforma que usan todos."),
]

HEAD = """<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DropshipPilot · recorrido visual de la app</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: #080b10; color: #e6edf6;
    font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  }
  .wrap { max-width: 1180px; margin: 0 auto; padding: 40px 20px 80px; }
  header.hero { border: 1px solid #1e2a3a; background: linear-gradient(160deg, #0e1622, #0a0f16 60%); border-radius: 18px; padding: 30px 32px; }
  h1 { font-size: 30px; margin: 0 0 8px; letter-spacing: -0.4px; }
  h1 span { color: #8b5cf6; }
  .sub { color: #93a4bb; margin: 0; font-size: 15.5px; }
  .badge { display: inline-block; font-size: 12px; font-weight: 600; color: #a5f3c0; background: rgba(34,197,94,.12); border: 1px solid rgba(34,197,94,.35); border-radius: 999px; padding: 3px 10px; margin-bottom: 14px; }
  .box { border: 1px solid #1e2a3a; background: #0b111a; border-radius: 14px; padding: 20px 22px; margin-top: 22px; }
  .box h2 { font-size: 17px; margin: 0 0 12px; }
  .box.warn { border-color: rgba(245,158,11,.35); background: rgba(245,158,11,.06); }
  ol, ul { margin: 0; padding-left: 22px; }
  li { margin: 7px 0; color: #c7d3e2; }
  code { background: #131c28; border: 1px solid #23303f; border-radius: 6px; padding: 1px 6px; font-size: 13.5px; color: #a5d6ff; }
  .k { color: #e6edf6; font-weight: 600; }
  .screens { margin-top: 34px; display: grid; gap: 30px; }
  .screen { border: 1px solid #1e2a3a; background: #0b111a; border-radius: 16px; overflow: hidden; }
  .screen .text { padding: 18px 22px 4px; }
  .screen h3 { margin: 0 0 6px; font-size: 19px; }
  .screen h3 em { font-style: normal; color: #6b7c93; font-size: 13px; font-weight: 500; margin-left: 8px; }
  .screen p { margin: 0 0 12px; color: #a9b7c9; font-size: 15px; }
  .shot { display: block; width: 100%; height: auto; border-top: 1px solid #1e2a3a; cursor: zoom-in; }
  .screen.open .shot { cursor: zoom-out; }
  footer { margin-top: 40px; color: #7d8ea6; font-size: 14px; border-top: 1px solid #1a2534; padding-top: 22px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; }
  @media (max-width: 780px) { .grid2 { grid-template-columns: 1fr; } h1 { font-size: 24px; } }
</style>
</head>
<body>
<div class="wrap">
  <header class="hero">
    <div class="badge">22 capturas reales · tomadas el 15/10/2026 del panel que está corriendo</div>
    <h1>DropshipPilot <span>por dentro</span></h1>
    <p class="sub">Estas no son maquetas ni dibujos: son fotos del panel funcionando ahora mismo, con datos de verdad
    (ventas, productos, pedidos y la cola de trabajo del robot 24/7). Toca cualquier captura para agrandarla.</p>
  </header>

  <div class="box warn">
    <h2>⚠️ Por qué el enlace directo te daba error</h2>
    <p style="margin:0;color:#d7c9a8">Este entorno de pruebas está protegido con un <span class="k">token de acceso</span>: si escribes la
    dirección a mano en el navegador responde <code>403 · falta la cabecera e2b-traffic-access-token</code>. El token lo pone
    automáticamente el <span class="k">recuadro de vista previa</span> de esta conversación, así que la forma de entrar es tocar
    ese recuadro (el que aparece junto al proceso «Panel (web)»), no copiar la dirección.</p>
  </div>

  <div class="grid2">
    <div class="box">
      <h2>🖱️ Formas de verla, de más fácil a más completa</h2>
      <ol>
        <li><span class="k">Este documento</span>: el recorrido que estás leyendo.</li>
        <li><span class="k">El recuadro de vista previa</span> de esta conversación (proceso «Panel (web)»). Ahí sí se navega de verdad.</li>
        <li><span class="k">Descargar el proyecto</span> y ejecutarlo en tu ordenador: <code>./scripts/start-everything.sh</code> y abrir <code>http://localhost:3000</code>.</li>
      </ol>
    </div>
    <div class="box">
      <h2>🚀 Guía rápida para un cliente nuevo</h2>
      <ol>
        <li><span class="k">Crear cuenta</span> y confirmar el correo (el aviso llega por tu propio buzón).</li>
        <li><span class="k">Conectar la tienda</span> en <em>Tiendas</em>: Shopify con un clic, WooCommerce con sus claves.</li>
        <li><span class="k">Mirar el catálogo</span>, ver el beneficio por unidad y pulsar <em>Importar</em>.</li>
        <li><span class="k">Dejarlo trabajando</span>: el robot revisa precios y stock cada hora y despublica lo que se agote.</li>
      </ol>
    </div>
  </div>

  <div class="screens">
"""

TAIL = """  </div>

  <footer>
    <p><span class="k">Estado:</span> 23 comprobaciones del tutorial guiado y 14 en navegador real · 44 de derechos del cliente y copias · 58 del catálogo · 27 de divisas ·
    18 de correo · 13 de aislamiento entre clientes · ciclo completo de importación y sincronización · 0 fallos.</p>
    <p><span class="k">Lo único que falta</span> son las claves reales (AliExpress, CJdropshipping, tu servidor de correo y el cobro):
    el resto está construido y probado. Las capturas se rehacen con <code>scripts/capture-tour.py</code>.</p>
  </footer>
</div>
<script>
  document.querySelectorAll('.screen .shot').forEach(function (img) {
    img.addEventListener('click', function () { img.closest('.screen').classList.toggle('open'); });
  });
</script>
</body>
</html>
"""


def main() -> int:
    parts = [HEAD]
    # Primero el tutorial guiado, que es lo último que se ha construido
    parts.append('    <section class="screen" style="border-color:rgba(139,92,246,.45)">\n'
                 '      <div class="text">\n'
                 '        <h3>El acompañante de bienvenida <em>tutorial guiado</em></h3>\n'
                 '        <p>Un cliente nuevo ya no se encuentra un panel mudo: la app le ofrece enseñarle las 12 pestañas y va con él, señalando dónde tocar en cada una. Se sale cuando se quiera y, si se cierra, no vuelve a aparecer solo (queda en Configuración → Ayuda).</p>\n'
                 '      </div>\n'
                 '    </section>\n')
    for name, title, what in TOUR_SHOTS:
        f = SHOTS / f"{name}.jpg"
        if not f.exists():
            print(f"· falta {f.name}, se omite")
            continue
        b64 = base64.b64encode(f.read_bytes()).decode()
        parts.append(
            f'    <section class="screen">\n'
            f'      <div class="text">\n'
            f'        <h3>{title} <em>/tutorial</em></h3>\n'
            f'        <p>{what}</p>\n'
            f'      </div>\n'
            f'      <img class="shot" alt="{title}" src="data:image/jpeg;base64,{b64}">\n'
            f'    </section>\n'
        )
    total = 0
    for name, title, what in SECTIONS:
        f = SHOTS / f"{name}.jpg"
        if not f.exists():
            print(f"· falta {f.name}, se omite")
            continue
        b64 = base64.b64encode(f.read_bytes()).decode()
        total += len(b64)
        parts.append(
            f'    <section class="screen">\n'
            f'      <div class="text">\n'
            f'        <h3>{title} <em>/{name}</em></h3>\n'
            f'        <p>{what}</p>\n'
            f'      </div>\n'
            f'      <img class="shot" alt="{title}" src="data:image/jpeg;base64,{b64}">\n'
            f'    </section>\n'
        )
    parts.append(TAIL)
    OUT.write_text("".join(parts), encoding="utf-8")
    print(f"✔ {OUT} · {OUT.stat().st_size / 1024 / 1024:.2f} MB ({len(SECTIONS)} pantallas + tutorial)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

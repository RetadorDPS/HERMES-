"""Construye docs/GALERIA.html (galería autocontenida) y docs/GALERIA.pdf con las capturas del dashboard."""
import base64, io, pathlib
from PIL import Image
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.utils import ImageReader
from reportlab.lib import colors
from reportlab.pdfgen import canvas

SRC = pathlib.Path("/home/user/autods-clone/docs/screenshots")
OUT = SRC.parent
WIDTH = 1100  # ancho de reescalado para la galería HTML

SHOTS = [
    ("00-login.jpg", "Iniciar sesión", "Pantalla de acceso con NextAuth (opcional, se activa con AUTH_ENABLED=true). Credenciales verificadas con hash scrypt, sesión en cookie HttpOnly y menú de usuario con cierre de sesión en la cabecera."),
    ("01-dashboard.jpg", "Dashboard", "KPIs de ventas y beneficio, gráfica de 7 días, cola de sincronización BullMQ en vivo, alertas de tiendas con error y stream de actividad. Datos leídos de PostgreSQL."),
    ("02-importar.jpg", "Importar por URL", "El flujo estrella: se pega la URL del proveedor, se extrae y aparece la previsualización editable — título, descripción HTML, 4 imágenes HD, coste, stock, pedidos, valoración y desglose del precio en vivo."),
    ("02b-importar-variantes.jpg", "Importar por URL · variantes y envío", "Más abajo en la misma pantalla: variantes detectadas con SKU/color/talla/precio/stock, opciones de envío con coste y plazo, reseñas de compradores y configuración de venta."),
    ("03-productos.jpg", "Productos", "Gestión completa: buscador, filtros por tienda/estado de sync, acciones masivas, interruptor de monitorización 24/7 y botón de sincronización inmediata."),
    ("04-producto-detalle.jpg", "Detalle de producto", "Ficha con variantes, galería de imágenes HD, envío, reseñas e historial de sincronización (SyncLog) con cada cambio de precio o stock."),
    ("05-pedidos.jpg", "Pedidos y envíos", "Monitor de pedidos: importe, coste de proveedor, beneficio, estado de fulfillment, tracking con enlace de seguimiento y botón de compra al proveedor."),
    ("06-monitor-sync.jpg", "Monitor de sync", "El motor 24/7: estado de la cola (en espera / en proceso / completados / fallidos), jobs en vivo, barrido manual, pausa y reintento de fallidos."),
    ("07-proxies.jpg", "Proxies y anti-bot", "Panel nuevo: estado del pool, validador de proxies con navegador real (IP de salida, latencia y detección de bloqueo), proveedores residenciales con precios y la configuración exacta para copiar."),
    ("08-tiendas.jpg", "Tiendas", "Conexión de Shopify (GraphQL Admin API) y WooCommerce: validación real de credenciales, scopes, webhooks y prueba de conexión."),
    ("09-precios.jpg", "Precios y márgenes", "Las tres reglas de margen (markup %, redondeo psicológico, reglas por categoría) y un simulador que compara el resultado de cada regla a distintos costes."),
    ("10-configuracion.jpg", "Configuración", "Puesta en marcha en 4 pasos, variables de entorno documentadas y estado del sistema (PostgreSQL, Redis, scraper, Stripe)."),
]


def resized_b64(path: pathlib.Path, width=WIDTH) -> str:
    img = Image.open(path).convert("RGB")
    if img.width > width:
        img = img.resize((width, round(img.height * width / img.width)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=74, optimize=True)
    return base64.b64encode(buf.getvalue()).decode()


# ─────────────────────────────── HTML ───────────────────────────────
cards = []
for i, (fname, title, desc) in enumerate(SHOTS, 1):
    p = SRC / fname
    if not p.exists():
        continue
    b64 = resized_b64(p)
    cards.append(f"""
  <section class="shot">
    <div class="meta">
      <span class="num">{i:02d}</span>
      <div>
        <h2>{title}</h2>
        <p>{desc}</p>
      </div>
    </div>
    <img src="data:image/jpeg;base64,{b64}" alt="{title}" loading="lazy" />
  </section>""")

html = f"""<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>DropshipPilot · Galería de la aplicación</title>
<style>
  :root {{ color-scheme: dark; }}
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0; padding: 40px 22px 80px;
    background: radial-gradient(1200px 600px at 20% -10%, #1b1f3b 0%, #0a0b14 55%, #07070d 100%);
    color: #e8eaf3; font: 15px/1.6 -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  }}
  .wrap {{ max-width: 1180px; margin: 0 auto; }}
  header.top {{ margin-bottom: 34px; }}
  .brand {{ display: flex; align-items: center; gap: 12px; }}
  .logo {{ width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center;
           background: linear-gradient(135deg, #6366f1, #22d3ee); font-weight: 700; color: #050510; }}
  h1 {{ font-size: 26px; margin: 0; letter-spacing: -0.4px; }}
  .sub {{ color: #9aa3bd; font-size: 13.5px; margin: 6px 0 0 52px; }}
  .badges {{ display: flex; flex-wrap: wrap; gap: 8px; margin: 18px 0 0 52px; }}
  .badge {{ font-size: 11.5px; padding: 4px 10px; border-radius: 999px; border: 1px solid rgba(255,255,255,.12);
            background: rgba(255,255,255,.04); color: #c8cfe4; }}
  .badge.ok {{ border-color: rgba(52,211,153,.35); background: rgba(52,211,153,.10); color: #6ee7b7; }}
  .badge.info {{ border-color: rgba(99,102,241,.4); background: rgba(99,102,241,.12); color: #a5b4fc; }}
  .shot {{ margin: 0 0 46px; }}
  .meta {{ display: flex; gap: 14px; align-items: flex-start; margin-bottom: 12px; }}
  .num {{ font: 700 13px/1 ui-monospace, monospace; color: #818cf8; border: 1px solid rgba(129,140,248,.35);
          background: rgba(99,102,241,.12); border-radius: 10px; padding: 7px 9px; }}
  h2 {{ font-size: 17px; margin: 0 0 3px; letter-spacing: -0.2px; }}
  .meta p {{ margin: 0; color: #9aa3bd; font-size: 13px; max-width: 900px; }}
  img {{ width: 100%; border-radius: 14px; border: 1px solid rgba(255,255,255,.09);
         box-shadow: 0 22px 60px rgba(0,0,0,.55); display: block; }}
  footer {{ margin-top: 20px; color: #6f7893; font-size: 12.5px; border-top: 1px solid rgba(255,255,255,.08); padding-top: 18px; }}
  code {{ background: rgba(255,255,255,.06); padding: 1px 5px; border-radius: 5px; font-size: 12px; }}
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div class="brand">
      <div class="logo">⚡</div>
      <div>
        <h1>DropshipPilot — galería de la aplicación</h1>
      </div>
    </div>
    <p class="sub">Capturas reales de la app en ejecución (Next.js 14 + PostgreSQL + Redis + microservicio de scraping FastAPI).
    Fecha de captura: 15/10/2026 · ventana 1500×940 · tema oscuro.</p>
    <div class="badges">
      <span class="badge ok">PostgreSQL conectado</span>
      <span class="badge ok">Redis + BullMQ activos</span>
      <span class="badge ok">Scraper v1.4.0</span>
      <span class="badge info">modo producción</span>
      <span class="badge">11 pantallas</span>
      <span class="badge">Datos del seed real en base de datos</span>
    </div>
  </header>
{''.join(cards)}
  <footer>
    Generado automáticamente con <code>scripts/capture-screenshots.py</code> + <code>scripts/build-gallery.py</code>.
    Las capturas muestran la aplicación real; el modo demo se señala en pantalla cuando la extracción no puede salir al proveedor.
  </footer>
</div>
</body>
</html>"""

(OUT / "GALERIA.html").write_text(html, encoding="utf-8")
size = (OUT / "GALERIA.html").stat().st_size / 1048576
print(f"GALERIA.html → {size:.2f} MB")

# ─────────────────────────────── PDF ───────────────────────────────
pdf_path = OUT / "GALERIA.pdf"
PW, PH = landscape(A4)
c = canvas.Canvas(str(pdf_path), pagesize=(PW, PH))
c.setTitle("DropshipPilot — Galería de la aplicación")

AUT = colors.HexColor("#6366f1")
MUT = colors.HexColor("#64748b")

# portada
c.setFillColor(colors.HexColor("#0a0b14")); c.rect(0, 0, PW, PH, fill=1, stroke=0)
c.setFillColor(colors.white); c.setFont("Helvetica-Bold", 32)
c.drawString(56, PH - 150, "DropshipPilot")
c.setFont("Helvetica", 16); c.setFillColor(colors.HexColor("#a5b4fc"))
c.drawString(56, PH - 178, "Clon full-stack de AutoDS · galería de la aplicación en ejecución")
c.setFont("Helvetica", 11.5); c.setFillColor(MUT)
for i, line in enumerate([
    "Capturas tomadas el 15/10/2026 de la app real (Next.js 14 + PostgreSQL + Redis + FastAPI/Playwright).",
    "Modo producción: PostgreSQL y Redis conectados, 6 productos del seed, worker 24/7 con cola BullMQ.",
    "Cada página lleva su descripción: qué demuestra y qué mirar.",
    "El modo demo se etiqueta en pantalla cuando la extracción no puede salir al proveedor (bloqueo anti-bot sin proxies residenciales).",
]):
    c.drawString(56, PH - 214 - i * 17, "•  " + line)
c.setFillColor(AUT); c.setFont("Helvetica-Bold", 12); c.drawString(56, 64, "DropshipPilot · docs/GALERIA.pdf")
c.showPage()

for i, (fname, title, desc) in enumerate(SHOTS, 1):
    p = SRC / fname
    if not p.exists():
        continue
    c.setFillColor(colors.HexColor("#0a0b14")); c.rect(0, 0, PW, PH, fill=1, stroke=0)
    c.setFillColor(AUT); c.setFont("Helvetica-Bold", 11)
    c.drawString(40, PH - 40, f"{i:02d}  ·  DropshipPilot")
    c.setFillColor(colors.white); c.setFont("Helvetica-Bold", 17)
    c.drawString(40, PH - 64, title)
    c.setFillColor(MUT); c.setFont("Helvetica", 10.2)
    words, line, y = desc.split(), "", PH - 82
    for w in words:
        if c.stringWidth(line + " " + w, "Helvetica", 10.2) > PW - 80:
            c.drawString(40, y, line); y -= 13; line = w
        else:
            line = (line + " " + w).strip()
    c.drawString(40, y, line)

    img = Image.open(p)
    max_w, max_h = PW - 80, PH - 132
    scale = min(max_w / img.width, max_h / img.height)
    iw, ih = img.width * scale, img.height * scale
    c.setStrokeColor(colors.HexColor("#1e293b")); c.setLineWidth(1)
    c.roundRect(39, PH - 118 - ih, iw + 2, ih + 2, 6, stroke=1, fill=0)
    c.drawImage(ImageReader(str(p)), 40, PH - 117 - ih, width=iw, height=ih)
    c.showPage()

c.save()
print(f"GALERIA.pdf → {pdf_path.stat().st_size / 1048576:.2f} MB · {len(SHOTS) + 1} páginas")

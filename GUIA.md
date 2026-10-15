# 📍 GUÍA: dónde ves todo esto

No es “solo código en un archivo”. Hay **tres formas** de verlo funcionando, de la más rápida a la más completa.

---

## 1️⃣ La vista previa en vivo (30 segundos, sin instalar nada)

En esta misma conversación tienes un **panel de vista previa** (el recuadro con la etiqueta
`DropshipPilot (Next.js + PostgreSQL + Redis)` y el puerto **3000**). Púlsalo y se abre la
aplicación real dentro de tu navegador.

Es la app completa con PostgreSQL y Redis conectados: puedes navegar, importar productos
y ver la cola de sincronización. **No es una maqueta.**

### Qué ver en cada pestaña

| Pestaña (menú izquierdo) | Qué demuestra | Qué mirar |
|---|---|---|
| **Dashboard** | KPIs y estado general | Ventas/beneficio de 7 días, gráfica, **cola de sync en vivo**, alertas de tiendas con error y de productos agotados, stream de actividad |
| **Importar por URL** | El flujo estrella | Pega una URL de AliExpress (o pulsa un ejemplo) → extrae 3 variantes, 4 fotos HD, 12 reseñas, envíos a España; mueve el **markup** y verás el precio y el beneficio recalcularse al instante; pulsa “Importar” |
| **Productos** | Gestión y sincronización | Tabla con estado de sync por producto, filtros, acciones masivas, interruptor de monitorización 24/7, botón “Sincronizar ahora”. Entra en un producto para ver variantes, imágenes HD, reseñas e historial |
| **Pedidos** | Monitor de envíos | Estados, tracking con enlace de seguimiento, botón “Comprar” (envío al proveedor) y resumen de beneficio |
| **Monitor de sync** | El motor 24/7 | Estado de la cola (en espera/en proceso/completados/fallidos), jobs en vivo, botón de barrido manual, pausa, reintento de fallidos |
| **Proxies y anti-bot** | ⭐ Nuevo | Estado del pool de proxies, **validador con navegador real** (pega tus proxies y los prueba), tabla de proveedores residenciales con precios y la configuración exacta para copiar |
| **Tiendas** | Conexión de tiendas | Conectar Shopify/WooCommerce (valida contra la API real). Con OAuth configurado, Shopify se conecta **con un clic**; sin él, pegando el token. Ver scopes y webhooks |
| **Precios y márgenes** | Reglas de negocio | Las 3 reglas de margen y un simulador que compara todas a distintos costes |
| **Facturación** | Los planes y el cobro | Planes, consumo de créditos y el selector **«¿Quién cobra el pago?»**: Stripe (tu pasarela) o Lemon Squeezy (vendedor legal que liquida el IVA por ti) |
| **Puesta en marcha** | ⭐ Nuevo | **Centro de conexión**: 15 piezas del sistema comprobadas en vivo, con la variable exacta a pegar y el enlace a cada pantalla |
| **Configuración** | Ajustes personales y ayuda | 4 pasos de despliegue, variables de entorno, **segundo factor (2FA)**, **avisos por correo**, estado del sistema los avisos de **primeros pasos** (apagables como los demás), **«Ayuda y tutorial guiado»** (volver a ver el recorrido, con la lista de sus 12 pasos) y **«Tus datos y tu cuenta»**: descargar todo en JSON y borrar la cuenta |
| **Administración** | ⭐ Nuevo (sólo operador) | Métricas globales de la plataforma (clientes, MRR estimado, tiendas, productos, actividad 24 h) y acciones de soporte por cliente: plan, créditos, rol, verificar correo |

> En la cabecera de cada página tienes el botón **“Sistema operativo / N servicios”**: despliégalo
> y ves en verde/ámbar el estado real de PostgreSQL, Redis, el servicio de scraping y Stripe.

---

## 2️⃣ Los archivos del workspace

En el panel de archivos de esta conversación (carpeta `autods-clone`):

| Archivo | Para qué sirve |
|---|---|
| **`README.md`** | Documentación completa: arquitectura, módulos, API, motor de precios, despliegue |
| **`VERIFICATION.md`** | El informe de pruebas con la evidencia real (qué se probó, qué salió y qué bugs se corrigieron) |
| **`GUIA.md`** | Este archivo |
| **`PAGOS.md`** | Cómo cobrar en España sin ser autónomo: opciones legales, comisiones, caso Cuba y plan por fases |
| **`PRODUCCION.md`** | Auditoría honesta: qué está verificado, qué necesitas tú y qué falta de verdad para vender el servicio |
| `prisma/schema.prisma` | Los 15 modelos de base de datos con comentarios |
| `src/lib/` | El cerebro: precios, Shopify, WooCommerce, scraper, cola, cifrado |
| `workers/` | El motor 24/7 (sincronización y pedidos) |
| `services/scraper/` | El microservicio de scraping en Python (con su propio README) |
| `.env.example` | Todas las variables configurables, documentadas |

---

## 3️⃣ En tu propio ordenador (control total)

```bash
# 1. Descarga la carpeta del proyecto desde este workspace
# 2. En la raíz del proyecto:
npm install
cp .env.example .env.local      # y pega ahí tus credenciales

# 3a. Modo demo (sin nada más): panel + datos de ejemplo
npm run dev                     # → http://localhost:3000

# 3b. Modo real (recomendado): base de datos + workers
docker compose up -d            # PostgreSQL + Redis + scraper service
npm run prisma:push && npm run prisma:seed
npm run worker                  # motor 24/7 en segundo plano
npm run dev
```

Con Docker levantado también tienes **Prisma Studio** (`npm run prisma:studio`) para ver y editar
las tablas como si fuera un Excel, y el microservicio de scraping en `http://localhost:8000/docs`
(documentación interactiva de sus endpoints).

---

## ✅ Cómo saber que funciona de verdad

```bash
npm run verify:e2e
```

Ejecuta 20 comprobaciones contra tu propia infraestructura y te dice en verde/rojo si:
el agotado automático funciona, si la reactivación funciona, si recalcula precios,
si los webhooks rechazan firmas falsas, etc. (Requiere `npm run worker:sync` en otra terminal.)

---

## 🔌 Proxies residenciales: qué necesitas hacer tú

**No puedo contratarlos yo** (requieren cuenta y pago). Lo que ya está hecho:

1. **La infraestructura completa**: soportes para Bright Data, Oxylabs, Smartproxy, IPRoyal y Webshare.
   Tú sólo pegas usuario/contraseña; la plataforma genera el pool rotativo con país y sesión.
2. **El validador**: la pestaña *Proxies y anti-bot* prueba cada proxy con un navegador real
   (IP de salida, latencia y si el proveedor lo bloquea). También puedes validar por terminal:

```bash
POST /api/proxies   # desde la propia UI, o:
curl -X POST localhost:8000/proxies/test -H 'Content-Type: application/json' \
  -d '{"proxies":["http://user:pass@brd.superproxy.io:33335"]}'
```

3. **La configuración exacta** para copiar, en la propia página.

**Lo que haces tú**: crear cuenta en un proveedor residencial, copiar sus credenciales al `.env.local`
y reiniciar el scraper. Coste realista para dropshipping: **~2-5 GB/mes ≈ 20-40 $**.

**Alternativa sin proxies (más barata y estable)**: las APIs oficiales — AliExpress Open Platform
(gratuita con afiliación) y CJ Dropshipping (ya implementada en el extractor `cj.hybrid_v1`,
sólo falta la clave `CJ_API_KEY`). Los extractores de scraping quedan como respaldo.

---

## ⭐ Lo nuevo (octubre 2026)

| Función | Qué resuelve |
|---|---|
| **Cobrar sin darte de alta como autónomo** | Lemon Squeezy actúa como vendedor legal: emite facturas y liquida el IVA de cada país. Integrado y verificado |
| **Conectar Shopify en un clic** | OAuth: el cliente autoriza y la tienda queda conectada, sin fabricar tokens |
| **Avisos por correo** | Te enteras de fallos de sync, productos agotados y webhooks rechazados sin mirar el panel. Salen por tu propio buzón (SMTP) o por Resend |
| **Panel de administración** | Si vendes el servicio a otros, ves tus clientes, su consumo y les ajustas plan o créditos |
| **Correos que acompañan** | Te dan la bienvenida con la lista de lo que hay que hacer y, si te quedas a medias, te recuerdan **una sola vez** lo que te falta. Nunca insisten |
| **Lista de primeros pasos** | En la portada, 5 tareas que se van marcando solas según lo que haces (conectar tienda, importar, el robot…). Cuando están todas, desaparece |
| **Tutorial del operador** | Si eres tú quien vende el servicio, la zona de Administración tiene su propio recorrido corto de 5 pasos |
| **Tutorial que te lleva de la mano** | La primera vez que entras, la plataforma te ofrece enseñarte las 12 pestañas y te va señalando dónde tocar. Si lo cierras, no vuelve a salir; puedes recuperarlo en *Configuración → Ayuda* |
| **Copias de seguridad que se restauran** | Cada madrugada se guarda una copia comprimida de la base de datos y se comprueba que se puede restaurar (comparando las tablas). Si algo se rompe, se recupera |
| **Descargar tus datos y borrar tu cuenta** | En *Configuración* el cliente se lleva todo en un JSON con un clic, y puede borrar su cuenta entera desde el panel. Sin escribir a nadie, como exige el RGPD |
| **Pruebas automáticas en el despliegue** | Cada despliegue comprueba por HTTP que la app y sus webhooks responden antes de darse por bueno |

## 🧭 Resumen en una línea

- **Ver la app** → vista previa aquí arriba, pestaña por pestaña.
- **Ver el código y la documentación** → archivos del workspace (`README.md`, `VERIFICATION.md`).
- **Ejecutarlo en tu máquina** → `npm install && npm run dev` (o con `docker compose up -d` y `npm run worker`).
- **Proxies** → tú aportas las credenciales; el resto (rotación, validación, cooldown, reintentos) ya está construido y probado.
- **Tutorial de bienvenida** → sale solo la primera vez (o desde *Configuración → Ayuda*); se puede saltar y no molesta más.
- **Copias y derechos del cliente** → se hacen solas: copia diaria de la base de datos (comprobada restaurando) y botones de descargar/borrar datos en *Configuración*. Comprobar con `npm run verify:gdpr`.


---

## Catálogo de productos (`/catalog`) — la pantalla de la que vive el negocio

Es lo primero que debería ver un cliente al entrar. Se navega mirando:

1. **Categorías con imagen** en el carrusel superior → un clic y filtras por esa categoría.
2. **Buscador** (con sugerencias según escribes) o **filtros**: proveedor, almacén de salida, rango
   de coste, valoración mínima, sólo envío gratis, sólo tendencias.
3. En cada tarjeta ves el **coste del proveedor**, **tu precio de venta** y **tu beneficio por
   unidad** (con tu regla de margen, la de *Precios y márgenes*).
4. **Ver ficha** abre el detalle (galería, variantes, envío, descripción) y desde ahí **Importar**:
   eliges tienda, estado (borrador o publicado) y, si quieres, un margen distinto sólo para esa
   importación. Cuesta 2 créditos, igual que importar por URL.
5. Al terminar, el producto ya está en *Gestión de productos* y el worker lo vigila (precio y
   stock) según tu plan.

Las tarjetas con etiqueta **MUESTRA** son de ejemplo: sirven para explorar y probar todo el flujo.
Desaparecen solas en cuanto el operador carga las claves reales de la plataforma (entonces verás
«Catálogo real»). Tú no tienes que configurar ninguna clave.

> ¿Eres el operador del servicio? Las claves se ponen una sola vez en **Administración → Claves de
> proveedor** y las usan todos los clientes. Ver [`CATALOGO.md`](./CATALOGO.md).

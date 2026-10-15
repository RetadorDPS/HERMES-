# DropshipPilot — Clon full-stack de AutoDS (dropshipping automatizado)

Plataforma SaaS completa de automatización de dropshipping, construida con **Next.js 14 + TypeScript + Prisma + PostgreSQL + BullMQ/Redis + FastAPI/Playwright**.

Extiende información completa de productos de **AliExpress, Amazon, CJ Dropshipping, Alibaba y Temu** (variantes, stock, imágenes HD, reseñas y envíos), los publica en **Shopify y WooCommerce**, y mantiene precio y stock sincronizados **24/7** con una cola de workers que además envía los pedidos al proveedor de forma automática.

---

## Catálogo de productos listo para importar

La plataforma sirve su **propio catálogo**: el cliente entra en `/catalog` y encuentra categorías
con imagen, buscador, filtros (precio, almacén, envío gratis, tendencias, valoración), su precio
de venta y su beneficio por unidad, y un botón de importación que publica el producto con la misma
regla de margen y los mismos 2 créditos que la importación por URL.

**Ningún cliente configura claves**: el operador pega una vez las de AliExpress y CJ en
*Administración → Claves de proveedor* (cifradas) y las usan todos. Sin claves, el catálogo
funciona en **modo muestra** etiquetado. Detalles, variables y estado de verificación:
[`CATALOGO.md`](./CATALOGO.md).

```bash
npm run worker:catalog     # worker de descarga del catálogo
npm run seed:catalog       # descarga inmediata a mano
npm run verify:catalog     # 58 comprobaciones (índice, filtros, importación, claves, cuotas,
                           # y el contrato con CJ/AliExpress probado a nivel de red)
```

## ⚡ Arranque rápido

¿Quieres verlo funcionando de una sola orden? Este script levanta **todo**
(PostgreSQL → Redis → microservicio de scraping → web → workers 24/7), comprueba
cada pieza, es idempotente y te dice la URL donde mirar:

```bash
./scripts/start-everything.sh            # arranca lo que falte y resume el estado
./scripts/start-everything.sh --rebuild  # además recompila la web
```

Manualmente, paso a paso:

```bash
# 1. Dependencias
npm install

# 2. Infraestructura (PostgreSQL + Redis + scraper service con Chromium)
docker compose up -d

# 3. Esquema de base de datos + datos de prueba
cp .env.example .env          # rellena DATABASE_URL y REDIS_URL
npm run prisma:push
npm run prisma:seed

# 4. Motor 24/7 (BullMQ)
npm run worker                # sync + orders (lee .env.local automáticamente)

# 5. Dashboard
npm run dev                   # http://localhost:3000
```

> **Modo demo automático:** si no defines `DATABASE_URL`, la aplicación arranca igualmente con un dataset sintético en memoria (14 productos, 3 proveedores, 2 tiendas, 34 pedidos, 140 logs de sync). Todo el panel es navegable y el importador funciona con extracción demo determinista, así puedes explorar la plataforma sin infraestructura.

---

## ✅ Estado verificado (15/10/2026)

Probado con **PostgreSQL 17 + Redis 8 + Chromium (Playwright) reales**, no solo en modo demo:

```bash
npm run worker:sync     # terminal 1 · motor 24/7
npm run verify:e2e      # terminal 2 · 20 comprobaciones end-to-end
```

Incluye la verificación de las dos reglas críticas del motor (agotado automático y reactivación),
el recálculo de precio por cambio de coste, el salto rápido sin cambios (16 ms) y el rechazo de
webhooks con firma inválida. Detalle completo en **[VERIFICATION.md](./VERIFICATION.md)**.

> ⚠️ **Sobre el scraping real:** AliExpress bloquea las IPs de datacenter (comprobado en vivo: el
> servicio detecta la página anti-bot y devuelve `BLOCKED`). Para extracción real configura
> `PROXY_LIST` con proxies residenciales o usa las APIs oficiales (AliExpress Open Platform, CJ API).
> Sin proxies, la cascada cae al modo demo **etiquetando el resultado como tal** — nunca inventa
> datos en silencio.

---

## 🧱 Arquitectura

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│  Dashboard Next.js 14       │        │  Scraper Service (FastAPI)   │
│  App Router · shadcn/ui     │◄──────►│  Playwright + stealth        │
│  Server Components + API    │  HTTP  │  Rotación de proxies         │
└──────────┬──────────────────┘        │  Extractores por proveedor   │
           │                            └──────────────────────────────┘
           │ Prisma                                 ▲
           ▼                                        │
   ┌───────────────┐        ┌───────────────┐        │
   │ PostgreSQL 16 │        │  Redis 7      │        │
   │ 15 tablas     │◄──────►│  BullMQ       │────────┘
   └───────────────┘        └───────┬───────┘
                                    │ jobs
                        ┌───────────▼────────────┐
                        │  Workers 24/7          │
                        │  syncWorker (1 h)      │
                        │  orderWorker (pedidos) │
                        └───────────┬────────────┘
                                    │ GraphQL / REST
                        ┌───────────▼────────────┐
                        │  Shopify Admin API     │
                        │  WooCommerce REST v3   │
                        └────────────────────────┘
```

### Capas

| Capa | Tecnología | Ubicación |
|---|---|---|
| Frontend + API | Next.js 14 (App Router), TypeScript, Tailwind, shadcn/ui, Recharts, Lucide | `src/app`, `src/components` |
| Dominio | Precios/márgenes, tipos, cifrado, clientes de tienda | `src/lib` |
| Base de datos | PostgreSQL + Prisma (15 modelos) | `prisma/schema.prisma` |
| Scraping | Python 3 + FastAPI + Playwright + rotación de proxies | `services/scraper` |
| Workers | BullMQ + Redis (Node/TS) | `workers/` |
| IA/Compliance | Verificación HMAC de webhooks, cifrado AES-256-GCM de tokens | `src/lib/crypto.ts` |

---

## ✨ Cobros, avisos y operación

- **Dos formas de cobrar**: Stripe (pasarela propia) y **Lemon Squeezy** (vendedor legal que liquida el IVA por ti:
  útil para empezar sin alta de autónomo — ver `PAGOS.md`). El panel de facturación deja elegir y explica requisitos y comisiones.
- **Conectar tiendas en 1 clic**: instalación por **OAuth de Shopify** (el cliente autoriza y listo) además del token manual.
- **Avisos por correo** al cliente: fallos de sincronización, cambios de stock, webhooks con firma inválida y problemas de pago.
  Salen por **tu propio buzón** (SMTP, sin dependencias ni servicio de pago) o por Resend; incluyen el enlace de verificación de cuenta.
- **Panel de administración** (`/admin`, sólo operadores): métricas globales, MRR estimado y acciones de soporte por cliente
  (plan, créditos, rol, verificar correo). Se activa con `npm run admin -- tu@correo.com`.
- **Copias de seguridad que se restauran de verdad**: cada día a las `BACKUP_HOUR` (4:00 por defecto) el worker
  vuelca la base de datos comprimida en `backups/`, comprueba la integridad del volcado y borra las que superan
  la retención (14 días, conservando siempre 3). Con `BACKUP_VERIFY=true` además **restaura cada copia en una base
  temporal y compara las tablas clave** antes de darla por buena. Manual: `npm run backup -- --verify`.
- **Acompañamiento al entrar (tutorial guiado)**: la primera vez que alguien entra ve una tarjeta — *«¿Te enseño la plataforma en 12 pasos?» —*
  y, si acepta, la app lo lleva **pestaña por pestaña** resaltando dónde tocar en cada una (catálogo, importar, productos, pedidos, monitor 24/7, precios,
  tiendas, proxies, facturación y puesta en marcha). Se sale con Escape o con «Saltar el tutorial», y la decisión **se guarda en la cuenta**, no en el
  navegador: quien lo cierre o lo salte no lo vuelve a ver. Desde *Configuración → Ayuda y tutorial guiado* se puede volver a ver cuando quiera.
- **Acompañamiento por correo**: el alta manda la **bienvenida con la lista de primeros pasos** (cada uno con su enlace), no un «confirma tu cuenta»
  a secas. Y si a las 24 h el cliente sigue con tareas pendientes, recibe **un único recordatorio** con lo que le falta (`workers/onboardingWorker.ts`).
  Nunca insiste, no escribe a quien ya terminó, y se apaga por tipo desde *Configuración → Avisos por correo* (o del todo con `ONBOARDING_EMAILS=false`).
- **Primeros pasos que se marcan solos**: en la portada, una lista de 5 tareas (hacer el recorrido, conectar la tienda, importar el primer producto,
  dejar que el robot vigile, elegir cómo cobrar) que se marca **leyendo los datos reales**: en cuanto la tienda conecta o el worker sincroniza, la
  casilla se pone verde. Cuando están las cinco, la tarjeta desaparece sola; el cliente también puede ocultarla y recuperarla en *Configuración → Ayuda*.
- **Recorrido del operador**: quien tiene rol `ADMIN` tiene su propio tutorial de 5 pasos por *Administración* (métricas, clientes, claves de
  proveedor, catálogo y lo que se mantiene solo), independiente del recorrido del cliente.
- **Derechos del cliente sin escribir a nadie**: en *Configuración → Tus datos y tu cuenta* el cliente descarga
  todo lo que guardamos de él (`/api/account/export`, JSON) y puede borrar su cuenta entera desde el panel
  (`DELETE /api/account`, con confirmación escrita y contraseña). El borrado cancela antes la suscripción,
  arrastra tiendas, productos, pedidos, reglas, cuentas de proveedor e historial, y deja en la auditoría un
  registro anonimizado de que se atendió la petición.
- **Pruebas automáticas en el despliegue**: `npm run smoke` (HTTP) y `npm run preflight` (credenciales) se ejecutan solas en `scripts/deploy.sh`.

## 🚀 Puesta en marcha: sólo conectar

Todo lo que hay que conectar está concentrado en dos sitios:

- **En el panel**: `/setup` («Puesta en marcha») comprueba **en vivo** base de datos, Redis,
  microservicio de scraping, Stripe, correo, cifrado, sesiones, webhooks, proxies, tiendas y
  APIs de proveedor. Cada pieza indica la variable exacta a pegar, cómo conseguirla y el enlace
  a la pantalla donde se configura.
- **En la terminal**: `npm run preflight` hace la misma comprobación en consola y devuelve
  código de salida 1 si falta algo bloqueante (útil en el despliegue y en CI).

De las piezas que quedan, **dos ya funcionan solas** sin contratar nada:

- **Correo**: con `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER` y `SMTP_PASS` de tu propio buzón
  (Gmail, Zoho, tu hosting…) los avisos y los enlaces de verificación salen de verdad. Para verlos
  en tu ordenador antes de decidirte: `npm run mail:dev-server` (los guarda en `logs/mail-out/`).
- **Cambio de divisa**: las tasas se descargan del Banco Central Europeo cada 12 h (gratis, sin
  clave). `FX_RATES` sólo hace falta si quieres fijarlas a mano.

```bash
npm run preflight          # ¿qué falta para operar?
npm run smoke              # ¿responde la app desplegada? (webhooks incluidos)
npm run mail:dev-server    # buzón de pruebas local para ver los correos
npm run fx:refresh         # descargar los tipos de cambio ahora mismo
npm run stripe:setup --key=sk_test_…   # crea los 6 precios y escribe el .env.local
npm run admin -- tu@correo.com         # darte de operador para abrir /admin
npm run verify:lemon       # prueba el cobro con Lemon Squeezy de punta a punta
npm run watchdog           # estado de salud ahora mismo (--avisar para correo al operador)
```

El motor 24/7 late cada 15 minutos y re-verifica **sólo** los productos que ya han cumplido la
frecuencia de su plan (30/60/120/360 min, lo que muestra la página de Precios); además ejecuta la
**vigilancia del sistema** y avisa por correo a los operadores si la base de datos, Redis, las colas,
el microservicio de scraping o la sincronización se degradan.

Documentos de referencia: `PAGOS.md` (cómo cobrar en España sin ser autónomo),
`PRODUCCION.md` (auditoría honesta), `VERIFICATION.md` (evidencia), `DEPLOY.md` (despliegue).

## 🏢 Modo SaaS: varios clientes en el mismo servidor

El producto está preparado para venderse como servicio. Cada cliente ve **sólo
sus datos**, y eso no depende de que cada consulta se acuerde de filtrar:

- **Aislamiento en la capa de Prisma** (`src/lib/tenant-context.ts` +
  `src/lib/tenant-prisma.ts`): `withTenant(userId, …)` para peticiones y jobs,
  `withSystem(motivo, …)` para lo global (catálogo de proveedores, barridos).
  Si falta el contexto, la consulta **falla** en lugar de devolver datos ajenos.
- **Cuentas**: registro, verificación por correo, recuperación de contraseña,
  sesiones NextAuth, auditoría en `AuditLog` y freno a la fuerza bruta en el login.
- **Planes y créditos** (`src/lib/plans.ts`, `src/lib/credits.ts`): límites de
  productos, tiendas y cuentas de proveedor; créditos por operación (extraer 1,
  importar 2, sincronizar 1, comprar 3). Al agotarse: **402** con motivo.
- **Cobro con Stripe** (`src/lib/stripe.ts`): checkout, portal de cliente y
  webhook con verificación de firma que actualiza el plan y reinicia créditos.
- **Conexión con las APIs oficiales de proveedores** (`src/lib/supplier-apis/`):
  AliExpress Open Platform, CJ Dropshipping y Amazon PA-API. Credenciales
  cifradas (AES-256-GCM), prueba contra la API real desde la UI y uso en el
  worker de pedidos para **comprar de verdad**. Alibaba y Temu no ofrecen API
  pública: quedan por scraping con proxies.

### Probar el multi-cliente

```bash
npm run seed:demo          # dos clientes independientes con datos propios
npm run verify:isolation   # 13 comprobaciones de aislamiento contra la BD real
npm run verify:credits     # 6 comprobaciones de planes, límites y créditos
npm run verify:2fa         # 16 comprobaciones del segundo factor (TOTP, RFC 6238)
npm run verify:backup      # vuelca, restaura en una BD temporal y compara 11 tablas
npm run verify:load        # 300 peticiones con 25 en paralelo: latencias y errores
```

### Seguridad de las cuentas

- **2FA (TOTP)** activable desde *Configuración*, con QR y códigos de recuperación de un solo uso;
  el login exige el código cuando está activo. Secreto cifrado y códigos hasheados.
- **Freno a la fuerza bruta** en el login (10 intentos / 15 min por IP+email).
- **Páginas legales** en `/privacy`, `/terms` y `/cookies` (plantillas: rellena tus datos y revísalas).

| Cliente | Correo | Contraseña | Plan |
|---|---|---|---|
| A | `demo@dropshippilot.io` | `DemoPanel123` | PRO (6 productos, 10 pedidos) |
| B | `cliente@dropshippilot.io` | `ClienteDemo123` | STARTER (2 productos, 1 tienda) |

Entra con cada uno y verás que no comparten nada. En producción, pon
`AUTH_ENABLED="true"` y `REQUIRE_EMAIL_VERIFICATION="true"` (el
`docker-compose.prod.yml` ya lo hace).

## 📦 Módulos implementados

### 1. Base de datos (`prisma/schema.prisma`)

Modelos relacionales con índices, enums y cascadas:

- **User** / **Subscription** — clientes SaaS, planes (TRIAL/STARTER/PRO/ENTERPRISE), créditos y estado de Stripe.
- **PricingRule** — reglas de margen por usuario: markup %, fee fijo, beneficio mínimo, límites min/max, redondeo psicológico, aplicación por categoría, inclusión del envío.
- **Supplier** — AliExpress, CJ, Amazon, Alibaba, Temu: API keys cifradas, pool de proxies, rate limit, config del extractor.
- **Store** — Shopify/WooCommerce con tokens cifrados, scopes, estado, webhook secret y settings JSON.
- **Product** — contenido, precios de coste/venta, margen, stock, métricas del proveedor, estado de sync (`providerHash`, `lastSyncedAt`, `nextSyncAt`, `lastSyncStatus`) y payload crudo del scraper.
- **ProductVariant** — SKU, opciones (color/talla/material), precio, stock, imagen, peso, ID en tienda.
- **ProductImage** — URL + versión HD, orden y flag de imagen principal.
- **ProductReview** — estrellas, autor, país, texto, imágenes, votos útiles, fecha.
- **Order** / **OrderItem** — pedido con dirección, importes, coste del proveedor, beneficio, tracking y estado de fulfillment.
- **SyncLog** — auditoría completa: tipo, estado, nivel, diff before/after, duración, intento, jobId.
- **SyncJob** — espejo en BD de la cola BullMQ para poder pintarla sin Redis.
- **WebhookEvent** — deduplicación e idempotencia de webhooks entrantes.
- **ShippingQuote** — caché de tarifas de envío por destino.

Incluye migración inicial generada en `prisma/migrations/20260101000000_init/migration.sql` (584 líneas de SQL).

### 2. Motor de scraping (`services/scraper` + `src/lib/scraper.ts`)

**Microservicio Python (FastAPI + Playwright):**

| Endpoint | Uso |
|---|---|
| `POST /scrape` | Extracción completa de la PDP: variantes, stock, imágenes HD, envíos por país y reseñas |
| `POST /scrape/price` | Comprobación ligera precio+stock (ruta rápida de los workers) |
| `POST /scrape/bulk` | Hasta 25 URLs en paralelo |
| `GET /health` | Estado del navegador, proxies y concurrencia |
| `GET /proxies` | Salud del pool de proxies (score, cooldown, últimos errores) |

- **Extractores especializados**: `aliexpress.pdp_v2` (payload `window._dida_config_` + fallback DOM), `amazon.pdp_v3` (JSON-LD + twister de variaciones + reseñas), `cj.hybrid_v1` (API oficial con fallback DOM).
- **Anti-bot**: stealth patches (`navigator.webdriver`, WebGL, permisos), User-Agent rotativo, bloqueo de trackers/fuentes (−40% de tiempo), gestos humanos (ratón/scroll), detección de captcha con error `BLOCKED` para forzar rotación de IP.
- **Rotación de proxies** (`proxy_manager.py`): round-robin/random/sticky con *score* por proxy y cooldown automático a los 3 fallos.
- **Reintentos**: 3 intentos con backoff exponencial y proxy nuevo por intento.
- **Cliente TypeScript** (`src/lib/scraper.ts`) con cascada `service → local (fetch + JSON-LD) → demo`, validación/normalización de URL, listas de dominios soportados y enriquecimiento a imágenes HD por CDN.

**Contrato de salida (`ScrapedProduct`)** — idéntico en las tres rutas:

```json
{
  "title": "...", "description": "...", "category": "...",
  "images": [{ "url": "...", "hdUrl": "..." }],
  "variants": [{ "supplierVariantId": "...", "sku": "...", "color": "...", "size": "...",
                 "price": 12.4, "stock": 410, "imageUrl": "..." }],
  "shipping": { "options": [{ "method": "...", "cost": 1.8, "minDays": 12, "maxDays": 20, "isTracked": true }],
                "cheapestCost": 0, "fastest": {}, "shipsTo": ["ES","FR"] },
  "reviews": [{ "rating": 5, "author": "Lucía M.", "text": "...", "date": "...", "images": [] }],
  "ratingAvg": 4.8, "ratingCount": 3421, "stockTotal": 842,
  "warnings": [], "extractionMeta": { "mode": "service", "proxyUsed": "...", "attempts": 1 }
}
```

### 3. Integración Shopify (`src/lib/shopify.ts`)

GraphQL Admin API **2025-01**, con clamping de rate limit (`THROTTLED` + backoff) y modo simulado cuando el token es de demo:

- `connectStore(shopUrl, accessToken)` — valida la tienda, devuelve plan, moneda, dominio y **scopes faltantes**.
- `publishProduct(store, productData)` — crea producto + opciones + variantes + metafields (`supplier_url`, `cost_price`…) + galería, y fija el stock de cada `inventoryItem`.
- `updateInventory(...)` — ajuste de stock en tiempo real; si el stock llega a 0 **despublica** el producto (regla del worker).
- `updatePrice(...)` / `updateProductPrices(...)` — precio y precio tachado, individual o en lote.
- `setProductStatus(...)` — ACTIVE/DRAFT/ARCHIVED + etiquetado de agotado.
- `listenOrderWebhook(store, callbackUrl)` — registra `ORDERS_CREATE`, `ORDERS_UPDATED`, `ORDER_FULFILLMENTS_UPDATE`, `PRODUCTS_UPDATE`.
- `parseOrderWebhook(payload)`, `fetchOrders(...)` y `pushTracking(...)` — flujo inverso: pedido entrante, lectura y subida de tracking con aviso al cliente.

### 4. Integración WooCommerce (`src/lib/woocommerce.ts`)

Adaptador REST v3 con la misma interfaz: productos variables + variaciones en batch, stock, precios, webhooks `order.created/updated` y parseo de pedidos.

### 5. Motor de automatización 24/7 (`workers/`)

**`workers/syncWorker.ts`** — cola `sync`:

1. Job repeatable `sync:sweep` cada `SYNC_INTERVAL_MINUTES` (60 por defecto) que encola todos los productos activos y monitorizados, escalonados para no saturar proveedores ni tiendas.
2. `sync:product` re-escanea la URL del proveedor y compara el hash (`minPrice + stock + variantes`).
3. Sin cambios → `SKIPPED` (0 llamadas a la API de la tienda).
4. Cambió el costo → recalcula con la regla del usuario y actualiza la tienda (umbral anti-flapping configurable, 1,5% por defecto).
5. `stock_proveedor === 0` → **marca agotado y despublica inmediatamente**; al recuperar stock, reactiva el producto.
6. Todo queda en **SyncLog** con el diff before/after, la duración, el intento y el proxy usado.

**`workers/orderWorker.ts`** — cola `orders`: envía el pedido al proveedor (`SUPPLIER_PURCHASED` / `SUPPLIER_ERROR`), calcula el beneficio real y programa la consulta del tracking con reintentos y backoff; sube el tracking a la tienda y actualiza el fulfillment.

**Resiliencia:** 3 intentos con backoff exponencial, limitador de 40 jobs/s, arranque tolerante (el worker no muere si el proveedor cae), apagado con gracia por SIGTERM y logs estructurados.

### 6. API HTTP

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/scrape` | Previsualización: extrae producto + precios por cada regla de margen |
| GET/POST | `/api/import` | Importa a la tienda (persistencia + publicación + job de sync) |
| GET/POST | `/api/products` | Listado con filtros + acciones masivas (sync, monitorizar, pausar, borrar) |
| GET/PATCH/POST/DELETE | `/api/products/[id]` | Ficha, edición, sync inmediato, borrado |
| GET/POST | `/api/sync` | Monitor de la cola + acciones (sweep, pausar, reintentar fallidos) |
| GET/POST | `/api/stores` | Tiendas conectadas + alta de credenciales con registro de webhooks |
| POST/DELETE | `/api/stores/[id]/test` | Ping de conexión y desconexión |
| GET/POST | `/api/orders` | Pedidos + envío al proveedor / sincronización de tracking |
| POST | `/api/webhooks/shopify` | Pedidos entrantes (HMAC verificado y deduplicado) |
| GET | `/api/kpis` | KPIs y actividad para el dashboard (polling ligero) |
| GET | `/api/health` | Estado de PostgreSQL, Redis, scraper service y Stripe |

### 7. Tutorial guiado de bienvenida (`src/components/tour/`, `src/lib/tour-steps.ts`)

`GuidedTour` vive en el layout del panel y se monta en todas las pestañas. Pasos definidos en `src/lib/tour-steps.ts`
(12, uno por pestaña) con selectores `data-tour="..."` repartidos por las pantallas. El estado va en `User.tourVersion`:
`0` pendiente · `1` en curso · `2` visto o saltado (si algún día se añaden pasos, se sube `TOUR_VERSION` y vuelve a ofrecerse).
Cada paso navega de verdad con el router y el resaltado es un agujero en la capa oscura que **no bloquea los clics**: el
usuario puede tocar el botón señalado mientras lee. En móvil la burbuja pasa abajo. Decisiones auditadas (`tour.complete`, `tour.dismiss`).

### 8. Acompañamiento del cliente nuevo (`src/lib/onboarding.ts`, `(dashboard)/dashboard/first-steps-card.tsx`)

- **Lista «Tus primeros pasos»**: tareas calculadas en el servidor (`checklistState()`), no marcadas a mano: tienda conectada, producto
  importado, sync correcta, plan de pago y recorrido visto. Es lo que hace que el panel parezca que «alguien te está llevando».
- **Recorrido guiado** (`src/components/tour/`): tarjeta de bienvenida + 12 pasos señalando cada pestaña, con el estado en la cuenta
  (`tourVersion` 0/1/2). El del operador vive en `/admin` y usa las mismas piezas con otros pasos (`adminTourVersion`).

### 9. Correos de acompañamiento (`src/lib/onboarding-mail.ts`, `workers/onboardingWorker.ts`)

| Cuándo | Qué manda | Garantía |
|---|---|---|
| Al darse de alta | Bienvenida + confirmación de cuenta + **los 5 primeros pasos con enlaces** | Se ve en `logs/mail-out/bienvenida-muestra.html` |
| A las 24 h con tareas pendientes | **Un** recordatorio con lo que falta y botón para seguir donde lo dejó | `User.onboardingNudgedAt`: nunca se repite |
| Nunca | A quien ya tiene las 5 tareas hechas, a quien apagó los avisos, o antes de las 24 h | Filtros en la consulta + comprobación de la lista |

Variables: `ONBOARDING_EMAILS` (interruptor general) · `ONBOARDING_NUDGE_HOURS` (24) · `ONBOARDING_SWEEP_HOURS` (6).
Worker propio (`npm run worker:onboarding`) e incluido en `npm run worker`.

### 10. Dashboard (modo oscuro)

- **Dashboard** — KPIs de ventas/beneficio/productos/estado de la cola, gráfica Recharts de 7 días, tiendas, monitor de envíos, top productos por beneficio, alertas operativas y stream de SyncLog.
- **Importar por URL** — pega el enlace (con ejemplos rápidos), previsualiza galería HD, variantes, envíos por país y reseñas; edita título/descripción, ajusta markup con desglose en vivo del precio y el beneficio, elige tienda y estado, e importa (crea producto + publica + programa el primer chequeo).
- **Productos** — tabla con filtros (estado, tienda, orden, sólo problemas), selección múltiple y acciones masivas, toggle de monitorización por producto y botón de sync inmediato; ficha de detalle con variantes, imágenes HD, envíos, reseñas, historial de sync y editor rápido.
- **Pedidos** — monitor de envíos con estados, tracking (copiar/seguir), compra al proveedor y sincronización de tracking, más resumen de beneficio acumulado.
- **Monitor de sync** — estado de la cola (en espera/proceso/completados/fallidos), jobs en vivo, barrido manual, pausa/reanudación, reintento de fallidos, explicación del pipeline y comandos del operador.
- **Tiendas** — conexión validada contra la API real (scopes y webhooks), prueba de conexión con latencia, desconexión segura y estado de proveedores.
- **Precios y márgenes** — catálogo de reglas y simulador por coste del proveedor comparando todas las reglas.
- **Configuración** — puesta en marcha en 4 pasos, referencia de variables de entorno, estado del sistema, stack y buenas prácticas legales/operativas.

---

## 🧮 Motor de precios

```
precio = max( costo × (1 + markup%/100) + feeFijo + envío , costo + beneficioMínimo )
precio = min(max(precio, minPrice), maxPrice)
precio = redondeoPsicológico(precio, 0.99)   →   24,99 en lugar de 25,12
```

**Cambio de divisa** (`src/lib/fx.ts`): el coste y el envío del proveedor se convierten a **EUR**
antes de calcular, con las tasas de `FX_RATES`. AliExpress devuelve EUR, pero CJ y muchas tiendas
devuelven USD: sin convertir, 69 USD se contaban como 69 € y el beneficio mostrado era falso. La
conversión se aplica en la vista previa, en la importación, en la ficha del catálogo y en cada
chequeo del worker 24/7, y el tipo aplicado se muestra («69 USD → 63,48 € (tipo 0.92)»).

Prioridad de reglas: **producto → categoría → predeterminada del usuario**. La actualización en tienda sólo se aplica si la variación supera el umbral configurado, evitando *flapping* de precios.

---

## 🔐 Seguridad

- Tokens de Shopify y credenciales de WooCommerce cifrados con **AES-256-GCM** (`ENCRYPTION_KEY`).
- Webhooks con **verificación HMAC-SHA256** en tiempo constante + deduplicación por `X-Shopify-Webhook-Id`.
- Enmascarado de secretos en la UI y en los logs (`shpat_abcd••••9f2c`).
- Middleware de autenticación opcional (`AUTH_ENABLED=true`) compatible con NextAuth v4; webhooks y health siempre públicos.
- Panel de operador (`/admin`): con autenticación desactivada queda en **sólo lectura** (correos de clientes enmascarados, sin poder cambiar planes, créditos ni claves). Acceso completo sólo con sesión `ADMIN` o con `LOCAL_ADMIN_MODE=true` en una instalación de un único dueño.
- Sanitización de HTML de descripciones (elimina scripts, estilos y manejadores inline).

---

## 🗂 Estructura del proyecto

```
autods-clone/
├── prisma/
│   ├── schema.prisma              # 15 modelos + enums + índices
│   ├── seed.ts                    # datos de prueba realistas
│   └── migrations/…/migration.sql # migración inicial (SQL puro)
├── services/scraper/              # microservicio Python
│   ├── main.py                    # FastAPI: /scrape, /scrape/price, /scrape/bulk
│   ├── browser.py                 # pool de Chromium + stealth + bloqueo de recursos
│   ├── proxy_manager.py           # rotación y health de proxies
│   ├── extractors/                # aliexpress.py · amazon.py · cj.py
│   ├── models.py / config.py      # esquemas Pydantic y settings
│   └── Dockerfile / README.md
├── workers/
│   ├── syncWorker.ts              # motor de precio/stock 24/7
│   ├── orderWorker.ts             # pedidos y tracking automáticos
│   ├── lib.ts                     # utilidades compartidas (Prisma laxo, logs, tiendas)
│   └── index.ts                   # arranque unificado
├── src/
│   ├── app/
│   │   ├── (dashboard)/           # dashboard, import, products, orders, monitor, stores, pricing, settings
│   │   └── api/                  # scrape, import, products, sync, stores, orders, webhooks, kpis, health
│   ├── components/                # ui/ (shadcn), layout/, dashboard/
│   ├── lib/                       # scraper, shopify, woocommerce, pricing, queue, data, demo-data, crypto, types
│   └── middleware.ts
├── docker-compose.yml             # PostgreSQL + Redis + scraper (+ web opcional)
├── Dockerfile                     # imagen multi-etapa del dashboard
└── .env.example
```

---

## ⚙️ Variables de entorno clave

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | PostgreSQL. Sin ella, modo demo en memoria |
| `REDIS_URL` | Cola BullMQ de los workers |
| `SCRAPER_SERVICE_URL` / `SCRAPER_MODE` | Microservicio de scraping y estrategia (`auto`/`service`/`local`/`demo`) |
| `PROXY_LIST` / `PROXY_ROTATION` | Anti-bot: proxies y estrategia de rotación |
| `SHOPIFY_API_VERSION` / `SHOPIFY_WEBHOOK_SECRET` | API y firma de webhooks |
| `ENCRYPTION_KEY` | Clave AES-256-GCM de credenciales |
| `SYNC_INTERVAL_MINUTES` / `SYNC_CONCURRENCY` / `SYNC_PRICE_THRESHOLD_PCT` | Comportamiento del motor 24/7 |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | Correo real con tu propio buzón (587 STARTTLS, 465 TLS). Alternativas: `RESEND_API_KEY` o `MAIL_WEBHOOK_URL` |
| `FX_AUTO` / `FX_REFRESH_HOURS` | Cambio de divisa automático con los tipos del BCE (gratis, sin clave). Con `FX_RATES` fijas las tasas a mano |
| `LOCAL_ADMIN_MODE` | Con `AUTH_ENABLED=false`, deja el panel de operador en **sólo lectura** salvo que pongas `true` (sólo instalaciones de un único dueño; **nunca** en un SaaS abierto) |
| `ALIEXPRESS_API_KEY` / `CJ_API_KEY` | APIs oficiales para comprar los pedidos automáticamente |
| `STRIPE_SECRET_KEY` + `STRIPE_PRICE_*` | Suscripciones SaaS |

Todas documentadas en `.env.example`.

---

## 🛟 Copias de seguridad y derechos del cliente

**Copias** (`src/lib/backup.ts`, `scripts/backup.ts`, `workers/backupWorker.ts`):

```bash
npm run backup               # copia ahora mismo y poda las caducadas
npm run backup -- --verify   # copia + restauración de prueba + comparación de tablas
npm run backup -- --list     # qué copias hay, con tamaño y comprobación de integridad
npm run worker:backup        # worker sólo para copias (si separas cargas)
```

| Variable | Por defecto | Para qué |
|---|---|---|
| `BACKUP_DIR` | `./backups` | Carpeta destino (en producción: volumen aparte del disco de la base) |
| `BACKUP_HOUR` | `4` | Hora del día a la que se hace la copia automática |
| `BACKUP_KEEP_DAYS` | `14` | Días de retención |
| `BACKUP_MIN_KEEP` | `3` | Copias que se conservan siempre, aunque sean más antiguas |
| `BACKUP_VERIFY` | `false` | Restaurar cada copia en una base temporal y comparar filas antes de aceptarla |
| `BACKUP_ENABLED` | `true` | Apagar copias automáticas |

**Derechos RGPD** (`src/lib/account-data.ts`, `src/app/api/account/**`, `(dashboard)/settings/data-rights-card.tsx`):

| Derecho | Cómo se atiende | Límite anti-abuso |
|---|---|---|
| Acceso + portabilidad (art. 15 y 20) | `GET /api/account/export` → JSON con 13 secciones: cuenta, suscripción, tiendas, productos, variantes, pedidos con sus líneas, reglas de precio, cuentas de proveedor, historial de sync y registro de accesos. Credenciales **enmascaradas** | 3/hora |
| Supresión (art. 17) | `DELETE /api/account` con `{"confirm":"BORRAR MI CUENTA"}` (+ contraseña si la cuenta la tiene). Cancela Stripe/Lemon, borra en cascada y **verifica que no queda residuo** | 5/hora |

Ambas cosas quedan en la auditoría (`account.exported`, `account.deleted`). El registro del borrado conserva
la fecha, el correo y el motivo — nada más — para poder demostrar que se atendió la petición (ver `DPA.md`).

## 📊 Estado y escalabilidad

- **[`ESTADO.md`](./ESTADO.md)** — qué está probado (con sus números), qué está construido pero **no** se ha
  probado contra servicios reales, qué no está hecho todavía y qué se puede afirmar sin reservas.
- **[`ESCALABILIDAD.md`](./ESCALABILIDAD.md)** — capacidad medida (`npm run loadtest`), los cuatro puntos que
  hay que tocar antes de 100+ clientes y la escalera de costes de servidor por tramos.

## 🧪 Verificación

```bash
npm run verify:e2e        # ciclo completo: importación → worker 24/7 → tienda
npm run verify:catalog    # catálogo y claves de plataforma (58 comprobaciones)
npm run verify:fx         # cambio de divisa: descarga del BCE, catálogo, ficha y precio
npm run verify:mail       # correo real: SMTP, STARTTLS, acentos, multipart (servidor de prueba)
npm run verify:admin      # panel del operador y puerta de permisos
npm run verify:gdpr       # copias restaurables + exportación y borrado de cuenta (44 comprobaciones)
npm run verify:tour       # tutorial de bienvenida: pasos, estados y API (23 comprobaciones)
npm run verify:onboarding # primeros pasos + recorrido del operador (29 comprobaciones)
npm run verify:onboarding-mail # correos de acompañamiento: bienvenida y recordatorio único (34)
npm run preflight         # qué falta por conectar (0 bloqueantes = operativo)
npm run loadtest          # capacidad real: latencias, base de datos y caudal de la cola
```

Verificación rápida del importador, sin infraestructura:

```bash
npm run dev
# Importar un producto (extracción demo instantánea)
curl -X POST localhost:3000/api/scrape -H 'Content-Type: application/json' \
  -d '{"url":"https://es.aliexpress.com/item/1005006123456789.html","country":"ES"}'

# Monitor de la cola
curl localhost:3000/api/sync
# Estado de servicios (PostgreSQL, Redis, scraper, Stripe)
curl localhost:3000/api/health
```

---

## 🗺 Roadmap sugerido

1. **APIs oficiales como ruta primaria** (AliExpress Open Platform, CJ API) dejando Playwright como fallback.
2. Auto-pedido real con las credenciales del cliente y conciliación de pagos.
3. Traducción automática de títulos/descripciones a los idiomas de la tienda (DeepL/Google).
4. Repricing dinámico por competencia (scraping de la propia tienda y comparadores).
5. Alertas por Slack/Telegram de quiebres de stock y errores de proveedor.
6. Suscripciones Stripe con límites de créditos por plan y portal de cliente.
7. Test A/B de precios y bundles automáticos por categoría.

---

## ⚖️ Nota legal

Antes de operar con proveedores reales: respeta sus términos de servicio y su `robots.txt`, prioriza APIs oficiales, limita la tasa de peticiones y protege los datos de tus clientes. Este proyecto es una base técnica; la responsabilidad del uso comercial es de quien lo despliega.

---

## 🚀 Despliegue

**Un solo comando** en tu servidor (HTTPS de Let's Encrypt, workers 24/7 y copias diarias incluidos):

```bash
./scripts/deploy.sh          # pide dominio + credenciales y despliega todo
./scripts/deploy.sh --estado # salud y estado de los servicios
```

Guía completa: **[`DEPLOY.md`](DEPLOY.md)** · Prompt listo para Claude Code: **[`PROMPT_DESPLIEGUE.md`](PROMPT_DESPLIEGUE.md)**

Resumen:

```bash
# Docker: base de datos + Redis + scraper + web + workers
docker compose --profile full up -d --build
npx prisma db push && npm run prisma:seed
```

Los cuatro procesos que debe haber en producción: **web** (Next.js), **worker** (24/7),
**scraper** (FastAPI/Playwright, nunca expuesto a internet) y **PostgreSQL + Redis**.

---

## 💳 Configurar el cobro (Stripe)

1. Crea los precios en Stripe (mensual y anual) para cada plan y copia sus ids:

```bash
STRIPE_SECRET_KEY="sk_live_…"
STRIPE_WEBHOOK_SECRET="whsec_…"
STRIPE_PRICE_STARTER_MONTHLY="price_…"
STRIPE_PRICE_STARTER_YEARLY="price_…"
STRIPE_PRICE_PRO_MONTHLY="price_…"
STRIPE_PRICE_PRO_YEARLY="price_…"
STRIPE_PRICE_ENTERPRISE_MONTHLY="price_…"
STRIPE_PRICE_ENTERPRISE_YEARLY="price_…"
```

2. Configura el webhook en Stripe → Developers → Webhooks apuntando a
   `https://tudominio.com/api/webhooks/stripe` con los eventos
   `checkout.session.completed`, `customer.subscription.created|updated|deleted`
   e `invoice.paid`. `GET /api/webhooks/stripe` te dice la URL exacta que toca.
3. Sin claves, el panel lo indica y puedes asignar planes a mano en la base de datos.

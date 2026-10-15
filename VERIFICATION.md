# Informe de verificación — DropshipPilot

Ejecutado el **14/10/2026** sobre esta instalación, con infraestructura real:
**PostgreSQL 17.9**, **Redis 8.0**, **Chromium 141 (Playwright)** y **Node 20.20**.

Comando reutilizable: `npm run verify:e2e` (requiere `npm run worker:sync` en otra terminal).

---

## 1. Matriz de resultados

| # | Área | Prueba | Resultado |
|---|---|---|---|
| 1 | Base de datos | `prisma db push` crea las 15 tablas + 12 enums | ✅ 15 tablas |
| 2 | Base de datos | `prisma:seed` siembra datos | ✅ 1 usuario, 3 proveedores, 2 tiendas, 6 productos, 11 variantes, 18 reseñas, 6 pedidos, 60 logs |
| 3 | App | `next build` + `tsc --noEmit` | ✅ compila sin errores |
| 4 | App | 8 páginas del dashboard responden | ✅ todas 200 |
| 5 | API | `/api/health` (Postgres/Redis/scraper) | ✅ 3/3 servicios OK |
| 6 | Scraping | Microservicio FastAPI arranca | ✅ `browser_ready: true`, v1.4.0 |
| 7 | Scraping | Extracción real de AliExpress en vivo | ⚠️ **BLOQUEADO por AliExpress** (IP de datacenter) — detectado y reportado correctamente |
| 8 | Scraping | Cascada `service → local → demo` | ✅ cae a demo en 4,5 s **etiquetando** el resultado como demo (no inventa datos en silencio) |
| 9 | Cola | Worker BullMQ conectado y escuchando | ✅ 1 worker, `sync` |
| 10 | Cola | Barrido programado cada 60 min | ✅ `sync:sweep` registrado + barrido de arranque |
| 11 | **Worker** | **Regla de agotado**: proveedor sin stock | ✅ stock 156 → 0, estado `ACTIVE` → `OUT_OF_STOCK`, despublicado en tienda, SyncLog |
| 12 | **Worker** | **Regla de reactivación**: vuelve el stock | ✅ stock 0 → 430, `OUT_OF_STOCK` → `ACTIVE`, SyncLog |
| 13 | **Worker** | **Recálculo de precio** por cambio de coste | ✅ coste 99,99 → 12,14; precio 149,99 → 21,99 con regla "Electrónica ligera" |
| 14 | Worker | Segunda pasada sin cambios | ✅ `changes: 0` en **16 ms** (no llama a la API de la tienda) |
| 15 | Worker | Hash del proveedor persistido | ✅ permite el salto rápido de la pasada 14 |
| 16 | Importador | `/api/scrape` → previsualización | ✅ 3 variantes, 4 imágenes HD, 12 reseñas, 4 opciones de envío, 3 reglas evaluadas |
| 17 | Importador | `/api/import` → publicar en tienda | ✅ producto creado + IDs de variante en Shopify (simulado) + job de sync programado |
| 18 | Webhooks | Firma HMAC inválida | ✅ rechazado con 401 |
| 19 | Webhooks | Firma HMAC válida | ✅ aceptado y validado |
| 20 | Tiendas | Validación contra API real de Shopify | ✅ error correcto (404) ante dominio inexistente |

---

## 2. Evidencia de la regla estrella (worker 24/7)

```
✔ PostgreSQL accesible · 6 productos, 66 sync logs
✔ Redis accesible (localhost:6379)
✔ 1 worker(s) BullMQ escuchando la cola "sync"
• URL con stock 0 en el proveedor: .../item/1005007000088.html
  job=completed · stock 156 → 0 · estado ACTIVE → OUT_OF_STOCK
✔ Stock actualizado a 0 desde el proveedor
✔ Producto marcado como OUT_OF_STOCK en la base de datos
✔ SyncLog de agotado: "⚠️ Proveedor SIN STOCK → producto marcado como AGOTADO en SHOPIFY y despublicado…"
  job=completed · stock 0 → 430 · estado OUT_OF_STOCK → ACTIVE
✔ SyncLog de reactivación: "Stock recuperado (430 uds) → producto reactivado en SHOPIFY…"
✔ Coste actualizado desde el proveedor: 99.99 → 12.14
✔ Precio recalculado con la regla de margen: 149.99 → 21.99
✔ SyncLog de cambio de precio: "Precio actualizado en SHOPIFY: 149.99 → 21.99 (regla "Electrónica ligera", costo 12.14)…"
  Segunda pasada: {"ok":true,"changes":0,"durationMs":16,"source":"simulated"}

  TODAS LAS COMPROBACIONES SUPERADAS
```

---

## 3. Bugs reales encontrados y corregidos durante la verificación

Estos fallos **no se detectaban en modo demo** y sólo aparecieron al ejecutar la ruta real:

| Bug | Impacto | Corrección |
|---|---|---|
| `tsx` no carga `.env.local` (Next sí) | Los workers arrancaban sin `DATABASE_URL`/`REDIS_URL` | Nuevo `workers/env.ts` con la misma precedencia que Next, importado como primera línea |
| El worker **moría** al fallar un job | Un error de BD tumbaba el motor 24/7 (fatal en producción) | `writeSyncLog` ya no propaga errores (telemetría no debe matar el pipeline) + handlers `failed`/`uncaughtException` a prueba de fallos |
| 3 reintentos de scraping desde la misma IP | 12 s perdidos por URL cuando no hay proxies | Reintentos adaptativos: 1 intento sin proxies, 3 con rotación de IP |
| El paso "local" se ejecutaba tras un `BLOCKED` | 13 s extra inútiles (un `fetch` plano también será bloqueado) | Se omite el paso local si el navegador fue bloqueado → cascada de 25 s a **4,5 s** |
| Sin circuit breaker de BD | Con `DATABASE_URL` configurada pero la BD caída, el dashboard devolvía error 500 | Circuit breaker en `src/lib/prisma.ts`: degrada a datos demo y reintenta cada 60 s |

---

## 4. Qué está verificado end-to-end (funciona hoy)

- ✅ Motor de precios, reglas de margen y recálculo automático.
- ✅ Cola BullMQ + worker 24/7 con barrido programado, persistencia en PostgreSQL y auditoría en SyncLog.
- ✅ Las dos reglas críticas de negocio: agotado automático y reactivación.
- ✅ Importador completo (extracción → previsualización → publicación → monitorización).
- ✅ Dashboard, monitor de cola, gestión de productos, pedidos, tiendas y configuración.
- ✅ Webhooks con verificación de firma.
- ✅ Cliente de Shopify real (validación, mutaciones GraphQL y manejo de rate limit) y adaptador WooCommerce.

## 5. Qué NO está verificado aquí (requiere credenciales o infraestructura externa)

| Pendiente | Por qué | Qué necesitas |
|---|---|---|
| Extracción real de AliExpress/Amazon | El proveedor bloquea IPs de datacenter (comprobado en vivo) | `PROXY_LIST` con proxies **residenciales** o la API oficial de AliExpress/CJ |
| Escritura real en Shopify/WooCommerce | Se usaron tokens demo → mutaciones simuladas | Token Admin API real (`shpat_...`) y una tienda de desarrollo |
| Compra automática de pedidos al proveedor | Requiere API de proveedor | `ALIEXPRESS_API_KEY` / `CJ_API_KEY` |
| Suscripciones Stripe | Sin claves de Stripe | `STRIPE_SECRET_KEY` + `STRIPE_PRICE_*` |
| Login de usuarios | Middleware implementado pero `AUTH_ENABLED=false` | Configurar NextAuth y activar la variable |

> El código de estas cinco áreas está escrito y tipado, pero **no ha sido ejecutado contra los servicios reales** en esta verificación: no afirmo que funcione hasta probarlo con credenciales.

---

## 6. Modos de ejecución

| Modo | Configuración | Comportamiento |
|---|---|---|
| **Demo** | Sin `DATABASE_URL` ni `REDIS_URL` | Datos en memoria, extracción sintética instantánea, todo navegable |
| **Real (actual)** | `DATABASE_URL` + `REDIS_URL` | PostgreSQL + cola BullMQ + workers; scraping cae a demo si el proveedor bloquea |
| **Producción** | + `PROXY_LIST` + tokens de tienda + claves de proveedor | Ciclo completo sin datos sintéticos |

---

## 🆕 Segunda ronda de verificación (15/10/2026)

Se implementaron las dos piezas que faltaban (**webhook de WooCommerce** y **pantalla de login**)
más la **configuración de despliegue**. Todo probado en vivo:

### Webhook de WooCommerce (`/api/webhooks/woocommerce`)

| # | Comprobación | Resultado |
|---|---|---|
| 1 | Pedido válido con firma HMAC correcta → crea `Order` + `OrderItem`, calcula coste de proveedor y beneficio | ✅ `#987655 · PAID · 59,98 € · coste 24,80 € · beneficio 35,18 €` |
| 2 | Firma HMAC manipulada | ✅ HTTP 401 y registro de auditoría con `error="Firma HMAC inválida"` |
| 3 | Reenvío del mismo `X-WC-Webhook-Delivery-ID` (WooCommerce reintenta) | ✅ `{"duplicate":true}` — no duplica pedidos |
| 4 | `order.updated` sobre un pedido existente (idempotente) | ✅ Actualiza sin crear duplicado |
| 5 | `order.updated` con estado `cancelled` | ✅ Pedido pasa a `CANCELED` |
| 6 | Reintento con firma inválida repetida (antes abría el circuit breaker) | ✅ 401 estable, sin degradar la base de datos |
| 7 | Automatización: pedido pagado → job `order:push` en la cola BullMQ | ✅ `{"mode":"redis"}` |
| 8 | El worker de pedidos procesa el job | ✅ `SUPPLIER_PURCHASED · AE-572243` + `SyncLog ORDER_PUSH/SUCCESS` |
| 9 | Pedido cancelado no se envía al proveedor | ✅ `{"skipped":true,"reason":"status:CANCELED"}` |
| 10 | Producto modificado en la tienda (no sobrescribe la fuente de verdad) | ✅ Registra `SyncLog STOCK_UPDATE/SKIPPED` para reconciliar en el siguiente barrido |

**Bug corregido durante la verificación**: una firma inválida reenviada provocaba
`Unique constraint failed (storeId, externalId)` → 500 + apertura del circuit breaker
(mode demo durante 60 s). Ahora el intento inválido se audita con sufijo `#firma-invalida`
y la petición responde siempre 401, sin tocar el circuito.

### Login (NextAuth v4 · Credentials)

| # | Comprobación | Resultado |
|---|---|---|
| 1 | `/login` responde 200 y muestra el formulario | ✅ |
| 2 | Login correcto (`demo@dropshippilot.io`) → cookie de sesión + `/api/auth/session` | ✅ `{"user":{"name":"Modo demo","id":"demo-user"}}` |
| 3 | Contraseña incorrecta → **no crea sesión** | ✅ `{}` (302 al formulario) |
| 4 | Middleware: con `AUTH_ENABLED=true` redirige a `/login?callbackUrl=…`; con `false` deja pasar | ✅ |
| 5 | Protección de todas las páginas del panel (incluida `/proxies`) | ✅ |
| 6 | Menú de usuario en la cabecera con cierre de sesión | ✅ |

### Despliegue

| # | Comprobación | Resultado |
|---|---|---|
| 1 | `docker-compose.yml` con 5 servicios (db, redis, scraper, web, worker) y YAML válido | ✅ |
| 2 | `Dockerfile.worker` creado: el worker 24/7 también corre en contenedor | ✅ |
| 3 | Variables de producción documentadas (`NEXTAUTH_URL`, `ENCRYPTION_KEY`, `AUTH_*`, proxies) | ✅ |
| 4 | Guía completa de VPS + dominio + HTTPS + webhooks + backups → `DEPLOY.md` | ✅ |

> ⚠️ El entorno de verificación no tiene Docker instalado, así que el
> `docker compose up` **no se ha ejecutado aquí**: se ha validado el YAML, los
> Dockerfiles (build multi-etapa y de worker) y el despliegue equivalente con
> procesos nativos (PostgreSQL, Redis, `next start`, `tsx workers/*`, uvicorn),
> que es exactamente lo que replican los contenedores.

### Suite completa tras los cambios

`npm run verify:e2e` → **TODAS LAS COMPROBACIONES SUPERADAS** (agotado, reactivación,
recálculo de precio, segunda pasada sin cambios) sobre PostgreSQL real.

---

## 🔒 Tercera ronda: endurecimiento para producción (15/10/2026)

| # | Comprobación | Resultado |
|---|---|---|
| 1 | Con `AUTH_ENABLED=true`, las **credenciales de demo quedan bloqueadas** | ✅ HTTP 401, ninguna sesión creada (el panel falla cerrado si no defines `AUTH_EMAIL`) |
| 2 | El middleware redirige a `/login?callbackUrl=…` cualquier página del panel sin sesión | ✅ `/dashboard` → 307 |
| 3 | Sin `AUTH_ENABLED` (modo previsualización) el login de demo sigue funcionando | ✅ HTTP 200 con sesión |
| 4 | Cabeceras estrictas cuando `ALLOW_IFRAME_EMBED=false` (producción) | ✅ `X-Frame-Options: SAMEORIGIN`, `frame-ancestors 'self'`, HSTS, Permissions-Policy, nosniff, noindex |
| 5 | El visor de previsualización (iframe sandbox) sigue funcionando | ✅ `ALLOWALL` por defecto cuando no se define la variable |
| 6 | Límite de peticiones en `/api/scrape` (endpoint que abre navegador) | ✅ 20/min por IP → la petición 21 devuelve **429** con `Retry-After` |
| 7 | Límite de peticiones en los webhooks (300/min por IP) | ✅ implementado |
| 8 | `.dockerignore` impide que `.env*` entre en las imágenes | ✅ creado (antes no existía y los secretos se colaban en el build) |
| 9 | `scripts/deploy.sh`: sintaxis validada y permisos de ejecución | ✅ `bash -n` limpio + `chmod +x` |
| 10 | `docker-compose.prod.yml`: 9 servicios, YAML válido, sin puertos 5432/8000 expuestos | ✅ |
| 11 | CI configurado (GitHub Actions): Prisma validate, tipos, build, seed y `verify:e2e` | ✅ `.github/workflows/ci.yml` |
| 12 | Guardián de sembrado: `seed-if-empty` **no borra datos** al reiniciar contenedores | ✅ probado contra una base de datos en blanco (siembra) y con datos (no toca nada) |
| 13 | El `.env.local` de desarrollo nunca entra en las imágenes Docker | ✅ `.dockerignore` + `deploy.sh` lo aparta a `.env.local.dev.bak` |
| 14 | Suite completa tras todos los cambios | ✅ `npm run verify:e2e` → **TODAS LAS COMPROBACIONES SUPERADAS** |

**Hallazgo relevante**: las cabeceras definidas en `next.config.mjs` se **congelan durante el
build** (`required-server-files.json`), por lo que una variable de entorno no surtía efecto en
producción. Se movieron a `src/middleware.ts`, que se evalúa en cada petición — verificado
levantando una segunda instancia con `AUTH_ENABLED=true ALLOW_IFRAME_EMBED=false`.

> ⚠️ Limitación honesta: en este entorno **no hay Docker**, así que `deploy.sh` y
> `docker-compose.prod.yml` están validados por sintaxis y por equivalencia funcional
> (los mismos procesos corriendo en nativo), pero **no se han ejecutado con Docker de verdad**.
> El primer `up` en un servidor real puede requerir algún ajuste menor (permisos, DNS, memoria).

### Veredicto de preparación para producción

**Listo para uso real de un negocio propio** tras conectar tienda y proxies. **No listo
todavía para venderlo como SaaS multi-cliente** (falta aislamiento por usuario `userId` en
todas las consultas, facturación Stripe probada, verificación de email/recuperación de
contraseña y monitorización externa de errores).

---

## 🧩 Cuarta ronda: capa SaaS multi-cliente (15/10/2026)

Objetivo de la ronda: dejar el producto vendible como servicio a otros usuarios
(aislamiento, cuentas, planes y cobro) e integrar las **APIs oficiales** de los
proveedores como alternativa limpia al scraping.

### Cómo se garantiza el aislamiento (diseño)

No se confía en que cada consulta «se acuerde» de filtrar. El filtro vive en la
capa de Prisma, con `AsyncLocalStorage`:

- `withTenant(userId, fn)` — contexto de un cliente (peticiones web, jobs).
  **Fail-closed**: una consulta de datos de cliente sin contexto lanza
  `TenantScopeError` en vez de devolver filas ajenas.
- `withSystem(motivo, fn)` — sólo para lo legítimamente global (catálogo de
  proveedores, barrido del worker, login pre-sesión), con motivo obligatorio.
- Un contexto de inquilino **no se puede reabrir como otro usuario**
  (suplantación bloqueada); el modo sistema sí puede abrir uno concreto.
- `findUnique` sobre modelos con `userId`: la clave única se fusiona con el
  inquilino. Modelos hijos (variantes, imágenes, reseñas): se comprueba la
  propiedad con una consulta filtrada por la relación → si no es del dueño,
  `findUnique` devuelve `null` y `update`/`delete` lanzan error.
- Los errores de aislamiento **no** activan el cortacircuitos que degrada la app
  a modo demo: son errores de programación, no fallos de base de datos.

### Evidencia ejecutada

| Comprobación | Resultado |
|---|---|
| `npm run verify:isolation` | **13/13** — lectura cruzada, fail-closed (lectura y escritura), `findUnique` ajeno → `null`, `updateMany` ajeno → 0 filas sin tocar el dato, suplantación de `userId` bloqueada, modo sistema, limpieza CASCADE |
| `npm run verify:credits` | **6/6** — consumo aislado por cliente, agotamiento, límite de productos del plan, reinicio por periodo |
| `npm run verify:e2e` | **Todas superadas** con el código multi-tenant (agotado, reactivación, recálculo, SKIP incremental) |
| `npx tsc --noEmit` · `npx next build` | Limpio · «Compiled successfully» |
| Ciclo de cuenta por HTTP | 201 registro → reenvío → verificación (token de un solo uso) → login NextAuth → olvidé/reset con token |
| Dos sesiones simultáneas | A (PRO) ve 6 productos y 10 pedidos; B (STARTER) ve 2 y 0. `PATCH` del producto de A desde B → 404 y el dato intacto |
| Peticiones sin sesión | Páginas → 307 a `/login`; APIs → **401** en JSON (`apiTenant`), no 500 |
| Anti-fuerza bruta | 10 intentos permitidos y bloqueo desde el 11 (`bloqueado_por_intentos` en `AuditLog`) |
| Proveedores por API oficial | Alta de cuenta cifrada; prueba real: CJ responde y devuelve su error de autenticación real (245 ms); AliExpress sin credenciales válidas → bloqueo/HTML detectado como error legible; credenciales incompletas → «Faltan credenciales: appSecret»; borrado → 200 |
| Arranque de workers con el código nuevo | Barrido 8/8 productos, cada producto en el contexto de su dueño, sin errores |
| Seed de demostración | `npm run seed:demo` deja dos clientes independientes e idempotentes |

### Flujos de la capa SaaS

- **Registro** → token SHA-256 de 24 h → correo → `/verify` → login. Con
  `REQUIRE_EMAIL_VERIFICATION=true` no se entra sin verificar.
- **Olvidé mi contraseña** → token de 1 h → `/reset`. Respuesta neutra para no
  revelar qué correos existen.
- **Planes**: TRIAL (25 productos, 1 tienda, 200 créditos) · STARTER · PRO ·
  ENTERPRISE. Los límites y créditos se aplican en los endpoints que cuestan
  dinero (extracción 1, importación 2, sincronización 1, pedido 3) → **402** con
  `code` explicable cuando se agotan.
- **Stripe**: checkout de suscripción con `metadata.userId`, portal de cliente,
  webhook con verificación de firma (alta, cambio, cancelación, `invoice.paid`
  reinicia créditos). Sin claves: `configured:false` y aviso para asignar plan a mano.
- **Proveedores**: cada cliente guarda sus credenciales (cifradas), las prueba
  contra la API real, y el worker de pedidos las usa para **comprar de verdad**
  cuando existen; si no, cae al canal genérico y lo deja anotado en `SyncLog`.

### Lo que sigue sin poder verificarse en este entorno

Igual que en las rondas anteriores: nada que dependa de terceros reales. Sin
tienda Shopify/Woo real, sin claves de Stripe, sin credenciales de proveedor
aprobadas y sin proxies de pago, lo máximo demostrable es que **el código habla
con los servicios correctos y maneja sus errores reales** (que es lo que se ha
hecho con CJ y AliExpress). La lista completa está en `PRODUCCION.md`.

---

## 🛡 Quinta ronda: 2FA, restauración de copias, carga y legales (15/10/2026)

| Comprobación | Comando | Resultado |
|---|---|---|
| Segundo factor (TOTP) | `npm run verify:2fa` | **16/16** — vector de prueba del RFC 6238 (`287082`), tolerancia de reloj ±30 s, rechazo de códigos inventados, secreto cifrado AES-256-GCM, 10 códigos de recuperación hasheados y de un solo uso |
| 2FA en el login real (HTTP) | manual | Sólo contraseña → **rechazado**; contraseña + código falso → rechazado; código correcto → sesión creada; código de recuperación → sesión creada y consumido (quedan 9); reutilizarlo → rechazado; desactivar con contraseña+código → 200; con código falso → **403** |
| Comprobación previa del formulario | `POST /api/auth/2fa-check` | `{required:true}` para cuenta con 2FA, `{required:false}` para cuenta sin 2FA **y** para correo inexistente (no revela qué cuentas existen) |
| Generación del QR | `POST /api/security/totp` | SVG generado en el servidor (3,9 KB) con URI `otpauth://`; la app no pide nada a Internet |
| Restauración de copias | `npm run verify:backup` | Volcado → restauración en base temporal → **11/11 tablas con el mismo número de filas** (incl. 115 SyncLog, 23 AuditLog, 15 variantes, 22 reseñas) |
| Restauración guiada | `scripts/restore.sh` | Lista copias, admite `--dry-run` y exige escribir `RESTAURAR` para sobrescribir |
| Carga | `npm run verify:load` | **300 peticiones / 25 en paralelo / 0 errores** · 65 req/s · p50 126 ms, p95 325 ms, p99 589 ms (una máquina, datos de demo) |
| Páginas legales | `/privacy`, `/terms`, `/cookies` | 200 y enlazadas desde el login. **Son plantillas** con marcadores pendientes de rellenar y revisar |

Nota honesta sobre el alcance de esta ronda: la prueba de carga es ligera (una sola máquina,
decenas de usuarios simulados, no miles) y las plantillas legales no sustituyen a la revisión de
un profesional. Todo lo demás de esta sección sí es evidencia ejecutada.


---

## 🔔 Sexta ronda: webhooks firmados y Stripe (15/10/2026)

### Fallo encontrado y corregido (habría roto la facturación)

Al probar el webhook de Stripe con firmas reales se descubrió que **los tres webhooks
(Stripe, Shopify y WooCommerce) se ejecutaban fuera del contexto de cliente**: la capa de
aislamiento multi-cliente los bloqueaba con `TenantScopeError`. Consecuencia real si se
hubiera desplegado así: nadie habría pasado a plan de pago, los pedidos de tienda no se
habrían creado y el log habría mostrado errores 500.

Corrección aplicada (mismo patrón que en los workers): **verificar la firma e identificar
al dueño en modo sistema** (motivo explícito) y **ejecutar el trabajo en el contexto de ese
cliente** (`withTenant`). En Stripe, el `userId` viene en la metadata del evento o se localiza
por `stripeSubscriptionId`/`stripeCustomerId` cruzando clientes (modo sistema) antes de tocar
sus datos.

### Evidencia

| Suite | Comando | Resultado |
|---|---|---|
| Webhook de Stripe | `npm run verify:stripe` | **15/15** — firma falsa → 400 y sin cambios; `checkout.session.completed` → plan PRO, suscripción ACTIVE, créditos a 0; `invoice.paid` → créditos reiniciados; `customer.subscription.deleted` → TRIAL; evento desconocido ignorado; sin cabecera → 400 |
| Webhooks de tienda | `npm run verify:webhooks` | **12/12** — pedido WooCommerce creado en el cliente dueño (+1 en su contador), duplicados detectados sin duplicar, firma falsa → 401; pedido Shopify creado y firma falsa rechazada |
| Aislamiento · créditos · 2FA · E2E · carga | `verify:isolation` · `verify:credits` · `verify:2fa` · `verify:e2e` · `verify:load` | 13/13 · 6/6 · 16/16 · todas · 0 errores |

### Stripe: qué queda automatizado y qué necesita tu cuenta

Automatizado (`npx tsx scripts/stripe-setup.ts --key=sk_test_…`): comprueba la clave, crea los
**6 precios** (3 planes × mensual/anual) con `lookup_key` (idempotente), escribe las variables en
`.env.local` con copia de seguridad, y con `--checkout` genera una suscripción de prueba y devuelve
la URL de pago (tarjeta de test 4242 4242 4242 4242). Sólo acepta `sk_test_…`: con una clave real
se niega a seguir para no crear cobros de verdad por accidente.

Manual (2 minutos en el panel de Stripe, imposible de automatizar sin tus credenciales de cuenta):
crear la cuenta, copiar la clave de test, copiar el `whsec_…` del webhook y apuntar el endpoint a
`https://TU-DOMINIO/api/webhooks/stripe`.


### Alcance real del webhook: probado también por Internet

La URL de vista previa de este entorno está protegida con token (`e2b-traffic-access-token`),
así que Stripe **no** puede entregar ahí sus webhooks (no puede añadir cabeceras). Para
comprobarlo de verdad se levantó un túnel público (Cloudflare quick tunnel) apuntando a la
app y se repitió la suite completa **contra la URL pública**:

    https://<túnel>.trycloudflare.com/api/webhooks/stripe → 15/15 ✔

Es decir: el camino completo (Internet → proxy → app → verificación de firma con la librería
oficial → base de datos) está probado. Nota técnica: dentro del sandbox el DNS devuelve primero
IPv6 y no hay ruta IPv6, así que las pruebas locales hacia el túnel necesitaron forzar IPv4.

**Limitaciones honestas de esta prueba**: el túnel es temporal (vive mientras dure la sesión),
Cloudflare no garantiza disponibilidad en túneles sin cuenta y la URL cambia en cada arranque.
Para producción el webhook se apunta al dominio propio (`https://TU-DOMINIO/api/webhooks/stripe`),
que es lo que hará `scripts/deploy.sh`.


---

## 🧭 Séptima ronda: auditoría y centro de conexión (15/10/2026)

### Errores encontrados y corregidos

| Hallazgo | Gravedad | Corrección |
|---|---|---|
| `/api/proxies` (GET y POST) no exigía sesión | Media: permitía usar el validador de proxies sin autenticarse y leer el estado del pool | Envuelto en `apiTenant`: 401 sin sesión cuando `AUTH_ENABLED=true` |
| `StoreStatus`/`SupplierAccountStatus` no tienen el valor `ACTIVE` | Baja (detectada por `tsc` al escribir el centro de conexión): la comprobación de tiendas/Cuentas conectadas nunca habría coincidido | Corregido a `CONNECTED` (y `lastPingAt`) |
| Import de iconos roto en el sidebar al añadir la entrada | Baja | Corregido; `tsc` limpio |

Otras comprobaciones de la auditoría: `next lint` sin avisos · no quedan `TODO/FIXME` en código ·
todas las rutas API pasan por `apiTenant`/contexto salvo las justificadas (`/api/health`,
`/api/auth/*` pre-login, webhooks que abren su propio contexto).

### Piezas nuevas

| Pieza | Para qué | Verificación |
|---|---|---|
| `GET /api/setup/status` | Estado en vivo de 13 piezas (infra, seguridad, cobros, correo, tiendas, proveedores, scraping) | Devuelve 13 comprobaciones, 5 conectadas / 0 bloqueantes / 6 recomendadas en el entorno actual |
| `/setup` (panel) | «Puesta en marcha»: tarjetas por zona, con la variable exacta a pegar, cómo conseguirla y enlace a la pantalla correspondiente | HTTP 200 y contenido correcto |
| `npm run preflight` | La misma comprobación en consola, con exit code 1 si hay bloqueantes | Ejecutado: 4 correctas · 7 pendientes · 0 bloqueantes |
| `PAGOS.md` | Investigación documentada de cómo cobrar en España sin ser autónomo | Fuentes citadas (Wolters Kluwer, Stripe, Lemon Squeezy, FactuChat, …) |

### Suites tras los cambios

Aislamiento **13/13** · créditos **6/6** · 2FA **16/16** · E2E worker **todas** · webhooks de
tienda **12/12** · webhook de Stripe **15/15** (contra un segundo servidor en :3001 con claves
simuladas) · carga **0 errores** (p50 100 ms).


---

## 🚀 Octava ronda: las cinco mejoras de producto (15/10/2026)

### 1. Cobro con Lemon Squeezy (merchant of record)

| Pieza | Detalle |
|---|---|
| `src/lib/lemon.ts` | Checkout hospedado por API (`POST /v1/checkouts`), firma `X-Signature` (HMAC-SHA256 hex), mapa de estados → plan/créditos y portal de cliente |
| `/api/webhooks/lemon` | Verifica firma → localiza al dueño (`withSystem`) → aplica el trabajo en su contexto (`withTenant`) |
| `/api/billing/checkout` | Acepta `provider: 'stripe' \| 'lemon'`; errores claros cuando falta configuración (501/400) |
| Facturación (UI) | Selector «¿Quién cobra el pago?» con comisiones y requisitos de cada vía |
| Evidencia | **`npm run verify:lemon` → 24/24** contra un servidor con claves simuladas: firma inválida rechazada (401) y sin cambio de plan · created → PRO/ACTIVE/25.000 créditos · renovación reinicia créditos · pago fallido → PAST_DUE y aviso por correo · evento sin metadata localizado por id de suscripción · cancelación → TRIAL · checkout sin claves → 501 |

### 2. Shopify OAuth («Instalar app»)

| Pieza | Detalle |
|---|---|
| `src/lib/shopify-oauth.ts` | `state` firmado con caducidad (15 min), verificación del `hmac` del callback, canje del código por token permanente |
| `/api/shopify/install` | Valida `*.myshopify.com` y redirige a la pantalla de autorización de la tienda |
| `/api/shopify/callback` | Verifica firma + estado + coincidencia con la sesión, valida el token contra la API real, guarda la tienda cifrada, registra webhooks y redirige a /stores |
| Tiendas (UI) | Bloque «Instalación en 1 clic» (si OAuth está configurado) junto al método manual de token |

Evidencia (servidor con app simulada):

```
install?shop=demo-tienda.myshopify.com      → 307 a https://demo-tienda.myshopify.com/admin/oauth/authorize
                                              con scope completo y state firmado
callback con hmac falso                     → 307 a /stores?shopify=error «firma no válida»
callback con state de otro usuario          → 307 «esta instalación la inició otro usuario» (suplantación bloqueada)
callback con state manipulado               → 307 «sesión caducada o manipulada»
callback con firma correcta y código falso  → llega a la API real de Shopify y devuelve el error con elegancia
install sin configurar                      → 501 con instrucciones (el método manual sigue disponible)
```

### 3. Avisos por correo

| Pieza | Detalle |
|---|---|
| `src/lib/alerts.ts` | 4 tipos (sync, stock, webhooks, billing), preferencias por cliente, **anti-spam** por tipo e intervalo y rastro en auditoría |
| `/api/alerts` | GET (preferencias + transporte) · PATCH (activar/desactivar) · POST (correo de prueba) |
| Configuración (UI) | Tarjeta «Avisos por correo» con los 4 interruptores y prueba de envío |
| Motor 24/7 | Aviso al quedarse sin stock (y al recuperarlo), al fallar un job definitivamente y al recibir un webhook con firma inválida (Shopify y WooCommerce) |
| Lemon Squeezy | Aviso automático cuando un pago falla |

Evidencia: **`npm run verify:alerts` → 10/10** (envío, freno anti-spam, respeto de preferencias y restauración, rutas HTTP y rastro en auditoría).

**Prueba de punta a punta en el motor 24/7** (15/10, 18:32 UTC): se puso a cero el stock de un
producto monitorizado, se encoló un `sync:product` por la API y el worker real reactivó el producto
y envió el aviso:

```
[mail:console] → demo@dropshippilot.io
  Asunto: [DropshipPilot] «Reloj Inteligente AMOLED 1.96" IP68 con Llamadas Bluetooth» vuelve a tener stock

SyncLog  STOCK_UPDATE · SUCCESS · Stock recuperado (1198 uds) → producto reactivado en SHOPIFY
Product  stockTotal: 0 → 1198
```

Los workers se reiniciaron con el código nuevo (antes corrían una versión anterior sin avisos) y
completaron el barrido: 8/8 productos re-verificados.

### 4. Panel de administración de la plataforma

| Pieza | Detalle |
|---|---|
| `src/lib/admin.ts` | Guardián de rol (`ADMIN`), métricas globales (clientes, MRR estimado, tiendas, productos, actividad de sync, créditos) y listado de clientes |
| `/api/admin/tenants` | GET con métricas + clientes · PATCH por cliente: plan, créditos (fijar/sumar/reiniciar), rol y verificación manual de correo — **todo auditado** |
| `/admin` (UI) | KPIs, tabla de clientes con acciones de soporte; el enlace del menú sólo aparece para operadores |
| `scripts/make-admin.ts` | `npm run admin -- tu@correo.com`, `--quitar`, `--listar` |

Evidencia: **`npm run verify:admin` → 14/14** (cliente normal bloqueado, operador autorizado, métricas, ruta HTTP real, suma/resta de créditos ida y vuelta y auditoría). Protección extra: un operador no puede quitarse a sí mismo el rol.

### 5. Pruebas automáticas en cada despliegue

| Pieza | Detalle |
|---|---|
| `scripts/smoke.ts` | Prueba de humo por HTTP contra la URL desplegada: salud (Postgres+Redis), login, los **tres webhooks**, OAuth de Shopify y centro de conexión. Sale con código 1 si falla |
| `scripts/deploy.sh` | Tras levantar los contenedores: espera HTTPS → prueba de humo → `npm run preflight` **dentro del contenedor**; si algo bloquea, el despliegue termina en rojo |
| `npm run smoke` / `verify:lemon` / `verify:admin` / `verify:alerts` | Nuevos atajos |

Evidencia: `npm run smoke` → **7 correctas · 0 avisos · 0 fallos** contra la app en marcha.

### Otras piezas de esta ronda

- **Base de datos**: preferencias de aviso en `User` y campos de Lemon Squeezy en `Subscription` (`lemonCustomerId`, `lemonSubscriptionId` único, `lemonVariantId`, `lemonStatus`). Desplegable con `prisma db push` (el servicio `migrate` ya usa `--accept-data-loss`, documentado en el compose).
- **Centro de conexión**: ahora comprueba **15 piezas** (añadidas Lemon Squeezy y OAuth de Shopify), y `npm run preflight` las incluye en consola.
- **`.env.example`**: documentadas todas las variables nuevas (`LEMON_*`, `SHOPIFY_API_KEY/SECRET`, `RESEND_API_KEY`).

### Suites completas tras los cambios

Aislamiento 13/13 · créditos 6/6 · 2FA 16/16 · E2E del worker ✓ · webhooks de tienda 12/12 · webhook de Stripe **15/15** · Lemon Squeezy **24/24** · administración **14/14** · avisos **10/10** · carga 0 errores (p50 103 ms) · humo 7/7 · `tsc`, `next build` y `next lint` limpios.


---

## 🩺 Novena ronda: ciclo operativo completo (15/10/2026)

Tres huecos reales que quedaban en la auditoría, cerrados y verificados.

### 1. Frecuencia de sincronización según el plan (antes era una promesa incumplida)

La página de precios prometía «sincronización cada 30 min / 1 h / 2 h / 6 h» según el plan,
pero el motor barría **todo cada hora sin mirar el plan**. Ahora:

- El **planificador** late cada `SYNC_SCHEDULER_MINUTES` (15 min por defecto) y sólo encola los
  productos que ya han cumplido el intervalo de su dueño (`filterDueProducts`, en `workers/lib.ts`).
- Frecuencias: **Prueba 360 · Starter 120 · Pro 60 · Enterprise 30** minutos (las que muestra la web).
- Se registra en el log cuántos se omiten por estar frescos, para poder auditar el ahorro.

Evidencia (log real del motor):

```
⏰ Planificador cada 15 min · frecuencia por plan: Prueba 360min · Starter 120min · Pro 60min · Enterprise 30min
🔄 Barrido: 0 de 8 productos toca re-verificar ahora (8 aún frescos según su plan, 8 monitorizados en total)
✅ Barrido completado: 0 jobs encolados, 8 omitidos (plan) en 28 ms
```

Y `npm run verify:ops` comprueba las 9 combinaciones (nunca sincronizado, dentro del intervalo y
fuera del intervalo, para cada uno de los 4 planes) → **17/17 en total**.

### 2. Vigilancia del sistema con aviso al operador

Era el punto rojo «si el servidor se cae, nadie te avisa». Ahora `src/lib/watchdog.ts`
comprueba **base de datos (con latencia), Redis, profundidad de las colas, microservicio de
scraping y salud de la sincronización de la última hora**, y `alertOperators()` envía un correo
a todos los usuarios con rol **ADMIN** con freno anti-spam de una hora por problema (en memoria
y persistido en auditoría).

- En el motor: job `health:watch` cada 15 minutos. Primera ejecución real:
  `🩺 Vigilancia OK · sistema sano (122 ms) · db 22 ms · cola 0 en espera · 1 en proceso · 0 fallidos · sync 0/23 fallidos en la última hora (0 %)`
- A mano: `npm run watchdog` (con `--avisar` para forzar el correo, `--json` para cron externo).
- También aparece en `npm run preflight`, que ahora imprime el estado de vigilancia.

Evidencia: `npm run verify:ops` → detección de **Redis caído (crítico)**, aviso enviado al
operador, **segundo aviso frenado**, rastro en auditoría y «sin problemas → no se envía nada».

**Fallo encontrado y corregido durante esta ronda**: al apuntar a un Redis caído, ioredis se
quedaba reintentando en segundo plano y el proceso **nunca terminaba** (el script de verificación
se colgó). Se ha añadido `retryStrategy: () => null` y cierre explícito de la conexión en
`watchdog.ts`, `preflight.ts` y `/api/setup/status`: una comprobación de salud **jamás** debe
colgarse, ni siquiera cuando el servicio que comprueba está muerto.

### 3. Contrato de encargado del tratamiento (DPA)

`DPA.md`: plantilla completa (art. 28 RGPD) con cláusulas, **Anexo I** de medidas de seguridad
reales de la plataforma y **Anexo II** de subencargados, más instrucciones de uso. Era el
documento que faltaba para poder vender a terceros; queda pendiente solo la revisión legal y
rellenar los datos.

### Suites tras la ronda

Aislamiento 13/13 · créditos 6/6 · 2FA 16/16 · E2E ✓ · webhooks de tienda 12/12 · Stripe 15/15 ·
Lemon 24/24 · administración 14/14 · avisos 10/10 · **vigilancia y frecuencia por plan 17/17** ·
carga 0 errores · humo 7/7 · preflight 0 bloqueantes · `tsc`, `next build` y `next lint` limpios.

---

## 🛍 Décima ronda: catálogo servido por la plataforma (15/10/2026)

El objetivo era cerrar la última brecha entre «clon» y «producto vendible»: que un cliente entre
y encuentre un **escaparate lleno** (no una caja de búsqueda vacía) y que **nadie tenga que pedir
sus propias claves** a AliExpress o CJ. Verificado con `npm run verify:catalog` → **58/58**.

### 1. Claves de la plataforma (una vez, para todos los clientes)

- Modelo nuevo `PlatformCredential`: credenciales por proveedor **cifradas (AES-256-GCM)**, estado
  de conexión, última prueba, último error, cuota mensual y consumo.
- Cascada de resolución al pedir un cliente de proveedor:
  **plataforma (base de datos) → variables de entorno → cuenta propia del usuario** (esta última,
  opcional). Así el operador pega las claves una sola vez y todos los usuarios navegan e importan
  con ellas, sin verlas.
- Panel: **Administración → Claves de proveedor** (`/admin`, sólo rol ADMIN). Botones
  *Guardar y probar*, *Probar*, *Descargar catálogo* y borrar. Los valores se muestran
  enmascarados (`clav••••••••cion`).
- Cuotas: `monthlyQuota` con reinicio mensual; al agotarse, la plataforma deja de llamar al
  proveedor y avisa en lugar de bloquearse.

Evidencia con la API **real** de CJ (claves de prueba deliberadamente inválidas):

```
POST /api/admin/platform-credentials  {action:"save", provider:"CJ_DROPSHIPPING", …}
→ ok:true · estado guardado: ERROR
→ prueba: "Email or password is wrong, please check and try again. We recommend switching to the apiKey mode"
```

Es decir: el guardado cifra, la prueba **sale a internet y habla con CJ de verdad**, y el error se
guarda tal cual (útil para diagnosticar la clave mal copiada).

### 2. Índice propio + worker de catálogo

- Modelos `CatalogCategory` y `CatalogItem` (precio de coste, stock, valoración, pedidos, envío,
  almacén de salida, tendencia, imágenes, `rawPayload` completo, `source: 'api' | 'sample'`).
- Métodos nuevos en los clientes oficiales: CJ `product/listV2` (+ `getCategory`) y AliExpress
  `ds.recommend.feed.get`. El catálogo se **descarga y se guarda**: la pantalla nunca llama al
  proveedor, responde al instante y no gasta cuota.
- Worker nuevo `workers/catalogWorker.ts` (tercer hijo de `npm run worker`, cola `catalog`):
  asegura la muestra al arrancar, descarga al inicio y cada `CATALOG_SYNC_MINUTES` (360 por
  defecto), se salta limpiamente si no hay claves.

Log real del motor:

```
🖼️  Catálogo de muestra: 36 artículos (ya estaba)
🚀 Catalog Worker arrancado · cola="catalog" · refresco cada 360 min
ℹ️  Catálogo: sin claves de plataforma configuradas · el catálogo de muestra sigue activo
```

### 3. Pantalla `/catalog` (escaparate, no sólo búsqueda)

- **Categorías visuales con imagen** (carrusel) + buscador con sugerencias + filtros de
  proveedor, almacén, rango de precio, valoración, envío gratis y tendencias + 7 órdenes distintos.
- Cada tarjeta muestra **coste del proveedor, tu precio de venta y tu beneficio por unidad**
  calculados con **tu** regla de margen (el mismo motor que usa la importación: cero cuentas
  paralelas).
- Ficha lateral con galería, variantes, descripción, envío y **botón de importación** que reutiliza
  `POST /api/import` con el payload ya indexado: **2 créditos, sin volver a extraer, con
  publicación en la tienda y primer chequeo del worker programado**.
- Modo muestra etiquetado («MUESTRA» en cada tarjeta) y aviso claro de que las claves de la
  plataforma lo sustituyen.
- Proxy de imágenes propio (`/api/img`): descarga la imagen del proveedor desde el servidor con
  lista blanca de hosts, de modo que no fallan por hotlinking ni exponen la IP del cliente.

### 4. Cambio muestra → real (probado en vivo)

Con 3 artículos reales ingeridos para CJ, el índice **deja de servir la muestra de ese proveedor**
y la pantalla pasa a «Catálogo real»:

```
antes:  total CJ: 24 · fuentes {'sample'}          · página: "Catálogo de muestra cargado"
después: total CJ: 3 · fuentes {'api'}            · página: "Catálogo real · 3 productos servidos por la plataforma"
tras borrar los de prueba: 36 artículos de muestra otra vez
```

### 5. Fallo real encontrado y corregido: el límite de CJ

Al probar la descarga con las claves inválidas, CJ respondió
`Too Many Requests, QPS limit is 1 time/1second`. Era un aviso de oro: **CJ sólo admite una
petición por segundo**. Corregido en dos sitios: el cliente CJ reintenta con espera de 1,2 s
cuando recibe 429 (`RATE_LIMIT`) y la descarga del catálogo pausa entre páginas
(`CATALOG_QPS_DELAY_MS=1200`). Sin esto, la descarga real habría fallado a la segunda página.

### 6. Integración con el resto de la plataforma

- `/api/setup/status` pasa a **16 comprobaciones** con «Catálogo servido por la plataforma» y la
  comprobación de proveedores ahora refleja *«Gestionado por la plataforma: CJ, AliExpress · los
  clientes no configuran claves»*.
- `npm run preflight` incluye bloque de catálogo (claves, índice, siguiente paso).
- Página **Proveedores** avisa de que ya no hace falta configurar nada ahí.
- Dashboard: acción rápida «Explorar el catálogo» y entrada **Catálogo** (NUEVO) en el menú.
- Scripts nuevos: `npm run verify:catalog`, `npm run seed:catalog`, `npm run worker:catalog`.

### 7. Contrato con los proveedores, probado a nivel de red

La única incógnita que quedaba era «¿y si el día que pegue las claves el listado no se interpreta
bien?». Para eliminarla, la verificación **sustituye `fetch` por respuestas con la misma forma que
documentan CJ y AliExpress** y ejecuta la descarga completa real (autenticación → `product/listV2`
→ normalización → índice → pantalla → ficha de importación):

```
✔ Descarga completa de CJ con respuesta simulada — 3 recibidos · 3 guardados
✔ Las categorías anidadas se aplanan — 3 categorías (3 niveles → 3 filas)
✔ La muestra de CJ deja paso al catálogo real — 3 artículos, todos reales
✔ Se conservan todas las imágenes del proveedor — máx. 2 imágenes
✔ Cada producto real trae precio de venta calculado — ej. 12.3 € → 17.99 €
✔ La ficha genera el payload de importación — 1 variante(s) · CJ_DROPSHIPPING
✔ Descarga del feed de AliExpress — 2 recibidos · 2 guardados
✔ Se interpretan valoración y pedidos del feed — valoración 4.8 · 4321 pedidos
✔ Los filtros viajan en la petición al proveedor — país de almacén incluido
✔ La página /catalog cambia el aviso honestamente — «Catálogo real» en el HTML servido
```

Y, de paso, el camino de autenticación **sí habló con la API real de CJ** (ver punto 1). Es decir:
de la cadena completa sólo falta la respuesta válida del proveedor, que sólo depende de tus claves.

### Suites tras la ronda

Aislamiento 13/13 · créditos ✓ · 2FA 16/16 · webhooks de tienda 12/12 · administración 14/14 ·
avisos 10/10 · vigilancia y plan 17/17 · E2E ✓ · carga 200/200 sin errores · humo 7/7 ·
**catálogo y claves 58/58** · preflight 0 bloqueantes · `tsc`, `next build` y `next lint` limpios.

---

## 💱 Undécima ronda: divisa real y permisos del operador (15/10/2026)

La auditoría pedida después del alta del proveedor genérico encontró dos problemas de fondo. Los
dos están corregidos y **verificados con peticiones reales** contra la app en marcha.

### 1. El dinero estaba mal: no había cambio de divisa

CJ y la mayoría de tiendas devuelven el precio en **USD**; AliExpress lo devuelve en EUR y el motor
de precios (`src/lib/pricing.ts`) trabaja en una sola divisa. Resultado: un coste de **69 USD entraba
como 69 €**, el beneficio que se mostraba era falso y el operador decidía precios sobre un número
equivocado. En el peor caso, se vendía por debajo de coste sin que nadie lo viera.

Corregido con un módulo nuevo, **`src/lib/fx.ts`**, que convierte a EUR en el momento de calcular
(previsualización, importación, ficha del catálogo y worker de sync):

```
FX_RATES='{"USD":0.92,"GBP":1.17,"CNY":0.128}'   # cuántos euros vale 1 unidad
FX_ENABLED='true'                                # false = trabajar sin convertir
```

Antes / después con el mismo producto de prueba (Abominable Hoodie, 69 USD):

| | antes | ahora |
|---|---|---|
| Coste guardado | 69,00 («€», en realidad USD) | **63,48 €** (69 × 0,92) |
| Precio de venta | 97,99 € | **89,99 €** |
| Beneficio mostrado | 28,99 € (falso) | **26,51 €** (real) |
| Divisa en la ficha | USD | EUR |
| Trazabilidad | — | «69 USD → 63,48 € (tipo 0.92)» en la respuesta y en la vista |

Tres sitios más se corrigieron de la misma pasada, y eran tan graves como el anterior:

- `createProductFromScraped` (`src/lib/data.ts`) guardaba `variants[0].price` como coste… pero
  `/api/import` sobrescribía ese campo con el **precio de venta**, así que la ficha acababa con
  coste = precio de venta y **beneficio 0**. Ahora el coste del proveedor se conserva y el precio de
  venta viaja en su propio campo.
- El envío del proveedor se guardaba en su divisa original → ahora también en EUR.
- `checkProvider` (worker 24/7) devolvía el precio en la divisa del proveedor y lo comparaba con el
  coste guardado en EUR: **cada hora habría detectado un «cambio de precio» inexistente** y habría
  reescrito el coste en dólares. Ahora el snapshot del worker se convierte antes de comparar.

Verificado en marcha (mismo número en la vista previa, en la respuesta de importación y en la base
de datos):

```
▸ Abominable Hoodie (OTHER) · proveedor: 69 USD · conversión 69 USD → 63.48 € (tipo 0.92)
  vista previa  → coste 63.48 € + envío 0 € = venta 89.99 € · beneficio 26.51 €
  importación   → coste 63.48 € · venta 89.99 € · beneficio 26.51 € · publicación OK
  base de datos → coste 63.48 · venta 89.99 · beneficio 26.51 · EUR
▸ Adrienne Trek Jacket · 57 USD → 52.44 € = venta 73.99 € · beneficio 21.55 €
▸ Aeon Capri · 48 USD → 44.16 € = venta 62.99 € · beneficio 18.83 €
```

### 2. Permisos: un anónimo podía tocar las claves y los planes de todos

Con `AUTH_ENABLED=false` el contexto caía en el primer usuario de la base de datos
(`demo@dropshippilot.io`, rol **ADMIN**). Como `currentAdmin()` se fiaba del contexto de inquilino,
**cualquiera que abriera la URL podía ver el panel de operador, listar los clientes con sus correos,
cambiar planes y créditos, y probar/borrar/reescribir las claves de plataforma**. Era el fallo más
serio de la auditoría.

Reglas nuevas en `src/lib/admin.ts`:

1. Sesión iniciada con rol ADMIN → acceso completo.
2. `LOCAL_ADMIN_MODE="true"` → acceso completo (instalación de un único dueño, apagado por defecto).
3. Sin autenticación y sin modo local → **sólo lectura**: el panel se puede mirar, con los correos de
   los clientes enmascarados (`cl•••••@dropshippilot.io`) y los botones desactivados.
4. Autenticación activa sin sesión → nadie.

Verificado con peticiones reales (anónimo, `AUTH_ENABLED=false`):

```
GET  /api/admin/platform-credentials → 200 · admin:{source:"evaluation",readOnly:true} · valores enmascarados
POST /api/admin/platform-credentials → 403 READ_ONLY «para cambiar las claves inicia sesión…»
GET  /api/admin/tenants              → 200 · correos ocultos (cl•••••@…, de••@…)
PATCH /api/admin/tenants/<id>        → 403 READ_ONLY «no se pueden cambiar planes…»
LOCAL_ADMIN_MODE=true (script)       → source:"local" · readOnly:false · puedeEscribir:true
```

La interfaz muestra un aviso claro («Modo evaluación: panel en sólo lectura») en vez de un estado
silencioso, y la tarjeta de claves deja los botones inertes.

### 3. Otros dos hallazgos, corregidos

- **Modo degradado que reventaba**: si una consulta fallaba, el *circuit breaker* de `src/lib/prisma.ts`
  degradaba a modo demo y el identificador de respaldo (`user_demo_1`) no existe como fila real de
  `User`; el siguiente `subscription.upsert()` moría con clave ajena (**P2003**) y la petición salía
  como error 500 en cascada. Ahora los créditos no tocan la base de datos cuando el circuito está
  abierto: la app sigue funcionando en modo demo con aviso en consola.
- **Producto repetido**: importar dos veces la misma URL devolvía un **500** con el volcado de Prisma.
  Ahora es un **409 `ALREADY_IMPORTED`** con mensaje humano («Ese producto ya está en tu tienda: no se
  ha creado otro ni se han gastado créditos») y sin cobrar créditos. `/api/import` incorpora además
  su propio límite de peticiones (30 cada 5 minutos por IP), que antes sólo tenía `/api/scrape`.

### 4. Arranque en una sola orden (para poder verlo funcionando)

`scripts/start-everything.sh` levanta y comprueba PostgreSQL, Redis, el microservicio de scraping,
la web y los workers 24/7, y termina diciendo **dónde mirar** (`https://3000-<sandbox>.e2b.app` en un
sandbox, `http://localhost:3000` en un servidor). Es idempotente: lo que ya esté escuchando no se
toca. Registros en `logs/`, PIDs en `logs/*.pid`.

```
✔ Dependencias de Node presentes        ✔ Esquema de base de datos al día
✔ PostgreSQL escuchando en :5432        ✔ Cliente de Prisma generado
✔ Redis escuchando en :6379             ✔ Microservicio de scraping escuchando en :8000
✔ Web escuchando en :3000               ✔ Workers 24/7 ya estaban en marcha
```

### Suites tras la ronda

`npm run verify:catalog` **58/58** · `npm run verify:fx` **18/18** (nuevo) · `npm run verify:admin`
**18/18** (antes 14: ahora incluye la puerta de permisos) · `npm run verify:isolation` **13/13** ·
créditos ✓ · `npm run verify:e2e` ✓ (worker 24/7 incluido) · `npm run preflight` 0 bloqueantes ·
`tsc` ✓ · `next lint` ✓ · `next build` ✓.

---

## 🧯 Duodécima ronda: el worker ya no inventa precios (15/10/2026)

Al reanudar la vista previa con el **scraper de verdad en marcha** salió a la luz el fallo más
peligroso de todo el proyecto. Estaba escondido porque hasta hoy el microservicio no había estado
vivo a la vez que los productos monitorizados.

### Qué pasaba

`checkProvider` (`workers/lib.ts`) intentaba leer el proveedor y, si no lo conseguía —página
bloqueada, diseño cambiado, precio tras registro, o simplemente que la URL no existe—, **fabricaba
un snapshot simulado y lo devolvía como si fuera el estado del proveedor**. El worker no distinguía
y lo aplicaba:

```
Mini Proyector Portátil        coste 46,50 € → 0,00 €        ← recalculado a 1,99 €
Organizador de Cocina          8,15 € → 0,00 €
Mochila Antirrobo              despublicada y marcada «agotada» teniendo 156 unidades
«Mochila Antirrobo… se ha agotado y se ha despublicado»  ← correo al cliente
```

Es decir: un proveedor caído o una página ilegible se convertían en **un cambio de precio real en la
tienda y en un correo al cliente**. En producción eso es vender a 1,99 € algo que cuesta 46,50 €.

### El arreglo: dos reglas

1. **Un snapshot del proveedor lleva ahora su fiabilidad declarada** (`reliable`, `unreliableReason`).
   Se marca como no fiable si el precio es 0 o si el propio extractor avisa de que no ha encontrado
   precio («No se ha encontrado el precio en la página…»).
2. **Lo simulado no toca datos reales.** El snapshot simulado sólo se acepta si el modo demo es
   *intencionado* (`SCRAPER_MODE=demo` o `providerMode: 'demo'` en el job). En modo real (`auto` o
   `service`), si el proveedor no se puede leer, el worker **deja el producto intacto** y lo registra:

```
[workers] ↳ snapshot no fiable (no se ha podido leer el proveedor y el snapshot simulado NO se
          aplica en modo real (la plataforma no inventa precios)): Mini Proyector sin cambios
[workers] ✔ sync:product sync-…-1792098900074 → SKIP (untrusted-snapshot)
```

El historial queda con nivel `WARN` y el usuario lo lee en su idioma: «Re-verificación descartada: …
El producto se queda como estaba (ni precio ni stock se han tocado); se reintentará en el próximo
chequeo».

### Reparación de los datos dañados

`scripts/repair-products.ts` (informa por defecto, aplica con `--apply`) devolvió los dos productos
a sus valores originales: Organizador de Cocina 8,15 € → 14,99 € y Mochila Antirrobo 14,20 € →
21,99 € con sus 156 unidades y de nuevo publicada.

### Verificación

- `verify:e2e` incluye ahora dos escenarios nuevos y **pasa completo** (el fallo se reprodujo primero
  y luego se corrigió, que es como debe hacerse):

```
• [proveedor ilegible] job 46 encolado → esperando al worker…
  job=completed · coste 42 (debe seguir 42) · venta 74.99 (debe seguir 74.99) · stock 120
✔ El worker descarta el snapshot ilegible: no se ha podido leer el proveedor…
✔ El coste NO se ha sobrescrito con 0
✔ El precio de venta NO se ha recalculado a ~0 €
✔ El stock del producto se mantiene intacto
✔ El producto sigue publicado (no se despublica por un error de lectura)
✔ Queda constancia en el historial
```

- Los escenarios de stock y precio del E2E (agotado, reactivación, recálculo) se ejecutan en modo
  simulado **a propósito**: el stock del proveedor no se puede controlar desde fuera y, si el
  escenario dependiera de lo que responda una tienda real, la verificación sería intermitente. El
  camino real lo cubren el escenario anterior y el importador de tienda desconocida.

### Suites tras la ronda

`verify:e2e` ✓ completo · `verify:fx` ✓ · `verify:admin` ✓ · `verify:catalog` **58/58** ·
`verify:isolation` **13/13** · `preflight` 0 bloqueantes · `tsc` ✓ · `next lint` ✓ · `next build` ✓.

---

## 💱 📬 Decimotercera ronda: dos piezas que ya no hay que contratar (15/10/2026)

Las dos cosas que quedaban «pendientes de conectar» y que **no dependen de pagar a nadie**.

### 1. Tipos de cambio automáticos (el BCE, gratis y sin clave)

La ronda anterior dejó la conversión de divisa funcionando, pero con tasas escritas a mano en
`FX_RATES`: una cifra que envejece y falsea el margen sin que nadie se entere. Ahora las tasas se
descargan **solas** de los tipos de referencia del Banco Central Europeo
(`api.frankfurter.app`, sin registro ni clave), al arrancar el motor y cada `FX_REFRESH_HOURS` (12 h).

- `src/lib/fx.ts`: caché en disco (`data/fx-rates.json`) que sobrevive a reinicios, prioridad
  `FX_RATES` (manual) → descarga del BCE → tasas de reserva, y `fxStatus()` para saber de dónde
  viene cada número.
- Worker: nuevo job `fx:refresh` (programado cada 12 h + uno al arrancar). Nunca lanza: si no hay
  internet, se mantienen las últimas tasas conocidas y se avisa.
- Se ve en tres sitios: `npm run preflight`, `/api/health` (`fx: Tipos del BCE de hace 0.1 h ·
  1 USD = 0.89 €`) y el **panel de operador** (línea «Cambio de divisa» con la antigüedad y el aviso
  de que toca refrescar). A mano: `npm run fx:refresh`.

Verificado en marcha (`verify:fx`, **27 comprobaciones**): descarga real del BCE, 16 divisas en
caché, no se gasta red si las tasas están frescas, `FX_RATES` manda sobre lo automático y, con el
feed caído, el sistema sigue operando con las últimas tasas conocidas. Y el circuito completo con
las tasas reales: `48 USD → 42,83 € · venta 60,99 € · beneficio 18,16 €` idéntico en la vista
previa, en la respuesta de importación y en la base de datos.

### 2. Correo real con tu propio buzón (SMTP, sin dependencias)

Los avisos y los enlaces de verificación sólo salían por consola (o exigían contratar Resend). Ahora
basta con **tu buzón de siempre** —Gmail, Zoho, tu hosting, Amazon SES— pegando cuatro datos:
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`.

- `src/lib/smtp.ts`: cliente SMTP escrito a mano (cero dependencias nuevas) con **STARTTLS** (587),
  **TLS directo** (465), **AUTH PLAIN y LOGIN**, CRLF correcto y **escapado del punto inicial** (sin
  eso, un mensaje que empieza una línea por «.» se corta o va a spam).
- Asuntos y nombres con acentos codificados según RFC 2047, `Message-ID`, `multipart/alternative`
  (texto + HTML): lo que piden los filtros antispam para no acabar en la carpeta de promociones.
- `npm run mail:dev-server`: buzón de prueba local que imprime los correos y los guarda como `.eml`
  en `logs/mail-out/`, para ver el flujo sin configurar nada. El script de arranque lo levanta solo
  cuando el correo apunta a `127.0.0.1`.

Verificado con `verify:mail` (**18 comprobaciones** sobre un servidor SMTP de prueba con certificado
autofirmado): negociación de STARTTLS, re-EHLO tras el cifrado, autenticación, sobre, cabeceras con
acentos, multipart, escapado del punto, credenciales rechazadas (error legible, sin excepción) y
servidor caído (la app no se rompe). Y **la prueba que de verdad importa**, con la aplicación en
marcha:

```
POST /api/auth/register { "email": "prueba.correo.…@ejemplo.es", … }
  → { ok: true, mail: { transport: "smtp", ok: true }, message: "Cuenta creada. Revisa tu correo…" }
Correo capturado:
  From: DropshipPilot <no-reply@dropshippilot.io>
  To: prueba.correo.…@ejemplo.es
  Subject: Confirma tu cuenta de DropshipPilot
  Content-Type: multipart/alternative; boundary="dp-86dfb25c4ac5cd11"
  Enlace: http://localhost:3000/verify?token=43Bkro7l-…
Abriendo ese enlace → { ok: true, "Email confirmado. Ya puedes iniciar sesión." }
Base de datos → emailVerifiedAt con fecha ✓
```

Es decir: alta → correo → enlace → cuenta verificada, de punta a punta y sin pagar por un servicio
de correo.

### Suites tras la ronda

`verify:mail` **18/18** (nuevo) · `verify:fx` **27/27** · `verify:admin` ✓ · `verify:catalog`
**58/58** · `verify:isolation` **13/13** · `verify:e2e` completo ✓ · `preflight` 0 bloqueantes
(correo y divisa pasan a verde) · `tsc` ✓ · `next lint` ✓ · `next build` ✓.

---

## 🛟 🗝 Decimocuarta ronda: copias que se restauran y derechos del cliente (15/10/2026)

Hasta aquí las copias eran un script manual (`scripts/verify-backup.sh`) y los derechos del RGPD
estaban prometidos en el DPA pero había que atenderlos a mano. Esta ronda cierra las dos cosas: la
red de seguridad que permite deshacer un error grave y el autoservicio que exige el Reglamento.

### 1. Copias de seguridad automáticas y comprobadas

| Pieza | Qué hace |
|---|---|
| `src/lib/backup.ts` | `runBackup()` vuelca con `pg_dump` (comprimido al vuelo), `listBackups()`, `pruneBackups()` respetando `BACKUP_MIN_KEEP`, `inspectDump()` (integridad + tablas clave), `backupStatus()` para el panel y `restoreDump()` para la restauración comparada |
| `scripts/backup.ts` | `npm run backup [-- --verify | --list]` |
| `workers/backupWorker.ts` | Cola `backup`, cron diario a `BACKUP_HOUR` (4:00), copia de arranque si la última tiene más de 36 h, auditoría `backup.created` / `backup.failed` |
| `Dockerfile.worker` | Añadido `postgresql16-client` para que el worker pueda volcar dentro del contenedor |

Comprobado:

```bash
$ npm run backup -- --verify
💾 Copia creada: backups/autods-2026-10-15-214018.sql.gz · 0,03 MB
🔍 Comprobación de integridad: 169 KB de SQL · 7 tablas clave presentes
♻️  Restauración de prueba en base temporal: OK
   User 2 · Store 3 · Product 9 · ProductVariant 16 · Order 6 · SyncLog 81 · AuditLog 11 — idénticos al original
🧹 Retención: 4 copias con más de 30 días borradas (se conservan las 3 más recientes por BACKUP_MIN_KEEP)
```

El primer intento falló con `Z_DATA_ERROR`: `pg_dump` escribía en crudo a un fichero `.sql.gz`. Se
corrigió con una tubería `pg_dump → zlib.createGzip → fichero` (y el tipo de `stdoutTo` pasó a
`NodeJS.WritableStream`, porque un `Gzip` no es un `fs.WriteStream`).

Restauración a mano, en un comando:

```bash
gunzip -c backups/autods-AAAA-MM-DD-HHMMSS.sql.gz | psql "$DATABASE_URL"
```

### 2. Derechos del cliente desde el panel (art. 15, 17 y 20)

`Configuración → Tus datos y tu cuenta` (`(dashboard)/settings/data-rights-card.tsx`):

- **Descargar mis datos**: `GET /api/account/export` → `mis-datos-dropshippilot-<fecha>.json` con 13
  secciones (cuenta, suscripción, tiendas, productos, variantes, pedidos y líneas, reglas de precio,
  cuentas de proveedor, historial de sincronización y registro de accesos). `Cache-Control: no-store`,
  audita `account.exported`, máximo 3 descargas/hora.
- **Borrar mi cuenta**: `DELETE /api/account` exige `{"confirm":"BORRAR MI CUENTA"}` y la contraseña si
  la cuenta la tiene; cancela antes la suscripción en Stripe o Lemon Squeezy, borra en cascada y
  **comprueba que no queda residuo** antes de responder. Máximo 5 intentos/hora.

### 3. La prueba de fuego: borrado real por HTTP, sobre una copia de la base

Para no arriesgar los datos del panel, se hizo el ensayo completo **contra la copia de seguridad
restaurada en otra base** (`autods_gdpr_test`) y arrancando una segunda instancia de la app apuntando
a ella (`next start -p 3001` con `DATABASE_URL` cambiada):

```bash
$ gunzip -c backups/autods-2026-10-15-214030.sql.gz | psql autods_gdpr_test     # sin errores

$ curl -s localhost:3001/api/account/export | jq '.meta.userId, (.sections|length)'
cmva1c6jj00005i3c4197kw64 · 13 secciones

$ curl -s -X DELETE localhost:3001/api/account -H 'content-type: application/json' \
    -d '{"confirm":"BORRAR MI CUENTA","password":"DemoPanel123"}'
{"ok":true,"message":"Tu cuenta y tus datos se han borrado. Sentimos verte marchar.",
 "deleted":{"tiendas":2,"productos":7,"pedidos":6,"cuentasDeProveedor":0,"registrosDeSync":75,
 "reglasDePrecio":3,"suscripcion":1},"subscriptions":[],"warnings":[]}

# Lo que queda en la copia: sólo los datos del OTRO cliente (aislamiento intacto)
usuarios=1 tiendas=1 productos=2 variantes=4 pedidos=0 lineas=0 reglas=1 syncs=6
auditoria_borrado=1 · entradas_que_apuntan_al_usuario_borrado=0

# Y la base real, ni tocada
usuarios=2 tiendas=3 productos=9 pedidos=6
```

La entrada de auditoría que sobrevive:

```json
{ "email": "demo@dropshippilot.io", "reason": "petición del cliente",
  "deleted": { "pedidos": 6, "tiendas": 2, "productos": 7, "suscripcion": 1,
               "reglasDePrecio": 3, "registrosDeSync": 75, "cuentasDeProveedor": 0 },
  "userId": null }
```

Ni identificador, ni contenido, ni credenciales: sólo la constancia de que se atendió el borrado.

### 4. Dos detalles que salieron al probar

- **`429` sin cabecera de caché**: al abusar a propósito de las descargas, la respuesta del limitador
  llegaba sin `Cache-Control`. Se añadió `no-store` a `tooManyRequests()` en `src/lib/rate-limit.ts`,
  así que ninguna respuesta rechazada puede quedar cacheada por un proxy intermedio.
- **La frase de confirmación estaba escrita en dos sitios** (lib y ruta). Ahora es una sola constante
  exportada (`CONFIRMATION` en `src/lib/account-data.ts`) y la usa también la interfaz, de modo que no
  pueden divergir y dejar al cliente sin poder borrar su cuenta.

### 5. Suites tras la ronda

`verify:gdpr` **44/44** (nuevo) · `verify:mail` 18/18 · `verify:fx` 27/27 · `verify:admin` ✓ ·
`verify:catalog` 58/58 · `verify:isolation` 13/13 · `verify:e2e` ✓ · `preflight` 0 bloqueantes ·
`tsc` ✓ · `next lint` ✓ · `next build` ✓ · páginas `/`, `/products`, `/settings`, `/catalog`,
`/admin`, `/import` respondiendo · `/api/health` con `postgres`, `redis`, `scraper` y `fx` en verde
(Stripe en rojo sólo porque no hay claves, como corresponde).

Lo que `verify:gdpr` comprueba de verdad, no de adorno: que la exportación trae las filas que existen
(no sólo las secciones), que **los secretos no salen** (token de tienda, secreto de webhook,
credenciales de proveedor y huella de la contraseña: ninguno aparece en el fichero), que el pedido se
exporta con su dirección y su cliente final, que tras el borrado no queda **ni una fila** en once
tablas relacionadas, que la auditoría conserva una entrada anonimizada y que la copia más reciente
pasa la comprobación de integridad y tiene menos de 24 h.


---

## 🧭 Decimoquinta ronda: acompañar al usuario la primera vez (15/10/2026)

Un cliente nuevo entraba a un panel con 13 pestañas y sin nadie que le explicara nada. Esta ronda añade el
tutorial guiado acordado: **tarjeta de bienvenida → recorrido de 12 pasos, uno por pestaña → una sola vez**.

### 1. Cómo funciona

| Pieza | Qué hace |
|---|---|
| `src/lib/tour-steps.ts` | Los 12 pasos en datos puros: pestaña, título, explicación, consejo y selectores `data-tour="..."` a resaltar (con alternativa por si la pantalla está vacía) |
| `src/components/tour/guided-tour.tsx` | Tarjeta de bienvenida, burbuja con Siguiente/Atrás/Saltar, resaltado por agujero en la capa oscura (**no bloquea los clics**), despedida, teclado (Esc, ←/→) y burbuja abajo en móvil |
| `src/lib/tour.ts` + `src/app/api/account/tour/route.ts` | Estado en la cuenta (`GET` y `POST` con `accept` · `complete` · `dismiss` · `restart`), límite de 30 peticiones/minuto, auditoría de la decisión |
| `(dashboard)/layout.tsx` | Lo monta en todas las pestañas y le pasa el estado del usuario |
| `(dashboard)/settings/help-tour-card.tsx` | *Configuración → Ayuda y tutorial guiado*: volver a verlo y la lista de los 12 pasos |

Estados (`User.tourVersion`): **0** pendiente (se ofrece la tarjeta) · **1** aceptado y en curso (si recarga, se
reanuda sin volver a preguntar) · **2** terminado o saltado (no vuelve a salir solo; sí desde Configuración).
Si algún día se añaden pasos, se sube `TOUR_VERSION` y vuelve a ofrecerse una sola vez: nadie se queda con un
tutorial viejo a medias.

### 2. Comprobado de verdad

En un navegador real (`scripts/verify-tour-ui.py`, 14 comprobaciones) y con la suite `npm run verify:tour`
(23 comprobaciones):

```
✔ Al entrar por primera vez sale la tarjeta de bienvenida
✔ Al aceptar arranca el recorrido en el paso 1 — «1 de 12 · Dashboard»
✔ La pestaña que toca queda iluminada en el menú
✔ «Siguiente» cambia de pestaña de verdad — /catalog
✔ «Atrás» vuelve al paso anterior
✔ Si recarga a mitad, el recorrido se reanuda solo
✔ Al saltarlo queda registrado en la auditoría y ya no vuelve a salir — tourVersion=2
✔ En Configuración está el bloque de ayuda y el botón lo vuelve a ofrecer
✔ En el móvil funciona con la burbuja abajo
```

### 3. Dos fallos cazados por las pruebas (y corregidos)

- **Eran 13 pasos, no 12**: el catálogo ocupaba dos (uno para el buscador y otro para el botón «Importar»). Se
  unificaron en un solo paso: ahora el ancla es la primera tarjeta y el texto explica a la vez el buscador y el botón.
- **El guardado confundía «empecé» con «terminé»**: aceptar y completar escribían lo mismo, así que quien aceptaba
  y recargaba no volvía a ver el recorrido (se quedaba a medias para siempre). Se separó en los tres estados de arriba,
  y el ensayo lo detectó: *«Al aceptar queda en curso: no vuelve a preguntar, pero se reanuda si recarga»*.

### 4. Suites tras la ronda

`verify-tour` **23/23** (nuevo) · recorrido con navegador **14/14** (nuevo) · `verify:gdpr` 44/44 · `verify:mail` 18/18 ·
`verify:fx` 27/27 · `verify:admin` ✓ · `verify:catalog` 58/58 · `verify:isolation` 13/13 · `verify:e2e` ✓ ·
`preflight` 0 bloqueantes · `tsc` ✓ · `next lint` ✓ · `next build` ✓.


---

## 🪜 Decimosexta ronda: la lista que se marca sola y el recorrido del operador (15/10/2026)

Cierre del acompañamiento al cliente nuevo. A la ronda anterior (el tutorial guiado) le faltaban dos piezas:
una lista que diga **qué toca hacer** y un recorrido para quien vende el servicio.

### 1. «Tus primeros pasos» (portada del panel)

`src/lib/onboarding.ts` calcula el estado leyendo la base de datos, no marcas puestas a mano:

| Tarea | Se marca cuando | Comprobado |
|---|---|---|
| Haz el recorrido guiado | `tourVersion >= TOUR_VERSION` | ✔ al saltarlo también |
| Conecta tu tienda | existe una tienda en estado `CONNECTED` | ✔ al crearla |
| Importa tu primer producto | el cliente tiene algún producto | ✔ al importarlo |
| Deja que el robot lo vigile | hay un `SyncLog` correcto del worker | ✔ al sincronizar |
| Elige cómo cobrar | suscripción de pago (Stripe/Lemon) o plan distinto de TRIAL | ✔ |

- Progreso «N de 5», botón **Ir** en cada pendiente (la del tutorial arranca el recorrido directamente).
- **Cuando están las cinco, la tarjeta desaparece sola.** Y el cliente puede **ocultarla** antes y **recuperarla** desde
  *Configuración → Ayuda y tutorial guiado* (`User.onboardingHiddenAt`).
- API: `GET/POST /api/account/onboarding` (`hide` · `show`), sin caché y con límite de 30 peticiones/minuto.

En el esquema, el campo muerto `onboardingStep` se sustituyó por `adminTourVersion`, `adminTourSeenAt` y `onboardingHiddenAt`.

### 2. Tutorial del operador (5 pasos, dentro de Administración)

`ADMIN_TOUR_STEPS` reutiliza el mismo motor (`GuidedTour`) con otro juego de pasos: métricas de la plataforma,
clientes y sus planes, claves de proveedor, catálogo servido y lo que se mantiene solo (divisas, copias, vigilancia).
Estado propio en `adminTourVersion` / `adminTourSeenAt` y auditoría `tour.admin.*`, de modo que **los dos recorridos no se pisan**:
el del cliente sigue igual mientras el operador hace el suyo.

Se ofrece **dentro de `/admin`** y sólo cuando el recorrido del cliente ya está resuelto (así nadie ve dos tarjetas de golpe),
y `GET /api/account/tour?scope=admin` responde **403** a quien no es operador.

### 3. Tres fallos cazados por las pruebas (y corregidos)

1. **El tutorial no reaccionaba al estado del servidor**: si se arrancaba desde la lista de primeros pasos o desde Configuración,
   no se abría hasta recargar (`useState` sólo leía el estado al montar). Ahora un `useEffect` sigue las props
   (`shouldOffer` / `inProgress`) y abre o cierra el recorrido sin recargar, con un cerrojo para que no se reabra si el
   usuario lo cerró él mismo.
2. **La tarjeta del operador aparecía en la portada del cliente**: se movió a la propia página de Administración.
3. **El ensayo necesitaba datos que la cuenta real ya tenía completos**: con las 5 tareas hechas la lista desaparece
   (correcto), así que la prueba de ocultar/recuperar ahora deja una tarea pendiente de forma temporal y restaura el estado.

### 4. Nota de operación (aprendida a golpes en esta ronda)

Al tocar el esquema (`prisma db push`) hay que **reiniciar la web y los workers**: el cliente de Prisma que
tienen cargado en memoria sigue esperando las columnas antiguas, y las consultas empiezan a fallar con
`The column User.onboardingStep does not exist in the current database` (el worker encolaba los jobs como
`failed` y la suite E2E lo destapó con 11 fallos). Con `./scripts/start-everything.sh` no pasa, porque hace
el `db push`, regenera el cliente y arranca todo de nuevo.

También quedó más robusta la infraestructura de pruebas:
`verify-catalog` reinicia el contador de cuota del mes antes de comprobar el tope (antes, al ejecutarlo
muchas veces seguidas, agotaba la cuota real de 10 llamadas), y el ensayo con navegador de primeros pasos
guarda el estado de la suscripción antes de tocarlo y lo restaura acotado a su propia cuenta.

### 5. Suites tras la ronda

`verify:onboarding` **29/29** (nuevo) · recorrido con navegador **24/24** (nuevo) · `verify:tour` 23/23 · recorrido con navegador 14/14 ·
`verify:gdpr` 44/44 · `verify:mail` 18/18 · `verify:fx` 27/27 · `verify:admin` ✓ · `verify:catalog` 58/58 ·
`verify:isolation` 13/13 · `verify:e2e` ✓ · `preflight` 0 bloqueantes · `tsc` ✓ · `next lint` ✓ · `next build` ✓.


---

## ✉️ Decimoséptima ronda: el acompañamiento también llega al correo (15/10/2026)

El tutorial y la lista de primeros pasos vivían sólo dentro del panel: si el cliente se registraba y no
volvía, no se enteraba de nada. Esta ronda cierra el círculo con dos correos, probados contra un servidor
SMTP real de pruebas leyendo los mensajes capturados.

### 1. Bienvenida con la lista de primeros pasos

El correo del alta ya no es un «confirma tu cuenta» a secas: incluye el bloque **«Tus primeros pasos ·
0 de 5 hechos»**, con cada tarea enlazada a su pantalla (`/dashboard`, `/stores`, `/catalog`, `/monitor`,
`/billing`) y el aviso de que estos correos se pueden apagar. Asunto nuevo: *«¡Bienvenido a DropshipPilot!
Confirma tu cuenta»*. Se guarda una copia legible en `logs/mail-out/bienvenida-muestra.html`.

### 2. Recordatorio único (y sólo cuando toca)

`workers/onboardingWorker.ts` (cola `onboarding`, dentro de `npm run worker`) revisa cada 6 h quién se
registró hace más de 24 h y **sigue con tareas pendientes**, y le manda un correo con las que le faltan:
*«Tu tienda aún no vende sola: te quedan N pasos»*. Después marca `User.onboardingNudgedAt` y **no vuelve
a escribirle nunca**.

Filtros que evitan molestar:

| Situación | Qué pasa | Comprobado |
|---|---|---|
| Ya tiene las 5 tareas hechas | No se le escribe; queda anotado el motivo (`ya terminado`) | ✔ |
| Apagó los avisos de acompañamiento | Ni entra como candidato (el filtro va en la consulta) | ✔ |
| Se registró hace menos de 24 h | No se le escribe: primero se le deja tiempo | ✔ |
| `ONBOARDING_EMAILS=false` | No se envía nada en absoluto | ✔ |
| Ya recibió el recordatorio | Segunda pasada = 0 correos | ✔ |

Preferencia nueva en *Configuración → Avisos por correo* (**«Primeros pasos y acompañamiento»**), auditoría
`onboarding.nudged` con las tareas que le faltaban y el transporte usado, y las marcas incluidas en la
exportación de datos del cliente (art. 15).

### 3. Un detalle de redacción cazado por la prueba

Al revisar la captura del correo se veía `…caduca en 24 horas).Tu cuenta ya está casi lista. Dentro tienes
13 pantallas…`: el cuerpo se pegaba al párrafo anterior sin espacio y repetía la idea del enlace. Reescrito:
primero la confirmación, luego la promesa («no estarás solo delante de un panel vacío») y después la lista.

### 4. Suites tras la ronda

`verify:onboarding-mail` **34/34** (nuevo, con SMTP real de pruebas) · `verify:onboarding` 29/29 · `verify:tour` 23/23 ·
`verify:gdpr` 44/44 · `verify:mail` 18/18 · `verify:fx` 27/27 · `verify:admin` ✓ · `verify:catalog` 58/58 ·
`verify:isolation` 13/13 · `verify:e2e` ✓ · `tsc` ✓ · `next lint` ✓ · `next build` ✓.

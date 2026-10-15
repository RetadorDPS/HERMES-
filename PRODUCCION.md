# 🎯 ¿Está listo para producción? — Auditoría honesta

Fecha: 15/10/2026 · Autor: la IA que ha construido y probado el proyecto.
Sin marketing: lo que sigue es lo que **se ha ejecutado y comprobado** y lo que no.

> Actualización de esta versión (octava ronda): además del multi-cliente, el
> ciclo de cuenta, los planes y las APIs de proveedores, el producto ya incluye
> **cobro alternativo con Lemon Squeezy** (para empezar sin alta de autónomo),
> **instalación de Shopify en un clic (OAuth)**, **avisos por correo** al
> cliente, **panel de administración** para operar la plataforma y **pruebas
> automáticas en cada despliegue**. Lo que sigue separa lo probado en este
> entorno de lo que exige credenciales y servicios reales que aquí no existen.

---

## 🟢 Verde — Funciona y está probado con evidencia

### Núcleo del negocio (ya existía)

| Área | Evidencia |
|---|---|
| Base de datos | Esquema Prisma ampliado (usuarios, suscripciones, tokens, auditoría, cuentas de proveedor) aplicado en PostgreSQL 16 real y consultado |
| Worker 24/7 | Agotado automático (156→0 → `OUT_OF_STOCK`), reactivación (0→440), recálculo de precio (coste 99,99→11,66 ⇒ precio 149,99→16,99), segunda pasada incremental en 15 ms |
| Motor de precios | Reglas de margen + redondeo, verificadas con casos reales |
| Importador por URL | Extracción → previsualización editable → guardado |
| Webhooks | Shopify (HMAC, firmas falsas rechazadas) y WooCommerce (reintentos, idempotencia, cancelaciones) |
| Pedidos → proveedor | Cola BullMQ → worker → compra + `SyncLog`; cancelados omitidos |
| Endurecimiento web | Cabeceras estrictas, rate limit en extracción/login/alta, cifrado AES-256-GCM de credenciales |

### Multi-cliente y SaaS (nuevo, verificado hoy)

| Área | Evidencia |
|---|---|
| **Aislamiento entre clientes** | `npm run verify:isolation` → **13/13**. Cada cliente sólo ve sus filas; sin contexto la consulta **falla** (fail-closed); leer por id lo ajeno devuelve `null`; modificar lo ajeno afecta a **0 filas**; crear datos a nombre de otro cliente se bloquea; el modo sistema del worker sí ve todo |
| **Aislamiento por HTTP con dos sesiones reales** | Sesión A (`demo@…`, PRO): 6 productos y 10 pedidos. Sesión B (`cliente@…`, STARTER): 2 productos y 0 pedidos. `PATCH` del producto de A desde B → **404**, y el dato de A quedó intacto |
| **Sin sesión** | Páginas → redirección a `/login`; APIs → **401** en JSON (ya no 500) |
| **Ciclo de cuenta** | Registro (201 + token), reenvío de verificación, verificación por enlace (token SHA-256, un solo uso), login real NextAuth, «olvidé mi contraseña» → reset con token. Todo probado por HTTP con tokens reales |
| **Anti-fuerza bruta en login** | 10 intentos por IP+email cada 15 min → a partir del 11 el login queda bloqueado 15 min (comprobado: 10 `usuario_inexistente` + bloqueos `bloqueado_por_intentos`) |
| **Planes, límites y créditos** | `npm run verify:credits` → **6/6**: el consumo de un cliente no afecta al otro, agotar saldo lanza error antes de ejecutar la operación, el plan TRIAL corta a los 25 productos, el cambio de periodo reinicia créditos |
| **Frecuencia de sync por plan** | `npm run verify:ops` → **17/17**: cada plan respeta su intervalo real (Prueba 360, Starter 120, Pro 60, Enterprise 30 min); el motor omite los productos frescos y lo registra. Antes de esta ronda la web lo prometía y el motor no lo cumplía |
| **Vigilancia del sistema** | `npm run verify:ops` → detección de caída con gravedad, correo a los ADMIN, freno anti-spam y auditoría. En el motor: job `health:watch` cada 15 min (primera ejecución real: «sistema sano · db 12 ms · 0/23 fallos en la última hora») |
| **Cobros** | `/billing` con plan actual, renovación, consumo de créditos y uso vs límites; `POST /api/billing/checkout` y `/portal`; webhook `/api/webhooks/stripe` con verificación de firma y eventos de suscripción |
| **Conexión de APIs oficiales de proveedores** | `/suppliers` + `/api/supplier-accounts`: catálogo (AliExpress, CJ, Amazon, Alibaba, Temu), credenciales cifradas, máscara, límites por plan, prueba real contra la API, y borrado. Con credenciales falsas la respuesta fue **el error real del proveedor** (CJ devolvió su mensaje de autenticación en 245 ms) |
| **Dos clientes para demostrar** | `npm run seed:demo`: `demo@dropshippilot.io` / `DemoPanel123` (PRO, 6 productos) y `cliente@dropshippilot.io` / `ClienteDemo123` (STARTER, 2 productos y 1 tienda) |
| **Auditoría** | Cada acción sensible (altas, logins, fallos, cambios de plan, pruebas de proveedor) queda en `AuditLog` con contexto propio |
| **Segundo factor (2FA/TOTP)** | `npm run verify:2fa` → **16/16** (incluye el vector de prueba del RFC 6238). Por HTTP: contraseña sola → **rechazada**; contraseña + código falso → rechazada; código correcto → entra; código de recuperación → entra **una sola vez** (9 quedan); desactivar exige contraseña + código. Secreto cifrado y códigos de recuperación hasheados. QR generado en el servidor (la app no pide nada a Internet) |
| **Copias de seguridad restauradas** | `npm run verify:backup` → volcado, restauración en una base temporal y comparación tabla a tabla: **11/11 coinciden** (User, Store, Product, ProductVariant, ProductReview, Order, SyncLog, AuditLog, Supplier, SupplierAccount, Subscription). Además `scripts/restore.sh` con confirmación escrita |
| **Comportamiento bajo carga** | `npm run verify:load` → **300 peticiones, 25 en paralelo, 0 errores**, 65 peticiones/s, p50 126 ms / p95 325 ms (una sola máquina, datos de demo) |
| **Webhook de Stripe (firma real)** | `npm run verify:stripe` → **15/15**: firma falsa rechazada (400) sin tocar datos; pago → plan PRO + suscripción ACTIVE + créditos a 0; renovación → créditos reiniciados; cancelación → vuelta a TRIAL; evento desconocido ignorado; sin cabecera → 400. Firma calculada como la de Stripe (HMAC-SHA256 `<t>.<cuerpo>`), verificada por la librería oficial |
| **Webhooks de tienda (firma real)** | `npm run verify:webhooks` → **12/12**: pedido WooCommerce creado **en el cliente dueño de la tienda** (contador +1), reenvío detectado como duplicado sin duplicar el pedido, firma falsa → 401, y lo mismo para Shopify (pedido + firma falsa rechazada) |
| **Cobro alternativo con Lemon Squeezy** | `npm run verify:lemon` → **24/24**: firma inválida rechazada (401) sin tocar datos; alta → plan PRO + ACTIVE + 25.000 créditos; renovación → créditos reiniciados; pago fallido → PAST_DUE **con aviso por correo**; evento sin metadata localizado por id de suscripción; cancelación → TRIAL. La llamada de checkout llegó a la API real de Lemon (rechazó la clave falsa de prueba) |
| **Instalación de Shopify en 1 clic (OAuth)** | Flujo probado con app simulada: redirección correcta con `state` firmado y caducidad; callback con hmac falso, **state de otro usuario** o state manipulado → rechazados y redirigidos con motivo; con firma correcta el flujo alcanzó la API real de Shopify y falló con elegancia (código falso). Sin configurar, la conexión manual por token sigue disponible |
| **Avisos por correo** | `npm run verify:alerts` → **10/10** (envío, freno anti-spam, respeto de preferencias, rutas HTTP y auditoría). **Prueba de punta a punta en el motor real**: stock a 0 → barrido → producto reactivado (`STOCK_UPDATE SUCCESS`, 0 → 1198 uds) y correo generado al dueño |
| **Panel de administración de la plataforma** | `npm run verify:admin` → **14/14**: un cliente normal no pasa el guardián; el operador sí; métricas globales (clientes, MRR estimado, tiendas, productos, actividad 24 h); suma y resta de créditos por la ruta real ida y vuelta; cambios auditados. `/admin` en el panel con KPIs y acciones de soporte |
| **Pruebas automáticas en el despliegue** | `npm run smoke` → **7/7** por HTTP contra la app (salud, login y los tres webhooks) y `deploy.sh` ejecuta humo + `preflight` dentro del contenedor antes de declarar el despliegue correcto |

---

## 🟡 Ámbar — El código está escrito y maneja errores, pero **nunca se ha hablado con el servicio real**

Esto es lo más importante que debes entender antes de vender:

| Área | Qué significa de verdad |
|---|---|
| **AliExpress Open Platform** | El cliente está implementado (token, región `sg`/`eu`, creación de pedidos) y **sin credenciales válidas el servicio responde HTML/bloqueo** (probado en vivo). Para operar necesitas una app aprobada por AliExpress y un Access Token OAuth. |
| **CJ Dropshipping** | La llamada real funciona de verdad (el endpoint responde en ~250 ms); con claves falsas devuelve su propio error de autenticación, que se muestra al cliente. Nunca se ha hecho una **compra real**. |
| **Amazon PA-API** | Es de **solo lectura**: catálogo y precios. No permite crear pedidos; la compra automatizada exigiría Amazon Business/SP-API. |
| **Shopify / WooCommerce** | Endpoints correctos (GraphQL 2025-01 / REST), probados contra respuestas simuladas. **Nunca se ha publicado un producto ni importado un pedido de una tienda real**. Primera conexión real: cuenta con una tarde de ajustes. |
| **Extracción por scraping** | Sin proxies residenciales de pago **no extrae** (AliExpress bloquea IPs de servidor; comprobado). La vía limpia ya está integrada: usa la API oficial del proveedor cuando el cliente la conecta. |
| **Stripe** | Checkout, portal y webhook funcionan (webhook probado con firmas reales, 15/15). Lo que falta es sólo de tu cuenta: crear la clave de test, copiar el `whsec_…` y apuntar el endpoint. `npm run stripe:setup --key=sk_test_…` crea los 6 precios por API y escribe el `.env.local`; sólo acepta claves de test. **Nunca se ha cobrado un euro.** |
| **Lemon Squeezy** | Integración completa y verificada con firmas reales, pero **nunca se ha cobrado un euro real** ni se ha creado una cuenta: falta tu API key, el id de tienda, las 6 variantes y el secreto del webhook. |
| **Correo** | Sin `RESEND_API_KEY` los avisos y verificaciones salen por consola (y la pantalla muestra el enlace). Con clave, envío real sin verificar (no se ha entregado correo a un buzón real desde aquí). |
| **Robustez del scraping** | Los selectores se rompen cuando el proveedor cambia su HTML: es el punto más frágil de cualquier clon de AutoDS. |
| **Páginas legales** | Existen `/privacy`, `/terms` y `/cookies` enlazadas desde el login, **pero son plantillas**: llevan marcadores `[RAZÓN SOCIAL]`, `[NIF]`… que debes rellenar y, sobre todo, **revisar con asesoría legal** antes de vender a terceros. |

---

## 🔴 Rojo — No está hecho (y no deberías suponer que sí)

| Falta | Consecuencia |
|---|---|
| **Monitorización externa** | La **vigilancia interna** ya existe (job `health:watch` cada 15 min que comprueba base de datos, Redis, colas, scraper y salud de sync, y avisa a los ADMIN por correo). Sigue faltando algo **externo** (UptimeRobot/Sentry): si el servidor entero se apaga, el que avisa está apagado con él. |
| **Encargado de tratamiento (DPA)** | La **plantilla completa** está en `DPA.md` (art. 28 RGPD, anexos de medidas y subencargados). Falta que la revise un profesional y rellenar tus datos. |
| **Facturación fiscal** | Stripe cobra, pero no hay facturas con IVA ni datos fiscales del cliente. Ver `PAGOS.md`: si facturas como persona física necesitarás un programa de facturación (VeriFactu obligatorio desde julio de 2027). |
| **Pruebas de interfaz y de carga real** | Hay una prueba de carga ligera (300 peticiones) y ninguna de navegador. No se ha probado con decenas de clientes ni con miles de productos: la prueba hecha no sustituye a eso. |
| **Escalado** | Un servidor. Redis, workers y web comparten máquina. |
| **Docker nunca ejecutado aquí** | Sin Docker en mi entorno: el compose está validado por sintaxis y equivalencia funcional (los mismos procesos en nativo), pero el primer `docker compose up` puede pedir ajustes menores. |
| **Soporte y onboarding** | No hay centro de ayuda, ni proceso de alta guiado para clientes nuevos. |

---

## Veredicto

**¿Para tu propio negocio de dropshipping? Sí.** Despliega con `./scripts/deploy.sh`.
Cuenta con una tarde de depuración al conectar la primera tienda y los proxies reales.

**¿Para venderlo como servicio a otros clientes? El software ya está; falta la validación real y lo legal.**
Todo lo que un cliente pediría el primer día está implementado y verificado: cuenta propia con
datos aislados, planes con límites y créditos, **dos formas de cobrar** (Stripe o Lemon Squeezy),
instalación de tiendas en un clic, avisos por correo, y un **panel de administración** para ver a
tus clientes, su consumo y ajustarles plan o créditos. Lo que impide decir «ábrelo al público
mañana» no es el código: es que nadie ha conectado todavía una tienda real, no se ha cobrado un
euro, no hay monitorización externa ni páginas legales definitivas, y las credenciales de
proveedor necesitan que tú apruebes las apps (AliExpress tarda días).

**Estado tras esta sesión**: 2FA, restauración de copias, prueba de carga, webhooks firmados,
centro de conexión, cobro alternativo con Lemon Squeezy, avisos por correo, panel de administración
y pruebas de despliegue ya **no son deuda pendiente**.

**Importante**: en esta ronda se encontró y corrigió un fallo que habría roto la facturación y los
pedidos en producción: los tres webhooks (Stripe, Shopify, WooCommerce) se ejecutaban **fuera del
contexto de cliente**, así que la capa de aislamiento los bloqueaba. Ahora verifican la firma e
identifican al dueño en modo sistema y el trabajo ocurre en el contexto de ese cliente. Los tres
tienen prueba con firmas reales.

**Ruta recomendada: lanzamiento controlado.** Cobra a los primeros 3–5 clientes invitados,
con estas condiciones de entrada:

1. Claves de Stripe (primero test, luego producción) y una suscripción de prueba cobrada de verdad.
2. Una tienda Shopify y una Woo reales conectadas, con un producto publicado y un pedido importado.
3. Una cuenta real de CJ (o tokens de AliExpress) para hacer **un pedido real** de principio a fin.
4. UptimeRobot/Sentry apuntando a `/api/health`.
5. Rellenar y revisar las plantillas legales (privacidad, términos, cookies) y preparar el DPA.
6. Programar la copia diaria del compose y repetir `npm run verify:backup` en el servidor.

Cuando esos seis puntos estén hechos, la frase «listo para venderlo» deja de ser una promesa
y pasa a ser un hecho comprobado.

---

## Antes de darle a desplegar (checklist de 30 minutos)

> Divisas: si vas a vender productos de proveedores que cobran en USD (CJ, tiendas sueltas),
> revisa `FX_RATES` en `.env` — el motor de precios convierte a EUR con esas tasas. Y deja
> `LOCAL_ADMIN_MODE="false"`: con él en `true` el panel de operador queda abierto sin sesión.


1. `./scripts/deploy.sh` en el servidor (te pide dominio y credenciales).
2. Entra al panel y revisa **Configuración → estado del sistema** (todo verde salvo Stripe, que es normal).
3. Crea una **tienda de desarrollo de Shopify** (gratis) y conéctala: la forma más segura de
   probar la publicación real sin arriesgar tu tienda.
4. Importa un producto y publícalo en esa tienda de prueba.
5. Haz un pedido de prueba → comprueba que entra en *Pedidos* y se encola el envío.
6. Regístrate en **UptimeRobot** (gratis) apuntando a `https://tudominio.com/api/health`.
7. Añade tus proxies residenciales o tus credenciales de proveedor y valida desde *Proveedores*.
8. Configura el cobro: **Stripe** (claves + webhook; `npm run stripe:setup --key=sk_test_…`) o
   **Lemon Squeezy** si prefieres cobrar sin alta de autónomo (ver `PAGOS.md`), y haz la primera
   compra de prueba.
9. Ejecuta **`npm run smoke`** contra tu dominio: si sale en verde, la app y sus tres webhooks
   responden desde Internet. Repítelo en cada actualización (el despliegue ya lo hace solo).
10. Si vas a vender a terceros: `npm run admin -- tu@correo.com` para abrir el **panel de
    administración** (`/admin`), y conecta los avisos por correo con `RESEND_API_KEY` para que tus
    clientes reciban avisos de stock, fallos de sync y pagos.

Cuando los pasos 3–5 y 8 funcionen con datos reales, habrás pasado de "probado con
simulaciones" a "probado en producción".

---

## Historial de rondas (qué se añadió y cuándo)

**Décima ronda (15/10/2026, noche)** — **catálogo servido por la plataforma**: índice propio
(`CatalogItem`/`CatalogCategory`), **claves de proveedor compartidas** cifradas con panel de
operador (`PlatformCredential`, Administración → Claves de proveedor), worker de catálogo
(`workers/catalogWorker.ts`, cola `catalog`), pantalla **`/catalog`** con categorías visuales,
buscador, filtros, precio de venta y beneficio con la regla del usuario, e importación en un clic
reutilizando `/api/import` (2 créditos, sin re-extracción). Sin claves se sirve un catálogo de
muestra etiquetado que se sustituye solo al llegar el real. Verificación: **41/41**
(`npm run verify:catalog`). Se corrigió el límite real de CJ (1 petición/segundo).

**Novena ronda (15/10/2026, tarde)** — ciclo operativo completo: **frecuencia de sincronización
real por plan** (30/60/120/360 min, antes sólo prometida en la web), **vigilancia del sistema**
con aviso por correo a los operadores cuando algo se degrada (`health:watch` cada 15 min,
`npm run watchdog`), y **plantilla de contrato de encargado del tratamiento** (`DPA.md`).
Se corrigió además un fallo de robustez: las comprobaciones de salud se colgaban si Redis estaba
caído (ioredis reintentando en segundo plano).

**Octava ronda (15/10/2026, tarde)** — cinco mejoras de producto, todas verificadas:
Lemon Squeezy (24/24), OAuth de Shopify (flujo probado con app simulada), avisos por correo (10/10
+ prueba real en el motor 24/7), panel de administración (14/14) y pruebas automáticas en el
despliegue (`smoke` 7/7 + `preflight` dentro del contenedor). El centro de conexión vigila ya
**15 piezas** y la copia de seguridad de esta ronda volvió a restaurarse con **11/11 tablas iguales**.

**Séptima ronda (15/10/2026)** — Centro de conexión (`/setup` + `npm run preflight`), protección de
`/api/proxies`, `next lint` limpio y las 7 suites anteriores en verde.

**Sexta ronda (14/10/2026)** — 2FA/TOTP, copias de seguridad restauradas, prueba de carga, webhooks
firmados y páginas legales (plantillas). Se corrigió el fallo de contexto que habría roto la
facturación y los pedidos en producción: los tres webhooks se ejecutaban fuera del contexto de
cliente.

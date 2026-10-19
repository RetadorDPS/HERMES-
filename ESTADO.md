# DropshipPilot — Estado real del proyecto

> **Aviso:** este documento describe la versión COMPLETA con servidor propio, que NO es la que está publicada hoy. Para saber qué funciona de verdad, lee [`docs/estado-real.md`](./docs/estado-real.md).

Fecha: 15/10/2026 · Autor: el asistente de Arena · **sin adornos: lo que está probado va con su número, lo que no, se dice**

---

## 1. Respuesta corta

| Pregunta | Respuesta honesta |
|---|---|
| ¿Está todo construido? | **Sí, todas las piezas existen y están conectadas entre sí.** El flujo completo (scraping → precios → importación → tienda → pedido → proveedor → seguimiento → aviso) funciona de punta a punta **en el entorno de pruebas**. |
| ¿Hay errores de código? | **Ninguno conocido.** `tsc` sin errores, `next lint` sin avisos, `next build` completo, y **12 suites de verificación sin un solo fallo** (números abajo). |
| ¿Hay errores de negocio? | **Se han probado las reglas:** margen nunca por debajo del mínimo, coste = precio de venta no puede romper el beneficio, duplicados rechazados (409), agotado despublica y recupera stock, snapshot no fiable **jamás** sobrescribe precios reales, aislamiento entre clientes con 13 comprobaciones, borrado de cuenta sin residuos. |
| ¿Está hecho para escalar? | **El diseño sí** (ver `ESCALABILIDAD.md`): colas BullMQ, sesiones sin estado, aislamiento por inquilino, índices en las consultas calientes, workers separables. **Pero hay 4 puntos que habría que tocar antes de 100+ clientes** y están listados con su solución. |
| ¿Se puede subir al repositorio? | Sí: están `dropshippilot-codigo.zip` y `dropshippilot.bundle` listos, sin nada sensible dentro. Ver `SUBIR-A-GITHUB.md`. |

## 2. Lo que está verificado aquí, con números

Última pasada completa (todo ejecutado, no estimado):

| Suite | Comprobaciones | Estado |
|---|---|---|
| Correos de acompañamiento (bienvenida + recordatorio) | 34/34 | ✅ |
| Derechos del cliente (exportar/borrar) y copias | 44/44 | ✅ |
| Primeros pasos + tutorial del operador | 29/29 | ✅ |
| Tutorial guiado del cliente | 23/23 | ✅ |
| Recorrido con navegador real (2 suites) | 24/24 y 14/14 | ✅ |
| Catálogo y claves de proveedor | 58/58 | ✅ |
| Divisas del BCE | 27/27 | ✅ |
| Correo (SMTP, STARTTLS, acentos, multipart) | 18/18 | ✅ |
| Aislamiento entre clientes | 13/13 | ✅ |
| Panel de administración | todas | ✅ |
| Ciclo completo (importar → worker → tienda) | todas | ✅ |
| `preflight` (qué falta por conectar) | 0 bloqueantes | ✅ |

Además: `tsc` ✓ · `next lint` ✓ · `next build` ✓ · `/api/health` con PostgreSQL, Redis, scraping y divisas en verde.

### Capacidad medida (no estimada)

`npm run loadtest` sobre la app en marcha, 200 peticiones por ruta con 20 a la vez:

| Ruta | Latencia media (p50) | p95 | Caudal |
|---|---|---|---|
| Portada del panel | 660 ms | 902 ms | 29 pet./s |
| Listado de productos | 337 ms | 401 ms | 59 pet./s |
| Catálogo | 612 ms | 682 ms | 32 pet./s |
| `/api/health` | 66 ms | 113 ms | 285 pet./s |

Consultas a PostgreSQL: **1–4 ms**. Cola de trabajo: **521 trabajos/s** con la concurrencia del worker (trabajo sintético; el tiempo real lo marcará el proveedor).

## 3. Lo que está construido pero **no** se ha probado contra el mundo real

Esto es lo que quiero que tengas claro. El código está, las llamadas están escritas y las pruebas las cubren **con simulación**, pero **nadie ha llamado de verdad a estos servicios** desde aquí:

| Pieza | Qué falta para poder decir «probado» |
|---|---|
| **AliExpress** (DS API) | Tus claves + que la app esté en su lista blanca. Nunca se ha hecho una llamada real |
| **CJdropshipping** | Tus claves. La consulta está escrita tal cual su documentación (V2.0) pero sin ejecutar contra ellos |
| **Amazon** | Descartado para catálogo compartido (sus términos lo prohíben): sólo puede usarse con tu propia cuenta de afiliado |
| **Shopify / WooCommerce reales** | Nunca se ha conectado una tienda de verdad: las pruebas usan una tienda de mentira local |
| **Stripe** | Nunca se ha cobrado. Sin claves, `/api/health` lo marca en rojo (es lo esperado) |
| **SMTP real** | Los correos salen a un buzón de pruebas local (`logs/mail-out/`). Con tu servidor de correo, cambia sólo la configuración |
| **Proxies** | El validador funciona, pero no hay ningún proxy real dado de alta |
| **Scraping de proveedores reales** | Funciona el camino completo, pero contra páginas de prueba: puede que AliExpress/CJ cambien su HTML y haya que retocar el extractor |

**Traducción:** lo que falta no es código, son claves y un par de pruebas de humo contra cada servicio. Está todo preparado para que «pegar la clave y reiniciar» sea lo único que quede.

## 4. Lo que todavía **no** está construido

Cosas que no existen hoy en el proyecto (para que no las des por hechas):

- **Página pública de venta** (landing, precios, registro desde la web): el producto no se vende solo todavía.
- **App móvil nativa**: el panel se adapta a móvil (probado), pero no hay aplicación.
- **Facturación en España sin alta de autónomo**: documentada (`PAGOS.md`) y con Lemon Squeezy integrado, pero no configurada.
- **Envíos/remesas propias para Cuba**: no se ha decidido el alcance, así que no hay nada hecho.
- **Múltiples idiomas**: el panel está en español; el motor de correo y de textos no está traducido a otros idiomas.

## 5. Sobre «rápido, eterno y esas cosas»

- **Rápido**: sí, con matices. Las APIs responden en 66–71 ms y la base de datos en 1–4 ms. Las **páginas** tardan 337–660 ms porque se renderizan en el servidor con datos frescos en cada visita. Para dejarlas en ~50 ms habría que añadir caché (está en el plan de escalado).
- **Eterno (24/7)**: el robot trabaja solo, revisa cada hora según el plan, se reinicia con gracia, vigila que el sistema esté sano y avisa por correo si algo se rompe; las copias se hacen cada madrugada y **se comprueban restaurándolas**. Pero «eterno» depende de que el servidor esté encendido: en el sandbox de pruebas se recicla, en tu servidor/VPS no.
- **Autónomo, sí**: una vez pegadas las claves no hay que tocar nada para que sincronice, avise, copie y acompañe al cliente.

## 6. Lo que sí puedo afirmar sin reservas

1. Los **12 conjuntos de pruebas** pasan sin un solo fallo, y cada uno prueba el hecho, no el adorno.
2. Los **fallos graves** que aparecieron durante el desarrollo están **todos corregidos y con su prueba**: el que inventaba precios, el que confundía «empecé» con «terminé», el que dejaba restos al borrar una cuenta, el que rompía las cuotas al repetir pruebas.
3. **Nada de lo que se rompa puede corromper datos de clientes por diseño**: snapshot no fiable → no toca nada; consulta sin contexto de inquilino → se bloquea (fail-closed); importación repetida → rechazada.
4. Todo el trabajo está **documentado ronda a ronda** en `VERIFICATION.md` (17 rondas), con lo que falló y cómo se arregló.

---

## Cómo comprobarlo tú mismo en 3 minutos

```bash
npm install && docker compose up -d      # base de datos, Redis y scraper
npx prisma db push && npm run seed:catalog
npm run dev                              # http://localhost:3000

# y en otra terminal:
npm run verify:onboarding-mail           # 34 comprobaciones
npm run verify:gdpr                      # 44 comprobaciones
npm run loadtest                         # capacidad real de tu máquina
npm run preflight                        # qué falta por conectar
```

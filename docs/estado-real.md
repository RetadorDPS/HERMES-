# DropshipPilot — estado real de lo que está publicado

Este documento describe **lo que de verdad funciona hoy** (la versión publicada en GitHub Pages con Supabase). Los documentos
`README.md`, `ESTADO.md`, `GUIA.md`, `DEPLOY.md`, `PRODUCCION.md` y `CATALOGO.md` describen la **versión completa con servidor propio**
(Next.js + Redis + colas + scraper), que **no está publicada**: sirven de referencia de diseño, no de estado.

El número de versión real está en `src/lib/version.ts` (`APP_VERSION`) y su historial, en `CLAUDE.md`.

## Cómo está montado

| Pieza | Dónde vive |
|---|---|
| Pantallas | Web estática en GitHub Pages (`retadordps.github.io/HERMES-/`), se publica sola al subir a `main` |
| Datos, usuarios y permisos | Supabase (proyecto de Irlanda): tablas con permisos por usuario, solo el dueño ve lo suyo |
| Lógica del servidor | Funciones de Supabase (Edge Functions), con las claves de los proveedores como secretos |
| Tareas programadas | `pg_cron` de Supabase (barrido del monitor cada 30 min) |

## Qué funciona (y con qué está verificado)

| Función | Estado | Verificado con |
|---|---|---|
| Inicio de sesión (correo y Google), panel con datos reales, PWA instalable | Funciona | Navegador real con datos simulados + base real |
| Catálogo común de CJ y AliExpress (descarga, fichas, envío por país, filtros) | Funciona | Llamadas reales a los dos proveedores |
| Precios: coste USD → euros con el BCE, regla de margen, beneficio con envío | Funciona | Datos reales y pruebas automáticas |
| Importar por enlace (CJ y AliExpress, límite diario, sin solaparse) | Funciona | Una importación real de cada proveedor + pruebas de límites |
| Monitor de precio y existencias (barrido cada 30 min, avisos, pantalla Monitor) | Funciona | Una revisión real de AliExpress sobre un producto de prueba; el barrido programado (cada 30 min) ya se ejecutó solo una vez con éxito pero sin productos que vigilar |
| Proveedores y APIs (estado de CJ y AliExpress, sin enseñar claves) | Funciona | Función de base de datos probada como usuario normal y como administrador + pantalla en navegador |
| Conexión con Retador (publicar, actualizar, retirar, estado, cuentas de coste) | Funciona **solo contra el Retador simulado** | Simulador; el Retador real aún no tiene desplegadas sus funciones `dropship-*` |

## Qué falta

- Publicar un producto real en Retador (depende de que Retador termine su limpieza y aplique sus cambios).
- Conectar Shopify y WooCommerce de verdad (el código existe de la versión con servidor, sin verificar contra Supabase).
- Mandar los pedidos al proveedor (compra automática).
- Pantalla «Proxies» (en preparación; con las APIs oficiales probablemente no hará falta).

## Reglas que no se rompen

Ver `CLAUDE.md`: números reales (nunca supuestos), CJ y AliExpress independientes, el coste del proveedor solo lo ve el vendedor,
pruebas contra proveedores siempre en serie y mínimas.

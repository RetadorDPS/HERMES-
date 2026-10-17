# CLAUDE.md — Hermes (DropshipPilot)

## Regla de idioma (obligatoria)

Todo el trabajo en este repositorio va en **ESPAÑOL**: respuestas, comentarios del código, mensajes de commit,
textos visibles en la app y documentación. Solo se conservan en su idioma original los nombres de funciones,
variables, tablas e identificadores técnicos que ya existen. El dueño del proyecto no habla inglés.

## Cómo está publicada la app

- **Versión estática (GitHub Pages):** solo pantallas, con datos de ejemplo. Se construye con
  `node scripts/estatico/construir.mjs` (variable `RUTA_BASE` = subcarpeta del repositorio). Se publica sola al
  hacer push a `main` (`.github/workflows/pages.yml`). Las llamadas `/api/*` las contesta el navegador con
  `src/lib/simulador-api.ts`; nada se guarda.
- **App completa (Next.js + servidor):** es la que se conectará a Supabase. Cualquier cambio de pantallas debe
  funcionar en las dos versiones.
- Rutas y recursos propios: usar `conBase()` de `src/lib/ruta.ts` para rutas absolutas planas (imágenes, `<a href>`),
  y `<Link>` de Next para navegar. Nunca escribir `/ruta` a pelo en un enlace plano.

## Reglas de trabajo

- Nunca inventar datos. Si algo no se puede verificar, se dice.
- Reportar siempre qué se verificó en la app real, qué solo en datos y qué no se pudo verificar.
- Nada de pruebas masivas ni en paralelo contra APIs externas (CJ, AliExpress): en serie, con pausa y lo mínimo.
- El costo del proveedor lo ve el usuario de Hermes (el vendedor dropshipping, que lo necesita para calcular su margen). Nunca lo ve el comprador final de su tienda: ninguna ficha ni dato que viaje a la tienda del usuario incluye el costo.
- Arreglos en el sistema, nunca parches a un producto concreto.
- Las pantallas deben verse bien en ordenador, Android y Apple (comprobar siempre con ancho de móvil de 390 px).
- Ninguna pantalla se desplaza hacia los lados (salvo un contenedor que lo pida por diseño con `overflow-x-auto`). La regla general está en `src/app/globals.css` (`overflow-x: clip` y `overflow-wrap: anywhere`); no quitarla.

## Número de versión (obligatorio)

- La fuente de verdad es `APP_VERSION` en `src/lib/version.ts` (un número entero). Se sube en 1 en cada publicación a `main` y se muestra en la portada, el menú lateral y el pie del panel. `package.json` se queda fijo y NO refleja la versión real.
- Al final de CUALQUIER reporte de trabajo se indica el número de versión real resultante (por ejemplo «v2»), junto con la referencia del commit. Nunca omitirlo.
- Historial: v1 = inicio de sesión real (correo y Google), panel con datos reales y primer número de versión. v2 = función `cj-catalogo` y botón de descarga de prueba en Administración. v3 = diagnóstico de la clave de CJ (sin mostrarla). v4 = categorías, descarga por páginas y fichas completas de CJ. v5 = catálogo y envío globales (almacén de origen × país de destino). v6 = ficha más completa (stock por variante y país, características de envío), reintentos ante el límite de CJ y envío sin repetir lo ya cotizado. v7 = la descarga trae los productos más populares de CJ (antes traía los más caros). v8 = el botón de envío elige primero el producto más popular que falta por cotizar. v9 = ficha completa del producto para el usuario (envío por destino, variantes, stock por almacén, reseñas, características) y filtros del catálogo real. v10 = países con su nombre (no el código) y selector de país para cotizar. v11 = función `ali-catalogo` (AliExpress) con su propia tarjeta en Administración; stock «por consultar» cuando el proveedor no lo informa. v12 = la función de AliExpress lee los secretos con el nombre `ALIEXPRESS_APP_KEY` y `ALIEXPRESS_APP_SECRET`. v13 = el panel muestra la longitud de las claves de AliExpress (sin enseñarlas) para detectar un pegado equivocado. v14 = la descarga de AliExpress lee la lista de productos de forma robusta y muestra la forma real de la respuesta. v15 = si el feed de AliExpress llega vacío, se repite una vez sin orden y se muestran los contadores reales (recibidos, total, terminado). v16 = botón «Sondear el feed» de AliExpress (máx. 5 llamadas en serie) para averiguar qué feed y país devuelven productos. v17 = regla general contra el desplazamiento lateral (ningún texto largo ensancha la pantalla) y AliExpress descarga del feed real de más vendidos («DS bestseller» no existe). v18 = la página se recarga sola una vez si tras una publicación nueva se queda sin estilos (antes había que refrescar a mano). v19 = autorización de la cuenta de AliExpress (OAuth): botón «Autorizar», función `ali-callback` que guarda el token en la tabla privada, y la ficha y el envío de AliExpress lo usan y lo renuevan solos. v20 = la autorización de AliExpress vuelve por la dirección de retorno de Retador (única de la app compartida) con el `state` «dropshippilot.…», y la página de Retador la reparte a `ali-callback`. v21 = catálogo: etiqueta del proveedor con nombre completo y legible sobre cualquier foto, filtro de proveedores con varias opciones marcables (CJ y AliExpress siempre disponibles, con su número de productos) y almacenes de salida con su nombre natural (China, España, Unión Europea…). v22 = el filtro «Almacén de salida» funciona de verdad: cada producto guarda sus almacenes con existencias (columna `warehouses`, rellenada al completar fichas y al descargar de CJ por almacén), se pueden marcar varios almacenes, y solo salen los que tienen datos. v23 = envío de AliExpress verificado con datos reales (precio y días por país); el resumen muestra precio y días y dice «1 método» en singular, y el país de salida que informa AliExpress pasa al filtro de almacén. v24 = coherencia de números: el almacén de salida de AliExpress es el que informa cada cotización (ya no se supone China ni se inventa «0 uds»), el coste de la tarjeta es el de la variante más barata de la ficha, se explica de dónde sale el precio (API, no ofertas personales de la app), «envío gratis» solo se afirma si la cotización lo dice, y «Top ventas» es el 20 % más pedido de cada proveedor. v25 = etiquetas honestas: la cifra de popularidad dice «vendidos» en AliExpress y «listados por tiendas» en CJ (no son pedidos), y el beneficio de la tarjeta dice que es antes del envío. v26 = números de dinero reales: el coste de los proveedores (USD) se convierte a euros con el tipo del Banco Central Europeo (función `fx-tasas`, tabla `FxRate`) antes de calcular precio de venta y beneficio, y sin tipo de cambio no se calcula nada; «envío gratis» se deduce solo de cotizaciones (disparador en la base de datos, también para CJ); ya no se inventa un precio tachado (solo si la regla lo pide con `compareAtPct`). v27 = la app es una PWA instalable: manifiesto (`public/manifest.webmanifest`), service worker prudente (`public/sw.js?v=NN`: red primero para páginas, caché solo para `_next/static/` e iconos, nunca toca Supabase ni proveedores), página «sin conexión» y aviso de instalación que sale en cada visita mientras no esté instalada (iPhone: pasos «Compartir → Añadir a pantalla de inicio»).

## Dinero y precios

- El coste llega en la moneda del proveedor (USD). Precio de venta y beneficio se calculan SIEMPRE sobre el coste ya convertido a euros con el tipo real del BCE (`FxRate`). Sin tipo de cambio, no se calcula ni se enseña precio de venta. Nunca tratar dólares como euros.
- El catálogo no conoce el destino: su beneficio es «antes del envío». El envío real depende del almacén y del país de destino (cotización por destino).
- Nunca se genera un «precio antes» (tachado) por defecto: solo si la regla del vendedor lo pide expresamente.
- «Envío gratis», «almacén de salida» y «stock» solo se afirman si vienen de una cotización o del proveedor.

## Proveedores en Hermes

- **Números reales, nunca supuestos:** ningún dato que no venga del proveedor se rellena con un valor por defecto (ni «0 uds», ni «China», ni «envío gratis»). Si no se sabe, se deja vacío y se dice. El precio de coste es el que cobra la API del proveedor, no el que enseña su app al comprador (ofertas personales, monedas, cupones).

- Igual que en Retador: CJ y AliExpress son independientes (funciones, tablas y lógica propias de cada uno). Un cambio de un proveedor nunca toca al otro.
- Las claves de los proveedores viven solo como secretos de Edge Functions de Supabase (`CJ_API_KEY`, `ALIEXPRESS_APP_KEY`, `ALIEXPRESS_APP_SECRET`); nunca en el repositorio, en el chat ni en una tabla que un cliente pueda leer. Los tokens de sesión de cada proveedor se piden con esas claves y se guardan en una tabla privada.


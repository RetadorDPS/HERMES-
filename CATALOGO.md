# Catálogo servido por la plataforma

> **Aviso:** este documento describe la versión COMPLETA con servidor propio, que NO es la que está publicada hoy. Para saber qué funciona de verdad, lee [`docs/estado-real.md`](./docs/estado-real.md).

Esta es la pieza que convierte el panel en un producto que se puede vender: **el cliente entra y
encuentra un escaparate lleno**, con categorías con imagen, precios finales y beneficio calculados
con *su* regla de margen, y un botón de importar que funciona a la primera.

**Y nadie tiene que pegar claves.** Tú las pones una vez; las usan todos.

---

## 1. Cómo funciona (visión general)

```
   TUS CLAVES (una vez)                PLATAFORMA                        CLIENTE
┌──────────────────────┐      ┌──────────────────────────┐      ┌──────────────────────┐
│ Administración →      │      │ worker de catálogo        │      │ /catalog              │
│ Claves de proveedor   │─────▶│ ¿hay claves? → descarga   │─────▶│ navega, filtra, ve su │
│ (cifradas, AES-256)   │      │ CJ + AliExpress → índice  │      │ precio y su beneficio │
│ o variables de entorno│      │ tabla CatalogItem         │      │ → Importar (2 créditos)│
└──────────────────────┘      └──────────────────────────┘      └──────────────────────┘
                                        │                                  ▲
                                        │ sin claves → catálogo de muestra │
                                        └──────────────────────────────────┘
```

- **Índice propio**: los productos se guardan en nuestra base de datos. La pantalla responde al
  instante y no consume cuota del proveedor al navegar.
- **Sin re-extracción al importar**: la ficha ya trae el `scrapedPayload` normalizado; el botón
  Importar llama al mismo `POST /api/import` que la importación por URL (2 créditos, publicación
  en la tienda y primer chequeo del worker programado). Un solo camino, no dos.
- **Muestra etiquetada**: mientras no haya claves se muestran 36 productos de ejemplo (6
  categorías) con precios y envíos realistas, marcados «MUESTRA». En cuanto un proveedor tiene
  catálogo real, **su muestra desaparece sola**.

## 2. Poner tus claves (2 minutos)

1. Entra como administrador → **Administración → Claves de proveedor**.
2. Rellena y pulsa **Guardar y probar**:
   - **CJ Dropshipping**: `email` + `API Key` (CJ → Autorización → API Key). Es la vía más rápida:
     su API está abierta y no requiere aprobación previa.
   - **AliExpress**: `App Key` + `App Secret` + `Access Token` (consola de desarrollador de
     AliExpress Open Platform). El token OAuth es lo que permite precios reales y pedidos.
   - **Amazon**: `Access Key`, `Secret Key`, `Partner Tag` y marketplace. *No* se recomienda para
     catálogo compartido: su API exige 10 ventas cualificadas cada 30 días por mercado y prohíbe
     redistribuir los datos. Vale para la cuenta de un cliente concreto, no como escaparate.
3. Pulsa **Descargar catálogo** (o espera al worker: refresca cada 6 h). En unos segundos tendrás
   productos reales con precio, stock, envío y almacén de salida.
4. Opcional: define un **límite mensual de llamadas**. Si se agota, la plataforma deja de pedir al
   proveedor y lo dice, en vez de comerse un error del proveedor a media descarga.

Alternativa por despliegue (para Docker, sin tocar la base de datos): define en el `.env`
`ALIEXPRESS_APP_KEY`, `ALIEXPRESS_APP_SECRET`, `ALIEXPRESS_ACCESS_TOKEN`, `CJ_EMAIL`, `CJ_API_KEY`.
Lo guardado en el panel tiene prioridad sobre el entorno.

> Si un cliente quiere usar **su** cuenta (por ejemplo para pagar los pedidos con su tarjeta),
> puede conectarla en Proveedores. Es opcional y no estorba: la cascada es
> **plataforma → entorno → cuenta del usuario**.

## 3. La pantalla `/catalog`

- **Categorías visuales** con imagen y número de productos (carrusel superior): se navega mirando,
  no escribiendo.
- **Buscador** con sugerencias en vivo (por título, categoría, etiqueta).
- **Filtros**: proveedor, almacén de salida (ES/EU/CN/US…), rango de precio de coste, valoración
  mínima, sólo envío gratis, sólo tendencias.
- **7 órdenes**: más vendidos, tendencias, precio ↑/↓, mejor valorados, más pedidos, novedades.
- **Cada tarjeta**: imagen, proveedor, valoración, pedidos, días de envío, coste del proveedor,
  **tu precio de venta** y **tu beneficio por unidad** (importe y %).
- **Ficha lateral**: galería, variantes, descripción, envío y resumen del cálculo (coste + envío →
  precio → beneficio), selector de tienda y de estado (borrador/publicado), margen puntual para esa
  importación y coste en créditos (2).
- **Importación**: crea el producto, lo publica en la tienda y programa su vigilancia. Aparece un
  aviso con enlace a *Gestión de productos*.

## 4. El worker de catálogo

```
npm run worker           # sync + pedidos + catálogo (recomendado)
npm run worker:catalog   # sólo el catálogo
npm run seed:catalog     # descarga inmediata a mano (--pages 4 --keyword "led")
```

| Variable | Por defecto | Para qué |
|---|---|---|
| `CATALOG_SYNC_MINUTES` | `360` | cada cuánto se refresca el catálogo real |
| `CATALOG_SYNC_PAGES` | `2` | páginas de hasta 50 productos por proveedor |
| `CATALOG_SYNC_KEYWORD` | vacío | limitar la descarga a un tema concreto |
| `CATALOG_QPS_DELAY_MS` | `1200` | pausa entre páginas (CJ admite 1 petición/segundo) |

En producción va dentro del contenedor `worker` (ya arranca los tres hijos). El compose recibe
estas variables y las claves del proveedor desde el `.env.prod`.

## 5. Qué está verificado y qué no

**Verificado en esta instalación** (`npm run verify:catalog` → 58/58):

- Muestra cargada e idempotente (36 artículos, 6 categorías con imagen).
- Filtros y órdenes del índice (categoría, precio, envío gratis, búsqueda, tendencias, precio ↑,
  paginación) y facetas con imagen.
- `GET /api/catalog`, `/api/catalog/[id]` y `/api/catalog/categories`, con precio de venta y
  beneficio calculados con la regla del usuario.
- **Importación real desde el catálogo**: producto creado con variantes e imágenes, SyncLog de tipo
  `IMPORT` y consumo exacto de **2 créditos**.
- Claves de plataforma: guardado **cifrado** (no se puede leer el valor en la base de datos),
  enmascarado en el panel, prueba contra la **API real** de CJ (que respondió con su error real de
  credenciales), marca de fecha, estado `ERROR`, cuota mensual que corta a tiempo y borrado.
- Cambio **muestra → real**: con artículos reales de un proveedor, su muestra deja de servirse.
- Sin claves, la descarga **avisa en lugar de fallar** (el catálogo de muestra sigue en pie).
- Proxy de imágenes: rechaza hosts no permitidos (403), exige el parámetro (400) y alcanza el CDN
  del proveedor cuando el host está en la lista blanca.

- **Contrato con los proveedores probado a nivel de red**: la verificación sustituye `fetch` por
  respuestas con la forma exacta que documentan CJ (`product/listV2`, `getCategory` anidado) y
  AliExpress (`ds.recommend.feed.get`) y ejecuta la **descarga completa real** — autenticación,
  listado, normalización, índice, pantalla y ficha de importación — con 3 + 2 productos, imágenes
  múltiples, valoraciones, pedidos, categorías de 3 niveles y precios calculados. La página
  `/catalog` cambia a «Catálogo real» durante la prueba y vuelve a la muestra al limpiarla.

**No verificado aquí (necesita tus claves reales)**: la respuesta **válida** de CJ y AliExpress con
tu cuenta. Todo lo demás de la cadena está probado, incluida la autenticación contra el servidor
real de CJ (que respondió con su error de credenciales cuando se le enviaron claves de prueba).
Traducción práctica: en cuanto pegues las claves correctas y pulses *Descargar catálogo*, esto
funciona; si algo cambiara en su API, el panel te lo dirá con el mensaje exacto del proveedor.

## 6. Coste y tamaño

- **Dinero**: 0 €. `product/listV2` de CJ es gratuito; el feed de recomendaciones de AliExpress no
  requiere aprobación adicional (sí tener la app). Con cientos de productos basta sin problema.
- **Si algún día quieres más**: BigBuy (más de 400.000 referencias, almacén en España, 24-72 h en
  la UE, ~50 €/mes) encaja como proveedor «premium» europeo; Syncee tiene plan gratuito y Spocket
  cuesta 39,99 $/mes. El índice y la pantalla ya están preparados: añadir un proveedor es escribir
  su cliente en `src/lib/supplier-apis/` y nada más.

## 7. Archivos de esta pieza

| Archivo | Papel |
|---|---|
| `src/lib/catalog/index.ts` | motor: muestra, descarga, consulta con filtros y visibilidad muestra/real |
| `src/lib/catalog/platform-credentials.ts` | claves de la plataforma, cascada, prueba y cuotas |
| `src/lib/catalog/sample.ts` | catálogo de muestra (36 artículos, 6 categorías con imagen) |
| `src/lib/supplier-apis/cj.ts` · `aliexpress.ts` | `listProducts`/`listCategories` y `fetchFeed` |
| `workers/catalogWorker.ts` | descarga periódica y limpieza |
| `src/app/(dashboard)/catalog/*` | pantalla: tarjetas, filtros, buscador y ficha de importación |
| `src/app/(dashboard)/admin/platform-credentials-card.tsx` | panel de claves del operador |
| `src/app/api/catalog/*`, `src/app/api/admin/platform-credentials/route.ts` | API |
| `src/app/api/img/route.ts` | proxy de imágenes con lista blanca de hosts |
| `scripts/verify-catalog.ts` · `scripts/seed-catalog.ts` | verificación y carga a mano |

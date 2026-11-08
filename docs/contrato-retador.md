# Contrato DropshipPilot ⇄ Retador (versión 1, con las ampliaciones hasta la 1.5)

Documento común de los dos lados. DropshipPilot (cliente) publica y mantiene productos en la tienda de UN vendedor de Retador
mediante un token propio de ese vendedor. Retador es el único que habla con CJ y AliExpress para crear el producto
(`cj-seller-import` / `ali-seller-import`); DropshipPilot manda decisiones del vendedor (qué variantes, a qué precio, con qué
contenido), nunca costes.

## Principios
1. El coste real del proveedor nunca viaja de DropshipPilot a Retador, ni sale de Retador hacia el comprador. Retador lo relee del proveedor.
2. Todo número que Retador reciba tiene que ser real: si DropshipPilot no sabe el stock, manda `null` y Retador no inventa.
3. Idempotencia por `ref` (identificador estable de DropshipPilot por producto y tienda).
4. Proveedores independientes: el campo `proveedor` decide a qué función de proveedor se enruta (`cj` o `aliexpress`).
5. Las respuestas de error van en español, con código estable y sin datos internos del proveedor.

## Autenticación
- Cabecera `x-dropship-token: dsp_<43 caracteres base64url>`; el gateway de Supabase no exige JWT en estas funciones (`verify_jwt = false`) porque el token es la credencial.
- El token lo crea el vendedor en la app de Retador (sin dar su contraseña): se muestra una sola vez, en la base solo queda su `sha256`. Revocable, caduca a 90 días, como máximo 3 vivos por vendedor.
- En cada uso se comprueba: token vigente y no revocado, vendedor no suspendido, plan pro/premium, sin deuda de comisiones, tope de productos del plan.
- Errores de autenticación: `401 token_invalido`, `401 token_caducado`, `403 vendedor_suspendido`, `403 plan_insuficiente`, `403 deuda_comisiones`.

## Formato
- `POST https://qsxtjuhueqdxoduyroli.supabase.co/functions/v1/dropship-<accion>` con cuerpo JSON y `Content-Type: application/json`.
- Respuesta correcta: `{ "ok": true, ... }`. Error: `{ "ok": false, "codigo": "...", "error": "texto en español", "reintentar_en_s"?: n }` con el estado HTTP que corresponda.
- Todos los importes en USD (moneda de los productos de proveedor en Retador), con dos decimales.
- `version_contrato: 1` en todas las respuestas correctas.

## `dropship-config` (solo lectura)
Respuesta:
```json
{
  "ok": true, "version_contrato": 1,
  "vendedor": { "plan": "pro", "productos_usados": 12, "tope_productos": 55, "suspendido": false, "deuda_comisiones": false },
  "tarifas": {
    "hub_usd_por_libra": 1.99,
    "dias_hub_cuba": [8, 15],
    "comision_pct_ganancia": 8,
    "pasarela_pct": 4.4,
    "pasarela_fija_usd": 0.30,
    "pasarela_a_cargo": "vendedor"
  },
  "categorias": [ { "cat": "hogar", "nombre": "Hogar", "subcategorias": ["Cocina", "Baño"] } ],
  "provincias": ["La Habana", "Matanzas"],
  "limites": { "publicar_por_hora": 10, "actualizar_por_hora": 60, "retirar_por_hora": 60, "estado_por_hora": 300 },
  "token": { "prefijo": "dsp_ab12", "caduca_en": "2027-01-15T00:00:00Z" }
}
```
`pasarela_a_cargo` (`vendedor` o `comprador`) dice quién paga la pasarela de pago; sirve para calcular el beneficio neto real del vendedor. Si falta, DropshipPilot asume `vendedor` (lo más prudente).

Se usa para probar la conexión y para que DropshipPilot calcule beneficio neto con las mismas tarifas que Retador (nunca valores fijos copiados).

## `dropship-publicar`
Cuerpo:
```json
{
  "ref": "dsp:<idTienda>:<idProducto>",
  "proveedor": "cj",
  "pid": "<id del producto en el proveedor>",
  "variantes": [ { "sku": "CJ123-RED-M", "precio_venta_usd": 19.99, "stock": 37 } ],
  "cat": "hogar", "subcat": "Cocina", "provincia": "La Habana",
  "contenido": { "titulo": "…", "descripcion": "texto plano", "imagenes": ["https://…"] }
}
```
- `variantes`: de 1 a 12. `sku` debe existir en el proveedor (`sku_inexistente`). `stock` es un entero ≥ 0 verificado por DropshipPilot o `null` si no se sabe.
- `contenido` es opcional; sin él se usa lo que traiga el proveedor. Título ≤ 150 caracteres, descripción en texto plano ≤ 5000, imágenes ≤ 9, solo `https` de estos orígenes: `alicdn.com`, `aliexpress-media.com`, `cjdropshipping.com` y el almacenamiento de Retador. La primera imagen es la portada.
- Retador relee el coste del proveedor, calcula coste puesto en Cuba (producto + tramo al hub + tramo hub→Cuba por peso real) y **rechaza** un precio por debajo de ese mínimo: `409 precio_bajo_minimo` con `{ "sku": "…", "minimo_usd": 14.20 }`. Nunca se publica por debajo del coste.
- Stock `null`: Retador no inventa 50; usa `platform_config.dropship_stock_sin_dato` (por defecto 5), marca el producto como `stock_estimado` y lo deja registrado. Cuando DropshipPilot mande el stock verificado, se sustituye.
- Si `ref` ya existe: `409 ya_publicado` con `producto_id` (no duplica).
- Respuesta:
```json
{ "ok": true, "version_contrato": 1, "ref": "…", "producto_id": "uuid", "url": "https://retadormarketplace.es/…",
  "estado": "activo", "moderacion": "approved",
  "variantes": [ { "sku": "…", "precio_venta_usd": 19.99, "stock": 37, "stock_estimado": false } ],
  "imagenes": 7, "cat": "hogar", "subcat": "Cocina" }
```
Errores: `400 datos_invalidos` (con `campo`), `404 producto_no_encontrado_en_proveedor`, `409 tope_productos`, `409 ya_publicado`, `409 precio_bajo_minimo`, `429 cupo_proveedor` (con `reintentar_en_s`), `502 proveedor_no_disponible`.

## `dropship-actualizar`
Cuerpo (todo opcional salvo `ref`):
```json
{ "ref": "…", "estado": "activo|pausado",
  "variantes": [ { "sku": "…", "precio_venta_usd": 21.5, "stock": 12 } ],
  "contenido": { "titulo": "…", "descripcion": "…", "imagenes": ["…"] },
  "cat": "hogar", "subcat": "Cocina", "provincia": "La Habana" }
```
- **No llama a CJ ni a AliExpress** (no gasta la cuota de Retador). Solo aplica lo que manda el vendedor. El mínimo de precio se valida con el último coste conocido guardado en Retador.
- Variantes no mencionadas no se tocan. Stock `0` en todas las variantes → el producto pasa a `sold_out`.
- Un `sku` que no pertenece al producto → `404 sku_no_pertenece`.
- Respuesta: igual que `publicar` con el estado final.

## `dropship-retirar`
`{ "ref": "…" }` → pone el producto en `paused` (no lo borra). Idempotente. Respuesta `{ ok, ref, producto_id, estado: "pausado" }`.

## `dropship-eliminar` (propuesto, v1.4)
`{ "ref": "…" }` → ELIMINA el producto del mercado y del perfil del vendedor (hoy `retirar` solo lo pausa y el vendedor lo sigue viendo en su perfil). Idempotente: si ya no existe responde `404 ref_no_encontrada` o `409 producto_eliminado` y DropshipPilot lo da por eliminado.
- Si el producto tiene pedidos pagados pendientes de cumplir, NO se elimina: `409 pedidos_pendientes` (con el número de pedidos). Con pedidos ya cerrados sí se puede (el historial del pedido se conserva).
- Después de eliminar, `dropship-estado` devuelve `{ "existe": false }` para esa ref y la ref no se reutiliza: volver a importar el mismo producto crea una ref nueva.
- DropshipPilot, por su lado, ya llama a esta acción desde el botón «Eliminar» de Productos. Mientras Retador no la ofrezca, el botón explica que hay que pausar y eliminar en Retador, y el producto se limpia solo aquí al detectar que ya no existe.

## Opiniones del proveedor (propuesto, v1.4)
Para que un producto de DropshipPilot llegue a Retador con confianza, DropshipPilot puede mandar las opiniones REALES que el proveedor (CJ o AliExpress) informa de ese producto. Retador las anuncia en `dropship-config` con `"capacidades": { "resenas_proveedor": true }`; mientras no lo diga, DropshipPilot no manda nada.
- Va en `dropship-publicar` y en `dropship-actualizar` como `resenas_proveedor`:
```json
{ "fuente": "cj", "media": 3.9, "total": 229,
  "muestra": [ { "puntuacion": 4, "texto": "Bon article", "pais": "FR", "fecha": "2021-10-18T05:52:45.000Z", "autor": "F***r" } ] }
```
- `media` y `total` son los reales del proveedor (o `null`). `muestra`: hasta 20 opiniones con texto, las más recientes primero, SIN escoger solo las buenas y sin tocar el texto (idioma original). Sin fotos. AliExpress solo informa media y total: `muestra` va vacía.
- Retador las guarda APARTE de las reseñas de compradores de Retador (no caben en `reviews`, que exige un usuario real) y las enseña siempre con su origen: «Opiniones del producto en CJ Dropshipping (no son compradores de Retador)». Nunca se cuentan en la valoración del vendedor ni se mezclan con las verificadas.
- Para el conector MCP: `retador_mi_producto` devuelve `resenas_proveedor` (marcadas como `campos_externos`, datos de terceros) y las herramientas de diseño de tienda solo pueden citar lo que haya ahí, con su origen y su fecha; nunca inventar opiniones ni atribuirlas a compradores de Retador.
- Opiniones por traducir: Retador puede ofrecer una traducción automática al español junto al original, siempre indicando que es traducida.

## `dropship-estado`
`{ "refs": ["…", "…"] }` (hasta 100). Respuesta `{ ok, version_contrato, productos: [ … ] }` con un elemento por ref (`{ "ref": "…", "existe": false }` si no existe):
```json
{ "ref": "…", "existe": true, "producto_id": "uuid", "estado": "activo|pausado|agotado|eliminado",
  "moderacion": "approved|pending|rejected",
  "variantes": [ { "sku": "…", "precio_venta_usd": 19.99, "stock": 37, "stock_estimado": false } ],
  "vendidos": 4, "pedidos_pendientes": 1,
  "actualizado_en": "…", "origen_ultimo_cambio": "dropship|vendedor|sistema" }
```
`origen_ultimo_cambio` permite a DropshipPilot detectar que el vendedor cambió algo a mano en Retador y no pisarlo sin avisar.

## Cupos y seguridad
- Por token y por hora: publicar 10, actualizar 60, retirar 60, estado 300 (`429 cupo_excedido` con `reintentar_en_s`).
- Publicar: como mucho 1 a la vez por vendedor; cupo diario global de llamadas a proveedores reservado para DropshipPilot en `platform_config.dropship_cupo_proveedor_dia` (por defecto 40 para CJ y 40 para AliExpress).
- Auditoría de cada uso (token, acción, ref, resultado, sin datos sensibles).
- Los errores 500 nunca devuelven texto interno de proveedor ni trazas.

## Fuera de esta versión (fase 2)
- Avisos de Retador hacia DropshipPilot (venta, moderación) por webhook firmado.
- Pedidos para cumplimiento desde DropshipPilot.
- Copiar las fotos del proveedor al almacenamiento de Retador.

## Cambios acordados tras la implementación en Retador (v1.1, mismo `version_contrato: 1`)
Resumen del informe de Retador del 18/10/2026. Donde choca con el texto de arriba, manda esto.
- `tarifas.pasarela_a_cargo` vale `"retador"` (valor real hoy), además de `"vendedor"` o `"comprador"`. Con `"retador"` al vendedor no se le descuenta pasarela.
- `tarifas.comision_base = "precio_venta_menos_costo_producto"`: la comisión es `comision_pct_ganancia` % de (precio de venta − costo del producto del proveedor, sin envío). Neto del vendedor por unidad = (precio − costo del producto) × (1 − comisión %). En AliExpress el costo es el precio para EE. UU.
- Precio mínimo: el coste puesto en Cuba (producto + tramo al hub + hub→Cuba).
- Códigos nuevos: `publicacion_en_curso` (409, `reintentar_en_s`), `ref_no_encontrada` (404), `producto_eliminado` (409), `error_interno` (500). `sku_inexistente` va con 400 e incluye `sku` y `skus`. `precio_bajo_minimo` incluye `variantes: [{sku, minimo_usd}]`.
- `config` también tiene cupo (60 por hora) y devuelve `stock_sin_dato` y `cupo_proveedor_diario`; `dias_hub_cuba = [mín, máx]`.
- `deuda_comisiones` solo bloquea publicar y actualizar.
- Publicar hace una sola lectura al proveedor + el flete al hub (sin vista previa). Sin provincia se usa la de la tienda del vendedor. Todas las variantes a 0 → `agotado`.
- Las fichas de `estado` traen además `atributos` por variante, `provincia`, `actualizado_en` y `origen_ultimo_cambio`.
- Stock `null` en publicar o actualizar → se usa `stock_sin_dato` (5) y se marca `stock_estimado`; nunca 50.

## Versión 1.3, parte A (dinero) — definitiva desde el 19/10/2026

Retador la sirve desde `dropship-config` cuando informa `tarifas.ganancia_minima_retador_usd` (SQL 43 y 44 aplicados). `version_contrato` sigue en `1`. La parte B (venta fuera de Cuba, campo `destinos`) es solo una propuesta de Retador y **no se programa**.

Campos nuevos de `tarifas`: `ganancia_minima_retador_usd`, `pasarela_a_cargo` (`vendedor`), `pasarela_base` (`total_cobrado`), `envio` (`aparte`), `comision_base` (`precio_venta_menos_costo_producto_menos_pasarela`), `minimo_formula`, `neto_formula`.

- **Precio mínimo** = el del Importador de Retador: `ceil((costo_producto + pasarela_fija_usd + ganancia_minima_retador_usd) / (1 − pasarela_pct / 100) × 100) / 100`. El envío no entra. En CJ el costo del producto es el precio de la variante; en AliExpress, el precio para EE. UU. Debajo del mínimo: `409 precio_bajo_minimo` con `minimo_usd`.
- **Neto por unidad (pasarela del vendedor)**: `pasarela = round((precio + envío cobrado) × pasarela % + pasarela fija, 2)`; `base = (precio − costo del producto) − pasarela`; `comisión = round(max(0, base) × comisión %, 2)`; `neto = base − comisión`. El envío lo paga el comprador aparte y lo cotiza Retador al comprar; DropshipPilot solo lo **estima** con el coste puesto en Cuba (coste puesto en Cuba − costo del producto).
- Con `pasarela_a_cargo` = `retador` o `comprador` no se descuenta pasarela al vendedor.
- DropshipPilot, además, no publica ni actualiza con un precio con el que el vendedor pierda dinero con el envío estimado (si lo pierde, exige el precio que no pierde aunque Retador aceptara menos).
- Si Retador no informa `ganancia_minima_retador_usd`, siguen valiendo las cuentas de la versión 1 de arriba.
- Ejemplo del contrato (verificado en `tests/retador/precios.test.ts`): costo 15,28 · precio 25 · envío cobrado 10,03 · comisión 8 % → pasarela 1,84, base 7,88, comisión 0,63, neto 7,25.
- **Publicar** solo exige el coste de la variante: el peso y la cotización al hub de EE. UU. ya no son obligatorios (el envío lo cotiza Retador al comprar). Si faltan, el neto se estima «sin envío» y la pantalla lo avisa.

## Versión 1.5 — envío por país y sincronización automática (mismo `version_contrato: 1`)

Retador la sirve desde `dropship-config` cuando informa `capacidades.envio_resumen = true`. Mientras no lo diga, DropshipPilot NO manda el campo `envio`.

### Campo opcional `envio` en `dropship-publicar` y `dropship-actualizar`
```json
"envio": { "cotizado_en": "2026-10-31T08:00:00.000Z",
  "destinos": [ { "pais": "US", "dias_min": 3, "dias_max": 6, "precio_usd": 1.25, "gratis": false },
                { "pais": "ES", "dias_min": 7, "dias_max": 12, "precio_usd": 3, "gratis": false } ] }
```
- Hasta 100 países. `pais` = 2 letras MAYÚSCULAS. Días enteros: `dias_min` ≤ 120, `dias_max` ≤ 150 y `dias_max` ≥ `dias_min`. `precio_usd` en USD (≥ 0, o `null` si no se conoce). `gratis: true` solo si la propia cotización del proveedor lo dice (cuenta como 0).
- Solo cotizaciones REALES ya guardadas en la ficha, del almacén que tiene el stock de lo publicado (en CJ; en AliExpress el almacén lo decide cada cotización). Por cada país se manda la opción más barata y, a igualdad, la más rápida. Un país sin cotización utilizable (sin servicio, sin precio o con días imposibles) no se manda: nunca se inventa nada.
- **NO se manda Cuba (`CU`)**: Retador la calcula con su regla (EE. UU. + tramo del hub). **Sí se manda EE. UU. (`US`)** siempre que exista, porque Retador lo necesita para Cuba (y EE. UU. no se recorta si hay más de 100 países).
- `cotizado_en` = la más reciente de las cotizaciones que se mandan.
- La respuesta (ficha del producto) trae `envio_actualizado_en` y `envio_paises`, que DropshipPilot usa para confirmar que Retador guardó el envío (si `envio_paises` no es mayor que 0, se vuelve a intentar en la siguiente revisión).
- En `actualizar` se manda con `envio: true` desde la app o junto a un cambio de precio o de stock, y siempre desde la sincronización automática cuando cambió algo (se compara con lo último que se mandó).

### Opiniones
Retador ya NO enseña el origen de las opiniones del proveedor: aparecen como **«Opiniones del producto»**, no cuentan en la valoración del vendedor y no se mezclan con las de compradores de Retador. DropshipPilot sigue mandando `fuente` en los datos (para el conector y la auditoría), pero nunca las presenta como opiniones de compradores de Retador ni inventa ninguna.

### Provincia
Los productos importados se envían desde fuera: `provincia` ya no se manda en `publicar` (el contrato la dejó opcional).

### Sincronización automática desde el monitor (`monitor-proveedor` → `retador-tienda`, acción `sincronizar`)
Tras revisar cada producto publicado en el proveedor (cada 6 h, en serie), DropshipPilot compara y empuja a Retador con `dropship-actualizar` solo lo que cambió de verdad:
- **Stock por variante** (CJ: almacén + fábrica; AliExpress: el de la variante). Se manda lo que cambió en el proveedor desde la última vez; las ventas que Retador ya descontó no se pisan al alza (se lee `dropship-estado` antes). Stock 0 = Retador lo deja AGOTADO solo. Stock desconocido viaja como `null`. Variante que el proveedor retira = stock 0. Variante nueva = solo aviso (el contrato no permite añadir variantes por actualizar).
- **Producto que el proveedor ya no devuelve**: `dropship-retirar` (pausado) y aviso.
- **Envío por país** y **opiniones** (si cambian media o total): solo si cambiaron desde la última vez.
- **PRECIO: sin el precio automático, nunca se cambia solo** (con él, ver la sección siguiente). Si el coste sube (más de 0,05 USD y 1 %) y el precio publicado queda por debajo del mínimo de Retador o el vendedor perdería dinero, el producto se PAUSA en Retador (`estado: "pausado"`), se anota el aviso y la pantalla Monitor muestra «Ajustar precio» (abre la edición del precio con el mínimo de hoy como punto de partida). Si el coste baja, solo aviso.
- Cada envío queda en el registro del vendedor (`SyncLog`): qué se mandó y qué respondió Retador. El coste del proveedor no viaja nunca a Retador.



## Precio automático (v50, mismo `version_contrato: 1`; no cambia nada del contrato)

Es decisión del vendedor, producto por producto (casilla al publicar o interruptor en «Productos»). Usa la acción que ya existe, `dropship-actualizar`, con `variantes[].precio_venta_usd`; Retador no necesita cambiar nada.

- Precio ideal = regla de precios del vendedor (porcentaje, tarifa fija, beneficio mínimo, redondeo) aplicada al coste de hoy del proveedor, sin envío. SUBE y BAJA con el coste: si el proveedor baja, el precio baja.
- Frenos: (1) suelo: nunca por debajo del mínimo del Importador de Retador ni de lo que haga perder al vendedor; (2) cambios de menos del 2 % del precio o de 0,50 USD (el menor) no se aplican; (3) como mucho un cambio de precio cada 24 h por producto (salvo que el precio actual ya no valga); (4) un cambio de más del 25 % no se hace solo: se avisa y decide el vendedor (si el precio actual ya hace perder dinero, el producto se pausa como antes).
- Si Retador rechaza un precio por su propio mínimo (`precio_bajo_minimo`), se mantiene el precio actual, se manda el resto de la sincronización y se avisa al vendedor.
- Si el vendedor cambia un precio a mano (en Retador o en DropshipPilot), el precio automático de ese producto se apaga solo y se respeta su precio. Retador debe seguir aceptando que el precio de una variante cambie varias veces y no marcar esos cambios como «edición del vendedor» cuando llegan con el token de DropshipPilot (`origen_ultimo_cambio` = dropship).
- Cada cambio queda en el registro del vendedor (`PRECIO_AUTOMATICO`, `PRECIO_AUTO_REVISAR`, `PRECIO_AUTO_APAGADO`, `PRECIO_AUTO_RECHAZADO`).


## Respuestas de Retador a la v1.5 y al precio automático (2/11/2026)

- `envio_actualizado_en` = nuestro `cotizado_en`: Retador guarda el MENOR entre `cotizado_en` y el momento en que llega (si no mandamos `cotizado_en`, o es futuro, queda la hora de llegada). Se descartan antes de contar `envio_paises`: destinos `CU`, repetidos y los que no traen días ni precio; si todo lo que mandamos es así, `envio_paises` = 0.
- Un producto PAUSADO por DropshipPilot (`dropship-retirar`, o `estado: "pausado"` en `actualizar`) se queda pausado: `actualizar` sin `estado` no lo reactiva aunque mandemos stock > 0, y el reparto automático activo/agotado solo vale para productos que ya estaban activos o agotados. Solo vuelve a activo si DropshipPilot manda `estado: "activo"` o si el vendedor lo reactiva en Retador. **DropshipPilot nunca manda `estado: "activo"` desde la sincronización automática, solo por orden del vendedor.**
- Todo cambio que llega por `dropship-actualizar` con el token queda marcado `origen_ultimo_cambio = "dropship"` (aunque cambie el precio varias veces); si el vendedor edita en Retador, queda `"vendedor"`. Viene en la ficha y en `dropship-estado`. DropshipPilot apaga el precio automático comparando el precio que Retador tiene con el último que él puso (así una edición de solo stock no lo apaga).
- «Opiniones del producto»: bloque en la ficha, sin nombre del proveedor y aparte de las de compradores de Retador. En la TARJETA del catálogo las estrellas muestran la valoración con MÁS opiniones entre la de Retador y la importada (decisión del dueño de Retador).
- `dropship-eliminar`: la acción existe en la base y el código desplegado de las funciones `dropship-*` la incluye; Retador no pudo comprobarla en vivo. **Pendiente: probarla con un producto de prueba del vendedor antes de darla por buena.**
- **Rechazos que NO aplican nada de la llamada:** (1) si UNA variante trae un precio por debajo del mínimo, `dropship-actualizar` responde `409 precio_bajo_minimo` con `variantes: [{sku, minimo_usd}]` y no aplica NADA (ni stock, ni envío, ni opiniones); (2) si `envio` no es válido, `400 datos_invalidos` (campo `envio.*`) y tampoco aplica nada. DropshipPilot reenvía entonces la llamada SIN `precio_venta_usd` en las variantes rechazadas (o sin `envio`) para no perder lo demás, avisa al vendedor y no repite un precio ya rechazado mientras el precio propuesto sea el mismo.

## Versión 1.6 — Vincular cuenta, renovación, avisos y plan conjunto (definitiva; texto completo en `docs/contrato-dropship-1.6.md` del repositorio de Retador)

Regla de producto (Daniel, 3/11/2026): para el usuario, Retador y DropshipPilot son UNA sola plataforma. Ninguna pantalla enseña, crea ni pide pegar claves. La clave `dsp_…` existe solo entre servidores, cifrada. Todos empiezan con el plan Gratis y elegir plan es obligatorio al registrarse.

Lo que hace DropshipPilot (funciones `retador-tienda`, `retador-avisos`, `acciones-usuario`, `pedidos-barrido`):
- **Identidad de la aplicación:** un secreto de aplicación (64 caracteres) creado DENTRO de la base (almacén de secretos, `retador_cliente_secreto`); a Retador solo se le da su huella sha256 y las dos direcciones exactas: retorno `https://retadordps.github.io/HERMES-/vincular/retorno/` y entrada `https://retadordps.github.io/HERMES-/vincular/entrada/`. Las funciones lo leen con `leer_secreto_retador` (solo clave de servicio). Va en `x-dropship-cliente`.
- **A) Empieza aquí** (`vincular_iniciar` → `vincular_canjear`): `state` aleatorio de 43 caracteres, de un solo uso, 10 min, guardado como hash y ligado al usuario (tabla privada `VinculoRetador`). Se abre `https://retadormarketplace.es/vincular-dropship/?state=…&retorno=…`. Al volver (`?codigo=rc_…&state=…`) se gasta el `state`, se canjea el código en servidor (`dropship-vincular`) y, si el correo de Retador es el de esta cuenta, queda vinculada; si no, se pide confirmar antes de guardar.
- **B) Empieza en Retador** (`vincular_entrada` → `vincular_confirmar` / `vincular_cancelar`): la página de entrada pide sesión («Entrar con Google», o correo), canjea el código UNA vez, guarda la respuesta CIFRADA y ligada al usuario 15 min y enseña «Vincular con la cuenta de Retador de <correo>». Sin confirmar no se guarda nada; al confirmar se borra la respuesta antes de guardar la clave.
- **Renovación:** `conRetador` renueva la clave sola cuando faltan menos de 14 días (`dropship-renovar`), un intento por hora como máximo; si dos llamadas coinciden, la que pierde relee la clave nueva. Si la clave ya no sirve (`401 token_invalido`/`token_caducado`), la cuenta pasa a «Sin vincular» y la pantalla ofrece vincular de nuevo.
- **Desvincular:** borra la clave guardada (los productos siguen en Retador) y, si el plan venía de Retador, vuelve al plan de prueba. Al desvincular desde aquí la clave SE ANULA en Retador con `POST /rest/v1/rpc/dropship_desvincular_token` (clave publicable de Retador, cuerpo `{p_token}`, desde el servidor: función `retador-desvincular`); `anulada: false` = ya estaba anulada. Si Retador no responde no se borra nada y se pide reintentar.
- **Avisos:** `retador-avisos` (sin sesión; la credencial es la firma HMAC-SHA256 con `t` a ±5 min, comparación en tiempo constante, secreto `retador_avisos_secreto`). Responde 2xx enseguida y trabaja después; no repite un `id` ya procesado (tabla `AvisoRetador`). `pedido_nuevo` / `pedido_actualizado` → `pedidos-barrido` (vía interna, solo esa tienda); `producto_cambiado` → acción `estado`; `tarifas_cambiadas` → acción `config`; `prueba` → solo se anota. La tienda se busca por `vendedor.id` guardado al vincular. El barrido de seguridad de pedidos se espaciará a 30 min cuando los avisos estén verificados.
- **Plan conjunto:** `dropship-config → vendedor.plan_conjunto`. Si es `true`, el plan de Retador manda y aquí no se cobra: Gratis → Prueba, Pro → Starter, Premium → Pro (herramientas de cada plan de aquí; no se regala más). Si es `false` o se desvincula, vuelve al plan propio. Facturación dice «Tu plan viene de Retador».
- **Elige tu plan:** paso obligatorio tras registrarse (`planElegidoEn` vacío → pantalla `/elige-plan/`). Hoy se puede elegir Gratis; Pro y Premium se contratan en Retador y llegan al vincular.
- **Sin claves en pantalla:** la tarjeta de Retador solo tiene «Vincular con Retador» (con confirmación) y «Desvincular». Solo el administrador conserva la conexión con el Retador SIMULADO para pruebas.


## Criterio de DropshipPilot sobre el envío y las cuentas del vendedor (9/11/2026, decisión de Daniel)

Reparto (como ya funciona el checkout de Retador): el vendedor pone SOLO el precio del producto; el comprador paga producto + envío («total a pagar») y Retador gestiona el envío («Envío internacional · lo gestiona RETADOR»; «Pago único: producto y envío juntos»). El envío NO sale del dinero del vendedor.

Lo que hace DropshipPilot al importar:
- Propone el precio con la regla de margen del vendedor aplicada al **costo del producto** (no al coste con envío) y nunca por debajo del mínimo de Retador. Marca el producto con `precioBase: "producto"` (los publicados antes no la llevan y siguen con la base «total»: regla sobre producto + envío estimado y mínimo prudente contando el envío).
- Enseña «te quedan» = precio − costo del producto − pasarela − comisión (el neto de Retador), y aparte lo que verá pagar el comprador (precio + envío estimado) para que el vendedor decida con datos. El envío estimado = flete real del proveedor al destino + tramo del centro logístico, y debe coincidir con lo que cobra Retador.
- Opción «Envío gratis para el comprador (incluido en mi precio)»: aparece desactivada («Muy pronto») hasta que Retador la permita. Con ella, el neto sí descontaría el envío (`netoContandoEnvio`) y el mínimo sería `precioMinimoContandoEnvio`; el código ya está listo en `_compartido/retador-costes.ts`.
- Variantes: «Elegir todas», «Quitar todas», agrupadas por color, con precio común. El máximo por producto se lee de `limites.max_variantes` de `dropship-config` (si no viene, 12).

Lo que debe resolver o confirmar Retador (ver el mensaje final):
1. ERROR DE DINERO en `ali-buyer-freight-quote`: divide `shipping_fee_cent` entre 100, pero AliExpress lo manda ya en dólares (`"18.93"`, con `shipping_fee_format` `"$18.93"`). Cobra 0,19 en vez de 18,93.
2. Confirmar por escrito que el envío cobrado al comprador cubre el envío del proveedor y que no sale del vendedor.
3. Permitir «envío gratis / incluido» por producto.
4. Subir el máximo de variantes y publicarlo en `limites.max_variantes`.
5. Al elegir una variante (color o talla) en la ficha del producto, cambiar la foto a la de esa variante.

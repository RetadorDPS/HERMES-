# Contrato DropshipPilot ⇄ Retador (versión 1)

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

# Contrato de PEDIDOS RETADOR ⇄ DropshipPilot — versión 1

**Estado:** diseño aprobado por Daniel (22/10/2026). Lado DropshipPilot construido y probado contra `retador-simulado`; el lado Retador
(`dropship-pedidos` y `dropship-pedido-estado`) lo construye el otro Claude. **Nada de dinero real se mueve sin las dos llaves:**
modo de compras en «Simulación» por defecto y botón de aprobar en cada pedido.

Va por la misma puerta que el contrato de productos (`docs/contrato-retador.md`): cabecera `x-dropship-token: dsp_…`, `POST`,
JSON, `{ ok:true, version_contrato:1, … }` o `{ ok:false, codigo, error }`. Mismos errores 401/403/429/500.

## Por qué por consulta (pull) y no por aviso (webhook)

DropshipPilot **pregunta** a Retador cada pocos minutos. Así no hay que abrir ninguna dirección pública en DropshipPilot, no hay
firmas que falsificar y, si algo falla, se reintenta solo sin perder ningún pedido.

## Quién paga al proveedor (a confirmar por Retador)

Según el reparto real de Retador, el comprador paga producto + envío en un solo cobro a RETADOR y el dinero queda en custodia hasta
la entrega. La compra al proveedor se hace con la cuenta del proveedor que indique RETADOR. DropshipPilot solo ejecuta la compra con
las claves de proveedor que ya tiene (CJ / AliExpress) y **nunca** con dinero que no esté cobrado.

## 1) `dropship-pedidos` — pedidos pagados que hay que cumplir

Cuerpo: `{ "desde": "2026-10-22T10:00:00Z", "limite": 50 }` (los dos opcionales; `limite` máximo 100; `desde` = fecha de la última
novedad ya vista).

Respuesta:

```json
{
  "ok": true, "version_contrato": 1,
  "pedidos": [{
    "pedido_id": "uuid-del-pedido-en-retador",
    "numero": "R-000123",
    "pagado_en": "2026-10-22T10:05:00Z",
    "actualizado_en": "2026-10-22T10:05:00Z",
    "moneda": "USD",
    "lineas": [{ "ref": "dsp:<tienda>:<producto>", "sku": "CJYD177061601AZ", "cantidad": 1, "precio_venta_usd": 43.99 }],
    "entrega": {
      "tipo": "centro_logistico",
      "pais": "US", "nombre": "…", "telefono": "…",
      "direccion1": "…", "direccion2": "…", "ciudad": "…", "provincia": "…", "codigo_postal": "…",
      "referencia": "R-000123"
    },
    "estado_compra": "pendiente",
    "proveedor_pedido_id": null,
    "seguimiento": null
  }],
  "siguiente_desde": "2026-10-22T10:05:00Z"
}
```

Reglas:
- **Solo pedidos pagados** (el dinero ya está en custodia) y **solo líneas de productos publicados con esa clave** (`ref` que empieza por `dsp:`).
- **Sin costos del proveedor** (D1): solo el precio de venta que pagó el comprador.
- `entrega.tipo`: `centro_logistico` cuando el pedido va por el centro logístico (la dirección es la del centro más la `referencia` del
  pedido, que debe ir visible en el paquete) y `directa` cuando el proveedor envía a la casa del comprador. Solo se envían los datos
  que el proveedor necesita para entregar.
- `estado_compra`: `pendiente` · `comprado` · `enviado` · `entregado` · `error` · `cancelado`.
  Un pedido **cancelado o reembolsado** sale con `cancelado` para que DropshipPilot deje de comprar.
- Un pedido vuelve a salir en la lista cuando cambia (cancelado, por ejemplo): por eso `desde` filtra por `actualizado_en`.

## 2) `dropship-pedido-estado` — DropshipPilot informa de la compra y del envío

Cuerpo:

```json
{ "pedido_id": "uuid", "estado": "comprado", "proveedor": "cj", "proveedor_pedido_id": "CJ…",
  "seguimiento": { "numero": "…", "empresa": "…", "url": "…" }, "mensaje": "texto corto opcional" }
```

- `estado` permitido: `comprado` · `enviado` · `entregado` · `error`. Transiciones: `pendiente → comprado → enviado → entregado`;
  `error → comprado`. Repetir el mismo estado es válido (idempotente).
- Retador guarda el estado y el seguimiento y se los enseña al comprador en «Mis pedidos».
- Errores propios: 404 `pedido_no_encontrado` · 409 `transicion_no_valida` · 409 `pedido_cancelado`.

## Lado DropshipPilot (cómo se usa)

1. **Sincronizar** (`retador-tienda` → `pedidos_sincronizar`): pide pedidos nuevos, los guarda en `Order` / `OrderItem` con estado `PAID`
   y cruza cada línea con su variante (por `ref` + `sku`) para saber el costo real del proveedor. Una línea que no se reconozca deja el
   pedido en «necesita revisión»; nunca se inventa nada.
2. **Compra al proveedor** (versión siguiente): modos `APAGADO` · `SIMULACION` (por defecto) · `MANUAL` (botón de aprobar en cada pedido)
   · `AUTOMATICO` (solo cuando Daniel lo active, con tope por pedido y por día, comprobación de saldo, y botón para parar todo).
3. **Informar**: tras comprar y cuando el proveedor da el seguimiento, DropshipPilot lo comunica con `dropship-pedido-estado`.

## Seguridad y dinero

- Nunca se compra dos veces el mismo pedido (clave única por `pedido_id` + línea).
- Nunca se compra si el pedido no está pagado, está cancelado, o el costo del proveedor ha subido más del tope permitido sobre lo previsto.
- Nunca se compra con dinero que no esté cobrado; el saldo del proveedor se comprueba antes y se para si no alcanza.
- Los datos de entrega no salen de la base de DropshipPilot ni de Retador salvo hacia el proveedor que va a enviar el pedido.
- Las llamadas a CJ y AliExpress van de una en una, con pausa (CJ ya bloqueó el acceso una vez por exceso de llamadas).

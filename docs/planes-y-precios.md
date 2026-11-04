# Planes y precios — estudio y decisión (4/11/2026)

Todo en USD (como Retador). Anual = 10 mensualidades («2 meses gratis»). La fuente de los números que enseña la app es `src/lib/planes-catalogo.ts`.

## 1. Qué es dato y qué es supuesto

| Dato | Estado |
|---|---|
| Límites de herramientas por plan (fichas y cotizaciones) | **Real**: los cuenta el servidor (`PlanLimite`). Prueba 5 y 10 en total; Starter 20 y 60 al mes; Pro 80 y 300; A medida 250 y 1.000. |
| Topes de productos de Retador: Gratis 10, Pro 50, Premium 500 | **Real** (los aplica Retador). |
| Retador Premium = 45 USD/mes; conjunto Premium de partida = 55 USD | **Informado por el Claude de Retador** (3/11/2026); no verificado por mí. |
| Precio de Retador Pro, y los anuales de Retador | **Desconocido**: lo fija Retador. Por eso el conjunto Pro se enseña «por confirmar». |
| Comisiones de cobro | Stripe tarjetas europeas 1,5 % + 0,25 €; fuera del EEE 2,5–3,4 % + 0,25 € y +1 % si hay cambio de divisa. Lemon Squeezy 5 % + 0,50 USD (fuentes de terceros, ver abajo). Se usa un techo prudente de **3,4 % + 0,30 USD**. |
| Coste de infraestructura por usuario activo | **SUPUESTO** de 2 USD/mes (DropshipPilot) y 4 USD/mes en un conjunto (las dos apps). **No está medido**; hay que medirlo con los primeros 50 usuarios reales. |
| Coste de las llamadas a CJ y AliExpress | En dinero, **0** hoy (APIs sin cuota de pago conocida). Pero tienen **límites de capacidad** que NO conocemos (el freno de 3.000/día en CJ y 6.000/día en AliExpress lo puse yo). |
| Precios de la competencia | AutoDS desde ≈26,90 USD/mes; DSers desde ≈15,90–19,90 USD/mes hasta 499 USD/mes (agregadores de terceros, cifras que no coinciden entre sí). |

## 2. Qué cuesta de verdad vender un plan

Margen por plan, con el techo de comisión de cobro y el coste de infraestructura supuesto:

| Plan | Precio/mes | Comisión de cobro | Infra (supuesta) | Coste total | Queda | Margen |
|---|---|---|---|---|---|---|
| Starter | 19 | 0,95 | 2,00 | 2,95 | 16,05 | 84 % |
| Pro | 49 | 1,97 | 2,00 | 3,97 | 45,03 | 92 % |
| Premium conjunto | 79 | 2,99 | 4,00 | 6,99 | 72,01 | 91 % |
| Starter anual (190) | 15,83/mes | 6,76/año | 24/año | | | 84 % |
| Pro anual (490) | 40,83/mes | 16,96/año | 24/año | | | 92 % |
| Premium conjunto anual (790) | 65,83/mes | 27,16/año | 48/año | | | 90 % |

Conclusión: **el dinero en efectivo no es el problema** (con estos supuestos ningún plan de pago pierde dinero; hay margen para absorber un coste de infraestructura 5 veces mayor). El problema real es la **capacidad de los proveedores**:

- Un producto publicado y sin ventas se vigila 1 vez al día: **2 llamadas a CJ o 1 a AliExpress**. Con ventas, cada 6 horas (hasta 4 veces más).
- 500 productos de CJ de un solo usuario Premium = **≈1.000 llamadas/día** solo para vigilar. Con el freno actual (3.000/día en CJ), caben unos 3 usuarios Premium llenos de productos de CJ.
- Lo que lo alivia: el mismo producto de dos usuarios se vigila UNA sola vez; la mayoría de usuarios no llenará su tope.
- Lo que hace falta antes de vender Premium a mucha gente: **conocer el límite real de CJ y AliExpress** (o contratar un servicio de datos de pago) y medir cuántos productos publican de verdad los usuarios.

## 3. Decisión de precios

**DropshipPilot solo (cada app cobra lo suyo)**

| Plan | Mensual | Anual | Por qué |
|---|---|---|---|
| Prueba | 0 | 0 | Entrada sin riesgo; límites bajos y en total (no se renueva), para que cueste poco y empuje a pagar. |
| Starter | **19** | **190** | Por debajo del precio de entrada de AutoDS/DSers; 84 % de margen; 20 fichas y 60 envíos al mes bastan para lanzar los primeros 15–20 productos. |
| Pro | **49** | **490** | 4 veces las fichas y 5 veces los envíos de Starter por 2,6 veces el precio; margen 92 %; es el plan «para crecer». |
| A medida | desde **149** | a medida | Solo cuando se conozca la capacidad real de los proveedores; hasta entonces no se vende solo. |

**Conjuntos con Retador (un solo plan, una sola cuenta, un solo pago)**

| Plan conjunto | Retador | DropshipPilot | Mensual | Anual |
|---|---|---|---|---|
| Gratis | Gratis (10 productos) | Prueba | 0 | 0 |
| Pro | Pro (50 productos) | Starter | **(Retador Pro + 19) × 0,85** → por confirmar | ×10 |
| Premium | Premium (500 productos) | Pro | **79** (= (45 + 49) × 0,85, redondeado hacia abajo) | **790** |

- El conjunto cuesta un **15 % menos** que contratar las dos cosas por separado: es el gancho para vincular y quedarse en las dos apps. Nunca baja del coste: con 79 USD queda un 91 % de margen.
- El de partida de 55 USD que trae Retador para Premium **es demasiado bajo**: ya costaría casi lo mismo que Retador Premium solo (45) y regalaría las herramientas Pro (valen 49). Recomendación: **79 USD/mes**.
- Si Retador cambia su precio de Premium, el conjunto se recalcula con la misma fórmula.

## 4. Por qué estos números y no otros

1. **Valor entregado**: cada herramienta ahorra un error que cuesta dinero (publicar sin saber el envío real, vender por debajo del mínimo). El precio es una fracción de una sola venta perdida.
2. **Competencia**: Starter queda justo por debajo de lo que cuestan las alternativas de gama de entrada.
3. **Escalera clara**: 0 → 19 → 49 → a medida; cada salto multiplica lo que incluye más de lo que sube el precio.
4. **Anual a 10 meses**: adelanta caja, reduce comisiones de cobro (una sola por año) y retiene.
5. **Riesgo controlado**: ningún plan de pago pierde dinero; el único riesgo es de capacidad de los proveedores y se vigila con el presupuesto por proveedor del monitor.

## 5. Qué hay que hacer para cobrar de verdad

- **Conjuntos**: los cobra Retador (ya tiene su cobro). Retador debe crear los dos conjuntos de pago con estos precios (mensual y anual) y marcar `plan_conjunto = true` en `dropship-config` para el comprador.
- **DropshipPilot solo**: todavía NO se puede cobrar (no hay pasarela conectada). Las tarjetas dicen «Muy pronto». Hace falta elegir pasarela (ver `PAGOS.md`: Lemon Squeezy o Stripe) y darse de alta en Hacienda.
- **Cuando haya 50 usuarios**: medir el coste real de infraestructura por usuario y las llamadas reales a proveedores, y revisar este documento.

## Fuentes consultadas (4/11/2026)

- Precios de AutoDS y DSers: agregadores de terceros (affmaven.com, avada.io, revenuegeeks.com, nifty.ai…); no coinciden entre sí. Comprobar en las páginas oficiales autods.com/pricing y dsers.com/pricing.
- Comisiones: Stripe Europa (ecomcalctools.com, hayot-expertise.fr) y Lemon Squeezy (dodopayments.com, costbench.com). Son webs de terceros, algunas competidoras; confirmar en stripe.com/pricing y lemonsqueezy.com/pricing.

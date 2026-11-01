// Pruebas del precio automático con la regla del vendedor. Ejecutar: npx tsx tests/retador/precio-auto.test.ts
import assert from 'node:assert/strict';
import { computeSellingPrice, DEFAULT_RULE } from '../../src/lib/pricing';
import { precioPorRegla, reglaDeFila, REGLA_POR_DEFECTO, type ReglaPrecio } from '../../supabase/functions/_compartido/reglas-precio';
import { decidirPrecioAuto, ESPERA_ENTRE_CAMBIOS_MS } from '../../supabase/functions/_compartido/retador-precio-auto';
import { planificarSincronizacion, type EntradaPlan } from '../../supabase/functions/_compartido/retador-sync';
import type { TarifasRetador } from '../../supabase/functions/_compartido/retador-costes';

/* ───────── La cuenta del servidor es la MISMA que la de la pantalla ───────── */
const reglas: ReglaPrecio[] = [
  { ...REGLA_POR_DEFECTO },
  { markupPct: 25, fixedFee: 0.5, minProfit: 2, minPrice: 5, maxPrice: null, roundTo: 0.99 },
  { markupPct: 80, fixedFee: 0, minProfit: 0, minPrice: null, maxPrice: 30, roundTo: 0 },
  { markupPct: -10, fixedFee: 1, minProfit: 0.5, minPrice: null, maxPrice: null, roundTo: 0.95 },
];
let n = 0;
for (const regla of reglas) {
  for (let coste = 0.3; coste < 200; coste = coste * 1.37 + 0.11) {
    const app = computeSellingPrice(coste, 0, { ...regla, includeShipping: false } as any).sellingPrice;
    assert.equal(precioPorRegla(coste, regla), app, `coste ${coste} regla ${JSON.stringify(regla)}`);
    n += 1;
  }
}
assert.ok(n > 40);
assert.equal(precioPorRegla(10.36, REGLA_POR_DEFECTO), computeSellingPrice(10.36, 0, { ...DEFAULT_RULE, includeShipping: false } as any).sellingPrice);
assert.equal(precioPorRegla(10.36, REGLA_POR_DEFECTO), 14.99);
// Fila de la base de datos → regla; sin fila, la de por defecto
assert.deepEqual(reglaDeFila(null), REGLA_POR_DEFECTO);
assert.deepEqual(reglaDeFila({ markupPct: '30.00', fixedFee: '0.50', minProfit: '2.00', minPrice: null, maxPrice: '99', roundTo: '0.99' }), { markupPct: 30, fixedFee: 0.5, minProfit: 2, minPrice: null, maxPrice: 99, roundTo: 0.99 });

/* ───────── Decisión de precio con sus frenos ───────── */
const tarifas: TarifasRetador = {
  hubUsdPorLibra: 1.99, diasHubCuba: [8, 15], comisionPctGanancia: 8, pasarelaPct: 4.4, pasarelaFijaUsd: 0.3,
  pasarelaACargo: 'vendedor', comisionBase: 'precio_venta_menos_costo_producto_menos_pasarela', gananciaMinimaRetadorUsd: 1,
};
const AHORA = Date.UTC(2026, 10, 1, 12);
const base = (o: Partial<Parameters<typeof decidirPrecioAuto>[0]> = {}) => ({
  precioActual: 14.99, coste: { total: 10.36, producto: 7.62 }, tarifas, regla: REGLA_POR_DEFECTO, ultimoCambioMs: null, ahoraMs: AHORA, ...o,
});

// Todo igual: nada que hacer
assert.equal(decidirPrecioAuto(base()).tipo, 'sin_cambio');
// El coste SUBE: el precio sube con la regla (+40 %)
const sube = decidirPrecioAuto(base({ coste: { total: 12, producto: 9.26 } }));
assert.equal(sube.tipo, 'cambiar');
assert.equal((sube as any).nuevo, 16.99);
// El coste BAJA: el precio baja con la regla (no es justo que quede más alto)
const baja = decidirPrecioAuto(base({ coste: { total: 8, producto: 6 } }));
assert.equal(baja.tipo, 'cambiar');
assert.equal((baja as any).nuevo, 11.99);
// Una diferencia mínima no mueve el precio (freno 2 %)
assert.equal(decidirPrecioAuto(base({ precioActual: 14.99, coste: { total: 10.4, producto: 7.62 } })).tipo, 'sin_cambio');
// Suelo: con una regla muy baja, el precio nunca queda por debajo del mínimo de Retador
const reglaBaja: ReglaPrecio = { markupPct: -50, fixedFee: 0, minProfit: 0, minPrice: null, maxPrice: null, roundTo: 0.99 };
const suelo = decidirPrecioAuto(base({ regla: reglaBaja, precioActual: 12.99 }));
assert.equal(suelo.tipo, 'cambiar');
assert.ok((suelo as any).nuevo >= (suelo as any).minimo, 'nunca por debajo del mínimo');
// Un cambio al día: si ya cambió hace poco, espera
const hace1h = AHORA - 3_600_000;
assert.equal(decidirPrecioAuto(base({ coste: { total: 12, producto: 9.26 }, ultimoCambioMs: hace1h })).tipo, 'esperar');
assert.equal(decidirPrecioAuto(base({ coste: { total: 12, producto: 9.26 }, ultimoCambioMs: AHORA - ESPERA_ENTRE_CAMBIOS_MS - 1 })).tipo, 'cambiar');
// Más del 25 %: no se hace solo, se avisa
const golpe = decidirPrecioAuto(base({ coste: { total: 20, producto: 17.26 } }));
assert.equal(golpe.tipo, 'revisar');
// Precio que ya no vale: se arregla al momento aunque haya cambiado hace poco (y dentro del tope)
const reglaSuave: ReglaPrecio = { markupPct: 10, fixedFee: 0, minProfit: 0, minPrice: null, maxPrice: null, roundTo: 0.99 };
const urgente = decidirPrecioAuto({ precioActual: 15, coste: { total: 15, producto: 14 }, tarifas, regla: reglaSuave, ultimoCambioMs: hace1h, ahoraMs: AHORA });
assert.equal(urgente.tipo, 'cambiar');
assert.equal((urgente as any).urgente, true);
assert.ok((urgente as any).nuevo >= (urgente as any).minimo);
// Al activarlo y confirmar (forzar) se aplica la regla sin frenos de umbral, espera ni tope
assert.equal(decidirPrecioAuto(base({ precioActual: 14.99, coste: { total: 20, producto: 17.26 }, forzar: true })).tipo, 'cambiar');
assert.equal(decidirPrecioAuto(base({ precioActual: 14.99, forzar: true })).tipo, 'sin_cambio');

/* ───────── Dentro del plan de sincronización ───────── */
const entrada = (sobre: Partial<EntradaPlan> = {}): EntradaPlan => ({
  locales: [{ sku: 'A', titulo: 'Rosa', stockProveedorPrevio: 10, precioActual: 14.99, costeAntes: 10.36 }],
  remotas: new Map([['A', { stock: 10, estimado: false, precio: 14.99 }]]),
  actuales: new Map([['A', { stock: 10, coste: { total: 10.36, producto: 7.62 } }]]),
  tarifas, estadoRemoto: 'activo', admiteEnvio: false, envio: null, huellaEnvioPrevia: null, admiteResenas: false, resenas: null, huellaResenasPrevia: null,
  ...sobre,
});
const auto = { regla: REGLA_POR_DEFECTO, ultimoCambioMs: null, ahoraMs: AHORA };
const autoSuave = { regla: reglaSuave, ultimoCambioMs: null, ahoraMs: AHORA };
const costeAlto = new Map([['A', { stock: 10, coste: { total: 20, producto: 17.26 } }]]);
// Coste que sube hasta dejar el precio de 15 USD por debajo del mínimo (16,00), con una regla del 10 %
const precio15 = { locales: [{ sku: 'A', titulo: 'Rosa', stockProveedorPrevio: 10, precioActual: 15, costeAntes: 10.36 }], remotas: new Map([['A', { stock: 10, estimado: false, precio: 15 }]]), actuales: new Map([['A', { stock: 10, coste: { total: 15, producto: 14 } }]]) };

// Sin precio automático, un coste que sube NO toca el precio: pausa (como antes)
const sinAuto = planificarSincronizacion(entrada(precio15));
assert.equal(sinAuto.precios.length, 0);
assert.equal(sinAuto.pausar, true);
// Con precio automático, el precio SUBE con la regla y el producto NO se pausa
const conAuto = planificarSincronizacion(entrada({ ...precio15, auto: autoSuave }));
assert.equal(conAuto.precios.length, 1);
assert.equal(conAuto.precios[0].nuevo, precioPorRegla(15, reglaSuave));
assert.ok(conAuto.precios[0].nuevo >= 16);
assert.equal(conAuto.pausar, false);
assert.equal(conAuto.riesgos.length, 0);
assert.equal(conAuto.hayCambios, true);
// Un salto de más del 25 %: no lo hace solo y, como el precio ya no vale, se pausa y se avisa
const salto = planificarSincronizacion(entrada({ actuales: costeAlto, auto }));
assert.equal(salto.precios.length, 0);
assert.equal(salto.revisiones.length, 1);
assert.equal(salto.pausar, true);
// Con el precio automático y sin cambios de coste: nada
assert.equal(planificarSincronizacion(entrada({ auto })).hayCambios, false);

console.log('✓ precio automático: todo correcto');

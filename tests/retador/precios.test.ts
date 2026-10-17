// Pruebas de las cuentas de Retador. Ejecutar: npx tsx tests/retador/precios.test.ts
import assert from 'node:assert/strict';
import { costePuestoEnCuba, datosQueFaltan, liquidacion, precioMinimoSinPerdida, precioPropuesto } from '../../src/lib/retador/precios';

const t = { hubUsdPorLibra: 1.99, diasHubCuba: [8, 15] as [number, number], comisionPctGanancia: 8, pasarelaPct: 4.4, pasarelaFijaUsd: 0.3 };

// 1 kg = 2,2046 lb → 4,39 $ de hub→Cuba
const c = costePuestoEnCuba({ costeUsd: 10, envioHubUsd: 3, pesoGramos: 1000, tarifas: t });
assert.deepEqual(c, { producto: 10, envioHub: 3, hubCuba: 4.39, total: 17.39 });

// Sin peso, sin envío al hub o sin tarifa: no se calcula nada
assert.equal(costePuestoEnCuba({ costeUsd: 10, envioHubUsd: 3, pesoGramos: null, tarifas: t }), null);
assert.equal(costePuestoEnCuba({ costeUsd: 10, envioHubUsd: undefined, pesoGramos: 100, tarifas: t }), null);
assert.equal(costePuestoEnCuba({ costeUsd: 10, envioHubUsd: 3, pesoGramos: 100, tarifas: null }), null);
assert.deepEqual(datosQueFaltan({ costeUsd: 10, envioHubUsd: null, pesoGramos: 0, tarifas: null }), ['envío del proveedor al hub de EE. UU.', 'peso real', 'tarifa hub→Cuba de Retador']);
// Envío 0 es un dato real (envío gratis cotizado), no «falta»
assert.ok(costePuestoEnCuba({ costeUsd: 10, envioHubUsd: 0, pesoGramos: 100, tarifas: t }));

// Liquidación: precio 30, coste 17,39 → ganancia 12,61; comisión 8 % = 1,01; pasarela 4,4 % de 30 + 0,30 = 1,62 → neto 9,98
const l = liquidacion(30, 17.39, t);
assert.equal(l.ganancia, 12.61); assert.equal(l.comision, 1.01); assert.equal(l.pasarela, 1.62); assert.equal(l.neto, 9.98);
// Si la pasarela la paga el comprador, no se descuenta al vendedor
assert.equal(liquidacion(30, 17.39, { ...t, pasarelaACargo: 'comprador' }).neto, 11.6);
// Vender por debajo del coste: sin comisión y neto negativo
const p = liquidacion(10, 17.39, t); assert.equal(p.comision, 0); assert.ok(p.neto < 0);

// Precio mínimo sin pérdida: con ese precio el neto es ≥ 0 y un céntimo menos ya pierde
const min = precioMinimoSinPerdida(17.39, t);
assert.ok(liquidacion(min, 17.39, t).neto >= 0, `neto en el mínimo ${min}`);
assert.ok(liquidacion(min - 0.02, 17.39, t).neto < 0);

// Precio propuesto con regla de margen 40 % sobre el coste puesto en Cuba (17,39 × 1,4 = 24,35 → 24,99 con redondeo 0,99)
const prop = precioPropuesto(c, { markupPct: 40, minProfit: 1.5, roundTo: 0.99 });
assert.ok(prop >= 24.35 && prop <= 24.99, `propuesto ${prop}`);
assert.ok(prop > c.total);
console.log('✔ cuentas de Retador correctas');

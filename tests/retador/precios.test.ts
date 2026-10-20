// Pruebas de las cuentas de Retador. Ejecutar: npx tsx tests/retador/precios.test.ts
import assert from 'node:assert/strict';
import { costeParaPublicar, costePuestoEnCuba, datosQueFaltan, esContratoV13, faltanParaPublicar, liquidacion, precioMinimoSinPerdida, precioPropuesto } from '../../src/lib/retador/precios';

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

// Reparto real de Retador: pasarela a cargo de Retador y comisión sobre (precio − costo del producto), sin envío
const real = { ...t, pasarelaACargo: 'retador' as const, comisionBase: 'precio_venta_menos_costo_producto' as const };
const lr = liquidacion(30, 17.39, real, 10);
assert.equal(lr.ganancia, 20); assert.equal(lr.comision, 1.6); assert.equal(lr.neto, 18.4); // (30 − 10) × 0,92
assert.equal(precioMinimoSinPerdida(17.39, real, 10), 17.39); // manda el mínimo de Retador: el coste puesto en Cuba

// Liquidación (modelo antiguo, sin costo de producto): precio 30, coste 17,39 → ganancia 12,61; comisión 8 % = 1,01; pasarela 4,4 % de 30 + 0,30 = 1,62 → neto 9,98
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

// ───────── Contrato v1.3 (parte A): pasarela del vendedor sobre el total cobrado, envío aparte, mínimo del Importador ─────────
const v13 = { ...t, pasarelaACargo: 'vendedor' as const, comisionBase: 'precio_venta_menos_costo_producto_menos_pasarela' as const, gananciaMinimaRetadorUsd: 1 };
assert.equal(esContratoV13(v13), true);
assert.equal(esContratoV13(t), false);
assert.equal(esContratoV13({ ...t, gananciaMinimaRetadorUsd: NaN }), false);

// Ejemplo real del contrato: costo 15,28 · precio 25 · envío cobrado 10,03 · plan Pro 8 % → cobrado 35,03, pasarela 1,84, base 7,88, comisión 0,63, neto 7,25
const ej = liquidacion(25, 15.28 + 10.03, v13, 15.28);
assert.equal(ej.pasarela, 1.84); assert.equal(ej.ganancia, 9.72); assert.equal(ej.comision, 0.63); assert.equal(ej.neto, 7.25);

// La fórmula escrita en el contrato (neto_formula) da lo mismo
const netoContrato = (precio: number, costo: number, envio: number) => {
  const pasarela = Math.round(((precio + envio) * (t.pasarelaPct / 100) + t.pasarelaFijaUsd) * 100) / 100;
  const base = Math.max(0, precio - costo - pasarela);
  return Math.round((base - Math.round(base * 0.08 * 100) / 100) * 100) / 100;
};
for (const [precio, costo, envio] of [[25, 15.28, 10.03], [12.99, 4.2, 3.5], [40, 20, 0], [9.99, 5.5, 8.25]] as const) {
  assert.equal(liquidacion(precio, costo + envio, v13, costo).neto, netoContrato(precio, costo, envio), `neto ${precio}/${costo}/${envio}`);
}

// Precio mínimo = el del Importador de Retador: ceil((costo + fija + ganancia mínima) / (1 − pasarela %) × 100) / 100 (el envío no entra)
assert.equal(precioMinimoSinPerdida(15.28 + 10.03, v13, 15.28), 17.35);
assert.equal(precioMinimoSinPerdida(10 + 1, v13, 10), 11.83); // (10 + 0,30 + 1) / 0,956 = 11,8201 → 11,83
// Con un envío enorme manda «no perder con la pasarela sobre el total cobrado»: (5 + 99 × 0,044 + 0,30) / 0,956 = 10,10 → 10,11 (el del Importador sería 6,59)
assert.equal(precioMinimoSinPerdida(5 + 99, v13, 5), 10.11);
// Con ese precio mínimo el vendedor no pierde y un precio claramente menor sí
for (const [costo, envio] of [[15.28, 10.03], [4.2, 3.5], [8, 0], [2.5, 30]] as const) {
  const m = precioMinimoSinPerdida(costo + envio, v13, costo);
  assert.ok(liquidacion(m, costo + envio, v13, costo).neto >= 0, `neto en el mínimo ${m} (${costo}/${envio})`);
  assert.ok(liquidacion(m - 0.5, costo + envio, v13, costo).neto < liquidacion(m, costo + envio, v13, costo).neto);
}
// Pasarela a cargo de Retador (antes de aplicar el SQL 44): no se descuenta nada al vendedor
const v13r = { ...v13, pasarelaACargo: 'retador' as const, comisionBase: 'precio_venta_menos_costo_producto' as const };
assert.equal(liquidacion(25, 25.31, v13r, 15.28).neto, 8.94); // (25 − 15,28) × 0,92
// Vender por debajo del costo del producto: sin comisión y neto negativo (nunca se publicaría)
const perd = liquidacion(10, 25.31, v13, 15.28); assert.equal(perd.comision, 0); assert.ok(perd.neto < 0);
// La versión 1 del contrato (sin ganancia mínima) sigue calculándose igual que antes
assert.equal(liquidacion(30, 17.39, t).neto, 9.98);

// ───────── Publicar sin envío cotizado ni peso (contrato v1.3: el envío va aparte y Retador lo cotiza al comprar) ─────────
const sinDatos = { costeUsd: 7.76, envioHubUsd: null, pesoGramos: null, tarifas: v13 };
assert.deepEqual(faltanParaPublicar(sinDatos), []);
assert.deepEqual(costeParaPublicar(sinDatos), { producto: 7.76, envioHub: 0, hubCuba: 0, total: 7.76, sinEnvio: true });
assert.deepEqual(faltanParaPublicar({ ...sinDatos, costeUsd: null }), ['coste de la variante']); // el coste del producto sigue siendo imprescindible
assert.equal(costeParaPublicar({ ...sinDatos, costeUsd: null }), null);
// Con datos completos se sigue estimando el envío como antes
assert.deepEqual(costeParaPublicar({ costeUsd: 10, envioHubUsd: 3, pesoGramos: 1000, tarifas: v13 }), { producto: 10, envioHub: 3, hubCuba: 4.39, total: 17.39 });
// Sin envío, el mínimo es el del Importador de Retador y el neto se calcula sin envío
const sinEnv = costeParaPublicar(sinDatos)!;
assert.equal(precioMinimoSinPerdida(sinEnv.total, v13, sinEnv.producto), 9.48); // (7,76 + 0,30 + 1) / 0,956 = 9,4770 → 9,48
assert.equal(liquidacion(9.48, sinEnv.total, v13, sinEnv.producto).neto > 0, true);
// Con la versión 1 del contrato (sin ganancia mínima) siguen exigiéndose el envío al hub y el peso
assert.deepEqual(faltanParaPublicar({ costeUsd: 7.76, envioHubUsd: null, pesoGramos: null, tarifas: t }), ['envío del proveedor al hub de EE. UU.', 'peso real']);
assert.equal(costeParaPublicar({ costeUsd: 7.76, envioHubUsd: null, pesoGramos: null, tarifas: t }), null);
console.log('✔ cuentas de Retador correctas');

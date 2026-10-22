// Ejecutar: npx tsx tests/retador/pedidos.test.ts
import assert from 'node:assert/strict';
import { efectoDeCancelacion, etiquetaEstadoPedido, normalizarPedido, parsearRef } from '../../supabase/functions/_compartido/retador-pedidos';

const T = '11111111-1111-4111-8111-111111111111';
const P = '22222222-2222-4222-8222-222222222222';
assert.deepEqual(parsearRef(`dsp:${T}:${P}`), { tiendaId: T, productoId: P });
assert.equal(parsearRef('otra:cosa'), null);
assert.equal(parsearRef(`dsp:${T}`), null);
assert.equal(parsearRef(null), null);

const bueno = {
  pedido_id: 'ped-1', numero: 'R-000123', pagado_en: '2026-10-22T10:05:00Z', moneda: 'usd',
  lineas: [{ ref: `dsp:${T}:${P}`, sku: 'CJYD177061601AZ', cantidad: 2, precio_venta_usd: 43.989 }],
  entrega: { tipo: 'centro_logistico', pais: 'us', nombre: 'Centro', telefono: '+1 555', direccion1: '123 Calle', ciudad: 'Phoenix', provincia: 'AZ', codigo_postal: '85001', referencia: 'R-000123' },
  estado_compra: 'pendiente',
};
const r = normalizarPedido(bueno);
assert.ok(r.ok);
if (r.ok) {
  assert.equal(r.pedido.moneda, 'USD');
  assert.equal(r.pedido.entrega.pais, 'US');
  assert.equal(r.pedido.lineas[0].precioVentaUsd, 43.99);
  assert.equal(r.pedido.lineas[0].cantidad, 2);
  assert.equal(r.pedido.entrega.referencia, 'R-000123');
}
// Cualquier dato dudoso lo rechaza (no se inventa nada)
for (const [nombre, cambio] of [
  ['sin id', { pedido_id: '' }], ['sin líneas', { lineas: [] }], ['cantidad 0', { lineas: [{ ...bueno.lineas[0], cantidad: 0 }] }],
  ['cantidad decimal', { lineas: [{ ...bueno.lineas[0], cantidad: 1.5 }] }], ['precio 0', { lineas: [{ ...bueno.lineas[0], precio_venta_usd: 0 }] }],
  ['sin sku', { lineas: [{ ...bueno.lineas[0], sku: '' }] }], ['sin dirección', { entrega: { ...bueno.entrega, direccion1: '' } }],
  ['país mal', { entrega: { ...bueno.entrega, pais: 'USA' } }], ['tipo raro', { entrega: { ...bueno.entrega, tipo: 'volando' } }],
  ['estado raro', { estado_compra: 'quizá' }], ['fecha mala', { pagado_en: 'ayer' }],
] as const) {
  assert.equal(normalizarPedido({ ...bueno, ...cambio }).ok, false, nombre);
}
assert.equal(normalizarPedido(null).ok, false);

// Cancelaciones
assert.deepEqual(efectoDeCancelacion('PAID'), { estado: 'CANCELED', aviso: null });
assert.deepEqual(efectoDeCancelacion('SUPPLIER_ERROR'), { estado: 'CANCELED', aviso: null });
assert.equal(efectoDeCancelacion('SUPPLIER_PURCHASED').estado, null);
assert.match(efectoDeCancelacion('SHIPPED').aviso ?? '', /DESPUÉS de comprarlo/);
assert.deepEqual(efectoDeCancelacion('CANCELED'), { estado: null, aviso: null });
assert.equal(etiquetaEstadoPedido('PAID').tono, 'aviso');
assert.equal(etiquetaEstadoPedido('SUPPLIER_ERROR').tono, 'error');
console.log('✔ pedidos de Retador correctos');

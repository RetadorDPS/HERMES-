// Ejecutar: npx tsx tests/retador/compras.test.ts
import assert from 'node:assert/strict';
import { CONFIG_POR_DEFECTO, evaluarCompra, validarConfig, type OrdenCompra } from '../../supabase/functions/_compartido/compras';

const item = { sku: 'A', titulo: 'Aire', cantidad: 1, supplierVariantId: 'vid-1', proveedor: 'CJ_DROPSHIPPING' as const, costeUnitUsd: 7.76 };
const orden: OrdenCompra = { id: 'o1', estado: 'PAID', aviso: null, entrega: { nombre: 'Centro', direccion1: '8925 N 43rd Ave', ciudad: 'Phoenix', pais: 'US' }, items: [item], yaComprado: [] };
const cfg: import('../../supabase/functions/_compartido/compras').ConfigCompras = { ...CONFIG_POR_DEFECTO, modo: 'MANUAL' };

const bien = evaluarCompra(orden, cfg, 0);
assert.ok(bien.ok);
if (bien.ok) { assert.equal(bien.costeTotalUsd, 7.76); assert.equal(bien.grupos.length, 1); assert.equal(bien.grupos[0].proveedor, 'CJ_DROPSHIPPING'); }

const codigo = (o: OrdenCompra, c = cfg, hoy = 0) => { const d = evaluarCompra(o, c, hoy); return d.ok ? 'ok' : d.codigo; };
assert.equal(codigo(orden, { ...cfg, modo: 'APAGADO' }), 'compras_apagadas');
assert.equal(codigo({ ...orden, estado: 'SUPPLIER_PURCHASED' }), 'no_pagado');
assert.equal(codigo({ ...orden, estado: 'PENDING' }), 'no_pagado');
assert.equal(codigo({ ...orden, aviso: 'Necesita revisión: XYZ' }), 'necesita_revision');
assert.equal(codigo({ ...orden, items: [] }), 'datos_incompletos');
assert.equal(codigo({ ...orden, items: [{ ...item, supplierVariantId: null }] }), 'datos_incompletos');
assert.equal(codigo({ ...orden, items: [{ ...item, proveedor: null }] }), 'datos_incompletos');
assert.equal(codigo({ ...orden, items: [{ ...item, costeUnitUsd: 0 }] }), 'datos_incompletos');
assert.equal(codigo({ ...orden, items: [{ ...item, cantidad: 0 }] }), 'datos_incompletos');
assert.equal(codigo({ ...orden, entrega: { ...orden.entrega, direccion1: null } }), 'entrega_incompleta');
// Costo que sube: 10 % de margen → 8,54 vale; 8,60 no
assert.equal(codigo({ ...orden, items: [{ ...item, costeActualUsd: 8.5 }] }), 'ok');
assert.equal(codigo({ ...orden, items: [{ ...item, costeActualUsd: 8.6 }] }), 'coste_subio');
// Topes
assert.equal(codigo({ ...orden, items: [{ ...item, cantidad: 7 }] }), 'supera_limite_pedido'); // 54,32 > 50
assert.equal(codigo(orden, cfg, 195), 'supera_limite_dia'); // 195 + 7,76 > 200
assert.equal(codigo(orden, cfg, 192), 'ok'); // 199,76
// Ya comprado
assert.equal(codigo({ ...orden, yaComprado: ['CJ_DROPSHIPPING'] }), 'ya_comprado');
// Dos proveedores: solo se compra al que falta
const mixto: OrdenCompra = { ...orden, items: [item, { ...item, sku: 'B', proveedor: 'ALIEXPRESS', costeUnitUsd: 3 }], yaComprado: ['CJ_DROPSHIPPING'] };
const dm = evaluarCompra(mixto, cfg, 0);
assert.ok(dm.ok);
if (dm.ok) { assert.equal(dm.grupos.length, 1); assert.equal(dm.grupos[0].proveedor, 'ALIEXPRESS'); assert.equal(dm.costeTotalUsd, 3); }

// Configuración
assert.ok(validarConfig({ modo: 'MANUAL', limitePedidoUsd: 50, limiteDiaUsd: 200, subidaMaxPct: 10 }, 0).ok);
assert.equal(validarConfig({ modo: 'RARO', limitePedidoUsd: 50, limiteDiaUsd: 200, subidaMaxPct: 10 }, 0).ok, false);
assert.equal(validarConfig({ modo: 'MANUAL', limitePedidoUsd: -1, limiteDiaUsd: 200, subidaMaxPct: 10 }, 0).ok, false);
assert.equal(validarConfig({ modo: 'MANUAL', limitePedidoUsd: 300, limiteDiaUsd: 200, subidaMaxPct: 10 }, 0).ok, false);
assert.equal(validarConfig({ modo: 'AUTOMATICO', limitePedidoUsd: 50, limiteDiaUsd: 200, subidaMaxPct: 10 }, 2).ok, false);
assert.ok(validarConfig({ modo: 'AUTOMATICO', limitePedidoUsd: 50, limiteDiaUsd: 200, subidaMaxPct: 10 }, 3).ok);
console.log('✔ decisión de compras correcta');

// Elegir el envío de la compra
import { elegirEnvioCompra } from '../../supabase/functions/_compartido/compras';
const ficha = { envio: { porOrigen: { CN: { US: { opciones: [{ nombre: 'CJPacket', precio: 4.5 }, { nombre: 'USPS+', precio: 3.9 }] } }, US: { US: { opciones: [{ nombre: 'USPS', precio: 2.1 }] } } } } };
const e1: any = elegirEnvioCompra([ficha], [new Set(['CN'])], 'US');
assert.equal(e1.logistica, 'USPS+'); assert.equal(e1.origen, 'CN');
const e2: any = elegirEnvioCompra([ficha], [new Set(['CN', 'US'])], 'US');
assert.equal(e2.logistica, 'USPS'); assert.equal(e2.origen, 'US');
assert.ok('error' in elegirEnvioCompra([ficha], [new Set(['DE'])], 'US'));
assert.ok('error' in elegirEnvioCompra([ficha], [new Set(['CN'])], 'ES'));
assert.ok('error' in elegirEnvioCompra([ficha, ficha], [new Set(['CN']), new Set(['US'])], 'US'));
console.log('✔ envío de compra correcto');

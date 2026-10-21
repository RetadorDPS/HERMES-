// Pruebas de existencias y envío para publicar en Retador. Ejecutar: npx tsx tests/retador/stock.test.ts
import assert from 'node:assert/strict';
import { envioAlHub, stockPorOrigen } from '../../supabase/functions/_compartido/retador-stock';

// CJ: el stock de fábrica CUENTA (caso real: Air Cooler, 0 en almacén CJ y 13.855 en fábrica)
const aire = stockPorOrigen({ stock: [{ cj: 0, pais: 'CN', total: 13855, fabrica: 13855 }] }, 'cj');
assert.equal(aire.total, 13855); assert.equal(aire.almacen, 0); assert.equal(aire.fabrica, 13855);
assert.deepEqual([...aire.origenes], [['CN', 13855]]);
// CJ: almacén + fábrica en el mismo origen se suman; varios orígenes se separan
const mixto = stockPorOrigen({ stock: [{ cj: 10, pais: 'US', fabrica: 0, total: 10 }, { cj: 5, pais: 'CN', fabrica: 100, total: 105 }] }, 'cj');
assert.equal(mixto.total, 115); assert.equal(mixto.almacen, 15); assert.equal(mixto.fabrica, 100);
assert.deepEqual([...mixto.origenes].sort(), [['CN', 105], ['US', 10]]);
// CJ: solo «total» (sin desglose) también vale; sin datos = no se sabe (null), nunca 0 inventado
assert.equal(stockPorOrigen({ stock: [{ pais: 'CN', total: 7 }] }, 'cj').total, 7);
assert.equal(stockPorOrigen({ stock: [] }, 'cj').total, null);
assert.equal(stockPorOrigen({}, 'cj').total, null);
// CJ con 0 en todo: es 0 real (agotado)
assert.equal(stockPorOrigen({ stock: [{ cj: 0, fabrica: 0, pais: 'CN', total: 0 }] }, 'cj').total, 0);
// AliExpress: el stock de la variante
assert.equal(stockPorOrigen({ stock: [{ pais: null, total: 120 }] }, 'aliexpress').total, 120);
assert.equal(stockPorOrigen({ stock: [] }, 'aliexpress').total, null);

// Envío al hub: la cotización más barata hacia EE. UU., solo de los almacenes que tienen el stock
const ficha = { envio: { porOrigen: { CN: { US: { opciones: [{ precio: 18.1, diasMin: 8, diasMax: 12 }, { precio: 25, diasMin: 5, diasMax: 7 }] } }, US: { US: { opciones: [{ precio: 4, diasMin: 2, diasMax: 4 }] } }, DE: { ES: { opciones: [{ precio: 3 }] } } } } };
assert.deepEqual(envioAlHub(ficha), { precio: 4, origen: 'US', dias: [2, 4] });
assert.deepEqual(envioAlHub(ficha, new Set(['CN'])), { precio: 18.1, origen: 'CN', dias: [8, 12] });
assert.equal(envioAlHub(ficha, new Set(['DE'])), null); // sin cotización a EE. UU. desde ese almacén
assert.equal(envioAlHub(ficha, new Set(['XX'])), null);
assert.equal(envioAlHub({}), null);
console.log('✔ existencias y envío de Retador correctos');

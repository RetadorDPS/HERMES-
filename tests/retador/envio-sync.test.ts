// Pruebas del envío por país hacia Retador (contrato v1.5) y de la sincronización automática. Ejecutar: npx tsx tests/retador/envio-sync.test.ts
import assert from 'node:assert/strict';
import { envioParaRetador, huellaEnvio, MAX_DESTINOS } from '../../supabase/functions/_compartido/retador-envio';
import { planificarSincronizacion, stockAEnviar, SUBIDA_MIN_USD, type EntradaPlan } from '../../supabase/functions/_compartido/retador-sync';
import type { TarifasRetador } from '../../supabase/functions/_compartido/retador-costes';

/* ───────────────────────────── Envío por país ───────────────────────────── */

const q = (opciones: any[], actualizado = '2026-10-30T10:00:00.000Z', extra: object = {}) => ({ variante: 'v1', actualizado, opciones, ...extra });
const ficha = {
  envio: {
    porOrigen: {
      CN: {
        US: q([{ nombre: 'A', precio: 4.5, diasMin: 10, diasMax: 20 }, { nombre: 'B', precio: 2.1, diasMin: 12, diasMax: 25 }]),
        ES: q([{ nombre: 'A', precio: 3, diasMin: 7, diasMax: 12 }], '2026-10-31T08:00:00.000Z'),
        CU: q([{ nombre: 'A', precio: 9, diasMin: 20, diasMax: 40 }]),
        FR: q([], undefined, { error: 'sin servicio' }),
        MX: q([{ nombre: 'A', precio: 5, diasMin: 9, diasMax: 5 }]), // días imposibles: no se manda
        BR: q([{ nombre: 'A', precio: 6, diasMin: 130, diasMax: 140 }]), // mín > 120: no se manda
        DE: q([{ nombre: 'A', precio: null, diasMin: 5, diasMax: 9 }]), // sin precio: no se manda
        IT: q([{ nombre: 'A', precio: null, gratis: true, diasMin: 6.2, diasMax: 9.1 }]), // gratis dicho por la cotización: cuenta como 0
      },
      US: {
        US: q([{ nombre: 'A', precio: 1.25, diasMin: 3, diasMax: 6 }]),
        ES: q([{ nombre: 'A', precio: 8, diasMin: 5, diasMax: 8 }]),
      },
    },
  },
};

// CJ con stock solo en China
const cn = envioParaRetador(ficha, new Set(['CN']))!;
assert.deepEqual(cn.destinos.map((d) => d.pais), ['US', 'ES', 'IT']); // US primero; CU, FR, MX, BR y DE fuera
assert.deepEqual(cn.destinos[0], { pais: 'US', dias_min: 12, dias_max: 25, precio_usd: 2.1, gratis: false }); // la opción más barata
assert.deepEqual(cn.destinos[2], { pais: 'IT', dias_min: 6, dias_max: 10, precio_usd: 0, gratis: true }); // gratis → 0; días a enteros
assert.equal(cn.cotizado_en, '2026-10-31T08:00:00.000Z'); // la cotización más reciente de las que se mandan
// El almacén sin stock no cuenta: si el stock está en EE. UU., el precio y los días son los de ese almacén
const us = envioParaRetador(ficha, new Set(['US']))!;
assert.deepEqual(us.destinos.map((d) => `${d.pais}:${d.precio_usd}`), ['US:1.25', 'ES:8']);
// Sin almacén con stock (CJ) = nada que mandar; sin filtro (AliExpress) vale el más barato de todos los almacenes
assert.equal(envioParaRetador(ficha, new Set()), null);
const todos = envioParaRetador(ficha, null)!;
assert.equal(todos.destinos.find((d) => d.pais === 'US')!.precio_usd, 1.25);
assert.equal(todos.destinos.find((d) => d.pais === 'ES')!.precio_usd, 3);
// Cuba nunca se manda
assert.ok(!todos.destinos.some((d) => d.pais === 'CU'));
// Sin cotizaciones o sin fecha válida: null
assert.equal(envioParaRetador({}, null), null);
assert.equal(envioParaRetador({ envio: { porOrigen: { CN: { ES: { opciones: [{ precio: 1, diasMin: 1, diasMax: 2 }] } } } } }, null), null);
// Tope de 100 países y EE. UU. siempre dentro
const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const muchos: any = {};
for (const a of letras) for (const b of letras.slice(0, 6)) muchos[`${a}${b}`] = q([{ precio: 1, diasMin: 2, diasMax: 4 }]);
muchos.US = q([{ precio: 7, diasMin: 2, diasMax: 4 }]);
const topado = envioParaRetador({ envio: { porOrigen: { CN: muchos } } }, null)!;
assert.equal(topado.destinos.length, MAX_DESTINOS);
assert.equal(topado.destinos[0].pais, 'US');
// Cumple lo que Retador valida
for (const d of topado.destinos) {
  assert.match(d.pais, /^[A-Z]{2}$/);
  assert.ok(Number.isInteger(d.dias_min) && Number.isInteger(d.dias_max) && d.dias_min <= 120 && d.dias_max <= 150 && d.dias_max >= d.dias_min);
}
// La huella cambia si cambia un precio o un día y no si solo cambia la fecha
const f2 = JSON.parse(JSON.stringify(ficha));
const base = huellaEnvio(envioParaRetador(ficha, new Set(['CN']))!);
assert.equal(huellaEnvio(envioParaRetador(f2, new Set(['CN']))!), base);
f2.envio.porOrigen.CN.ES.actualizado = '2026-11-01T00:00:00.000Z';
assert.equal(huellaEnvio(envioParaRetador(f2, new Set(['CN']))!), base);
f2.envio.porOrigen.CN.ES.opciones[0].precio = 3.2;
assert.notEqual(huellaEnvio(envioParaRetador(f2, new Set(['CN']))!), base);

/* ───────────────────────────── Stock hacia Retador ───────────────────────────── */

const ver = (stock: number | null) => ({ stock, estimado: false });
assert.equal(stockAEnviar(10, 10, ver(7)), undefined); // el proveedor no cambió: no se pisa lo que Retador descontó por ventas
assert.equal(stockAEnviar(10, 0, ver(7)), 0); // agotado en el proveedor
assert.equal(stockAEnviar(10, 0, ver(0)), undefined); // ya estaba agotado
assert.equal(stockAEnviar(10, 8, ver(7)), undefined); // Retador ya tiene menos
assert.equal(stockAEnviar(10, 5, ver(7)), 5); // el proveedor tiene menos de lo que Retador cree
assert.equal(stockAEnviar(10, 30, ver(7)), 27); // repuso 20: se suman a lo que Retador tenga
assert.equal(stockAEnviar(0, 20, ver(0)), 20); // volvió el stock de un producto agotado
assert.equal(stockAEnviar(10, null, ver(7)), null); // pasa a desconocido: viaja null
assert.equal(stockAEnviar(null, null, ver(7)), undefined); // seguía desconocido
assert.equal(stockAEnviar(10, 12, { stock: 5, estimado: true }), 12); // el dato real sustituye a la estimación
assert.equal(stockAEnviar(null, 12, ver(7)), undefined); // sin referencia no se sube a ciegas
assert.equal(stockAEnviar(null, 3, ver(7)), 3); // pero sí se baja

/* ───────────────────────────── Plan de sincronización ───────────────────────────── */

const tarifas: TarifasRetador = {
  hubUsdPorLibra: 1.99, diasHubCuba: [8, 15], comisionPctGanancia: 8, pasarelaPct: 4.4, pasarelaFijaUsd: 0.3,
  pasarelaACargo: 'vendedor', comisionBase: 'precio_venta_menos_costo_producto_menos_pasarela', gananciaMinimaRetadorUsd: 1,
};
const entrada = (sobre: Partial<EntradaPlan> = {}): EntradaPlan => ({
  locales: [{ sku: 'A', titulo: 'Rojo', stockProveedorPrevio: 10, precioActual: 25, costeAntes: 15 }],
  remotas: new Map([['A', { stock: 10, estimado: false, precio: 25 }]]),
  actuales: new Map([['A', { stock: 10, coste: { total: 15, producto: 12 } }]]),
  tarifas, estadoRemoto: 'activo',
  admiteEnvio: true, envio: null, huellaEnvioPrevia: null,
  admiteResenas: true, resenas: null, huellaResenasPrevia: null,
  ...sobre,
});

// Nada ha cambiado = nada que mandar
assert.equal(planificarSincronizacion(entrada()).hayCambios, false);
// Stock a 0 → se manda 0, sin pausar
const agot = planificarSincronizacion(entrada({ actuales: new Map([['A', { stock: 0, coste: { total: 15, producto: 12 } }]]) }));
assert.deepEqual(agot.variantes, [{ sku: 'A', stock: 0 }]);
assert.equal(agot.pausar, false);
// Variante que el proveedor retira = stock 0
const retirada = planificarSincronizacion(entrada({ actuales: new Map() }));
assert.deepEqual(retirada.variantes, [{ sku: 'A', stock: 0 }]);
assert.ok(retirada.resumen.some((r) => r.includes('retirada')));
// Coste que baja o sube un poco: nunca se toca el precio ni se pausa
const baja = planificarSincronizacion(entrada({ actuales: new Map([['A', { stock: 10, coste: { total: 12, producto: 9 } }]]) }));
assert.equal(baja.pausar, false);
const oscila = planificarSincronizacion(entrada({ actuales: new Map([['A', { stock: 10, coste: { total: 15 + SUBIDA_MIN_USD - 0.01, producto: 12 } }]]) }));
assert.equal(oscila.pausar, false);
// Subida grande que deja el precio por debajo del mínimo → se PAUSA y se avisa; el precio no se cambia
const sube = planificarSincronizacion(entrada({ actuales: new Map([['A', { stock: 10, coste: { total: 26, producto: 24 } }]]) }));
assert.equal(sube.pausar, true);
assert.equal(sube.riesgos.length, 1);
assert.equal(sube.riesgos[0].sku, 'A');
assert.ok(sube.riesgos[0].minimoUsd > 25);
assert.equal((sube as any).variantes.some((v: any) => 'precio' in v || 'precio_venta_usd' in v), false);
// Ya pausado: se anota el riesgo pero no se vuelve a pausar
const yaPausado = planificarSincronizacion(entrada({ estadoRemoto: 'pausado', actuales: new Map([['A', { stock: 10, coste: { total: 26, producto: 24 } }]]) }));
assert.equal(yaPausado.pausar, false);
assert.equal(yaPausado.riesgos.length, 1);
// Subida grande pero agotada: no hay riesgo de vender
const subeAgotada = planificarSincronizacion(entrada({ actuales: new Map([['A', { stock: 0, coste: { total: 26, producto: 24 } }]]) }));
assert.equal(subeAgotada.riesgos.length, 0);
// Subida que el precio aguanta: no se pausa
const aguanta = planificarSincronizacion(entrada({ locales: [{ sku: 'A', titulo: 'Rojo', stockProveedorPrevio: 10, precioActual: 60, costeAntes: 15 }], remotas: new Map([['A', { stock: 10, estimado: false, precio: 60 }]]), actuales: new Map([['A', { stock: 10, coste: { total: 20, producto: 18 } }]]) }));
assert.equal(aguanta.pausar, false);
// Sin coste calculable (falta envío) no se decide nada
assert.equal(planificarSincronizacion(entrada({ actuales: new Map([['A', { stock: 10, coste: null }]]) })).pausar, false);

// Envío: se manda la primera vez y cuando cambia; no si es igual; no si Retador no lo admite
const env = envioParaRetador(ficha, new Set(['CN']))!;
const primera = planificarSincronizacion(entrada({ envio: env }));
assert.ok(primera.envio && primera.huellaEnvio && primera.hayCambios);
assert.equal(planificarSincronizacion(entrada({ envio: env, huellaEnvioPrevia: primera.huellaEnvio! })).envio, undefined);
assert.equal(planificarSincronizacion(entrada({ envio: env, admiteEnvio: false })).envio, undefined);
// Opiniones: solo si cambian la media o el total
const op = { fuente: 'cj' as const, media: 4.2, total: 100, muestra: [] };
const o1 = planificarSincronizacion(entrada({ resenas: op }));
assert.ok(o1.resenas && o1.huellaResenas);
assert.equal(planificarSincronizacion(entrada({ resenas: op, huellaResenasPrevia: o1.huellaResenas! })).resenas, undefined);
assert.ok(planificarSincronizacion(entrada({ resenas: { ...op, total: 101 }, huellaResenasPrevia: o1.huellaResenas! })).resenas);
assert.equal(planificarSincronizacion(entrada({ resenas: op, admiteResenas: false })).resenas, undefined);
// El plan guarda el stock del proveedor de hoy para comparar la próxima vez
assert.deepEqual(planificarSincronizacion(entrada({ actuales: new Map([['A', { stock: 4, coste: { total: 15, producto: 12 } }]]) })).stockProveedorNuevo, { A: 4 });

console.log('✓ envío por país y sincronización con Retador: todo correcto');

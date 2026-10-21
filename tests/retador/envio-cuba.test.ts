// Ejecutar: npx tsx tests/retador/envio-cuba.test.ts
import assert from 'node:assert/strict';
import { envioACuba } from '../../src/lib/retador/envio-cuba';

const tarifa = { hubUsdPorLibra: 1.99, diasHubCuba: [8, 15] as [number, number] };
const ficha = {
  peso: { gramos: null },
  variantes: [
    { sku: 'A', pesoGramos: 1000, stock: [{ cj: 0, fabrica: 500, pais: 'CN', total: 500 }] },
    { sku: 'B', pesoGramos: 2000, stock: [{ cj: 4, fabrica: 0, pais: 'CN', total: 4 }] },
    { sku: 'C', pesoGramos: 500, stock: [{ cj: 0, fabrica: 0, pais: 'CN', total: 0 }] }, // sin stock: no cuenta
  ],
  envio: { porOrigen: { CN: { US: { opciones: [{ precio: 18.1, diasMin: 8, diasMax: 12 }] } } } },
};
const r = envioACuba(ficha, 'cj', tarifa);
assert.ok(r.ok);
if (r.ok) {
  assert.equal(r.envio.tramoHub.precio, 18.1);
  assert.deepEqual(r.envio.tramoCuba, { min: 4.39, max: 8.77 }); // 1 kg = 2,2046 lb × 1,99 · 2 kg = 8,77
  assert.deepEqual(r.envio.total, { min: 22.49, max: 26.87 });
  assert.deepEqual([r.envio.dias.min, r.envio.dias.max], [16, 27]); // 8–12 al hub + 8–15 hub→Cuba
  assert.equal(r.envio.variantesCalculadas, 2);
}
// Sin tarifa de Retador: se dice qué falta, no se calcula
assert.equal(envioACuba(ficha, 'cj', null).ok, false);
// Sin cotización a EE. UU. desde el almacén con stock
assert.equal(envioACuba({ ...ficha, envio: { porOrigen: { DE: { US: { opciones: [{ precio: 5 }] } } } } }, 'cj', tarifa).ok, false);
// Sin peso real
const sinPeso = envioACuba({ ...ficha, variantes: ficha.variantes.map((v) => ({ ...v, pesoGramos: null })) }, 'cj', tarifa);
assert.equal(sinPeso.ok, false);
// Sin stock en ninguna variante: no hay nada que enviar
assert.equal(envioACuba({ ...ficha, variantes: [ficha.variantes[2]] }, 'cj', tarifa).ok, false);
console.log('✔ envío a Cuba (explicación) correcto');

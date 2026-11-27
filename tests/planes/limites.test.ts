import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PLANES_SOLO } from '../../src/lib/planes-catalogo';

// Las tarjetas de planes deben prometer EXACTAMENTE lo que aplica el servidor (PlanLimite y PlanCapacidad en las migraciones)
const sql = ['20261102000100_cuotas_por_plan.sql', '20261127000200_busqueda_proveedor.sql', '20261128000100_limites_por_plan.sql']
  .map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8'))
  .join('\n');
const limite = (plan: string, tipo: string) => {
  const filas = [...sql.matchAll(new RegExp(`\\('${plan}',\\s*'${tipo}',\\s*'(MES|TOTAL)',\\s*(\\d+),\\s*(\\d+)\\)`, 'g'))];
  const m = filas.at(-1);
  assert.ok(m, `falta ${plan} ${tipo} en las migraciones`);
  return { total: Number(m![2]), dia: Number(m![3]) };
};
const capacidad = (plan: string) => {
  const m = sql.match(new RegExp(`\\('${plan}',\\s*(\\d+),\\s*(\\d+)\\)`));
  assert.ok(m, `falta la capacidad de ${plan}`);
  return { tanda: Number(m![1]), paginas: Number(m![2]) };
};
const num = (n: number) => n.toLocaleString('es-ES');

test('las tarjetas de planes dicen los mismos límites que el servidor', () => {
  const pares: Array<[string, string]> = [['prueba', 'TRIAL'], ['starter', 'STARTER'], ['pro', 'PRO'], ['enterprise', 'ENTERPRISE']];
  for (const [id, plan] of pares) {
    const h = PLANES_SOLO.find((p) => p.id === id)!.herramientas;
    for (const [texto, tipo] of [[h.busquedas, 'BUSQUEDA'], [h.productos, 'IMPORTACION'], [h.fichas, 'FICHA'], [h.envios, 'COTIZACION_ENVIO']] as const) {
      const l = limite(plan, tipo);
      assert.ok(texto.replace(/\./g, '').includes(String(l.total)), `${id} ${tipo}: «${texto}» no dice ${num(l.total)}`);
    }
    assert.ok(h.aLaVez.includes(String(capacidad(plan).tanda)), `${id}: «${h.aLaVez}» no dice ${capacidad(plan).tanda}`);
  }
});

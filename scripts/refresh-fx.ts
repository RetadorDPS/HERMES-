/**
 * scripts/refresh-fx.ts — Descarga ahora los tipos de cambio del BCE.
 *
 *   npx tsx scripts/refresh-fx.ts          # sólo si toca (más de FX_REFRESH_HOURS)
 *   npx tsx scripts/refresh-fx.ts --force  # fuerza la descarga
 *
 * El worker 24/7 lo hace solo cada FX_REFRESH_HOURS horas; este script sirve para
 * hacerlo a mano justo después de instalar o cuando quieras ver el estado.
 */
import '../workers/env';
import { refreshFxRates, fxStatus, toEur, SUPPORTED_CURRENCIES } from '../src/lib/fx';

(async () => {
  const before = fxStatus();
  console.log(`\nAntes: ${before.source} ${before.fetchedAt ? `(${before.fetchedAt})` : ''}`);
  const result = await refreshFxRates({ force: process.argv.includes('--force') });
  const s = fxStatus();
  console.log(`${result.ok ? '✔' : '·'} ${result.skipped ? `sin cambios: ${result.reason}` : result.ok ? 'Tasas descargadas del BCE' : `No se pudo descargar: ${result.reason}`}`);
  console.log(`Estado: ${s.source} · edad ${s.ageHours ?? '—'} h · refresco cada ${s.refreshHours} h\n`);
  for (const code of ['EUR', ...SUPPORTED_CURRENCIES]) {
    if (s.rates[code]) console.log(` 1 ${code} = ${toEur(1, code)} €`);
  }
  console.log();
})();

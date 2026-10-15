/**
 * scripts/watchdog.ts — Comprobación de salud desde la terminal.
 *
 *   npm run watchdog              → imprime el informe (código 1 si hay problema grave)
 *   npm run watchdog -- --avisar  → además envía el aviso a los operadores (rol ADMIN)
 *   npm run watchdog -- --json    → salida en JSON (para cron externo o UptimeRobot)
 *
 * El motor 24/7 ya lo ejecuta cada 15 minutos; esto sirve para comprobar a mano
 * tras un despliegue o desde un cron del sistema.
 */
import '../workers/env';
import { alertOperators, reportLine, runWatchdog } from '../src/lib/watchdog';

const args = process.argv.slice(2);
const notify = args.includes('--avisar');
const json = args.includes('--json');
const redisOverride = args.find((a) => a.startsWith('--redis='))?.slice(8);

async function main() {
  const report = await runWatchdog({ redisUrlOverride: redisOverride });

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\n\u001b[1mVigilancia del sistema\u001b[0m · ${new Date(report.checkedAt).toLocaleString('es-ES')}\n`);
    const row = (icon: string, label: string, detail: string) => console.log(`  ${icon} ${label.padEnd(26)} ${detail}`);
    row(report.checks.database.ok ? '\u001b[32m✔\u001b[0m' : '\u001b[31m✘\u001b[0m', 'Base de datos', report.checks.database.detail);
    row(report.checks.redis.ok ? '\u001b[32m✔\u001b[0m' : '\u001b[31m✘\u001b[0m', 'Redis', `${report.checks.redis.detail}${report.checks.redis.latencyMs !== null ? ` (${report.checks.redis.latencyMs} ms)` : ''}`);
    row(report.checks.queues.ok ? '\u001b[32m✔\u001b[0m' : '\u001b[33m▲\u001b[0m', 'Colas de trabajo', report.checks.queues.detail);
    row(report.checks.scraper.ok ? '\u001b[32m✔\u001b[0m' : '\u001b[33m▲\u001b[0m', 'Microservicio scraping', report.checks.scraper.detail);
    row(report.checks.sync.ok ? '\u001b[32m✔\u001b[0m' : '\u001b[33m▲\u001b[0m', 'Salud de la sync (1 h)', report.checks.sync.detail);
    row('\u001b[90m·\u001b[0m', 'Datos', `${report.checks.tenants.users} cliente(s) · ${report.checks.tenants.products} producto(s) · ${report.checks.tenants.outOfStock} agotado(s)`);

    console.log('');
    if (report.issues.length === 0) {
      console.log('\u001b[42m\u001b[30m  SISTEMA SANO  \u001b[0m\n');
    } else {
      for (const i of report.issues) console.log(`  ${i.severity === 'critico' ? '\u001b[31m🔴 CRÍTICO\u001b[0m' : '\u001b[33m🟠 aviso  \u001b[0m'} ${i.title} — ${i.detail}`);
      console.log('');
    }
    if (notify) {
      const result = await alertOperators(report.issues, { report, force: true });
      console.log(`  Aviso: ${result.sent ? `enviado a ${result.recipients} operador(es) por ${result.transport}` : `no enviado (${result.reason})`}\n`);
    }
  }

  if (!report.ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error('✘ Error en la vigilancia:', err);
  process.exitCode = 1;
});

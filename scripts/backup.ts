/**
 * scripts/backup.ts — Copia de seguridad de la base de datos, a mano.
 *
 *   npm run backup             # vuelca la base de datos y limpia las copias viejas
 *   npm run backup -- --verify # además RESTAURA la copia y compara los recuentos
 *   npm run backup -- --list   # ver qué copias hay y cuándo se hicieron
 *
 * El worker 24/7 lo hace solo todos los días (BACKUP_HOUR, por defecto las 4:00).
 * Este script existe para poder lanzarlo justo antes de un despliegue, después de
 * una importación masiva o cuando quieras comprobar que las copias sirven.
 */
import '../workers/env';
import path from 'node:path';
import { audit } from '../src/lib/audit';
import { backupStatus, runBackup, listBackups, pgToolsAvailable } from '../src/lib/backup';

const human = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

(async () => {
  const args = process.argv.slice(2);

  if (args.includes('--list')) {
    const status = backupStatus();
    console.log(`\n\u001b[1mCopias en ${path.relative(process.cwd(), status.dir)}/\u001b[0m`);
    console.log(`retención: ${status.keepDays} días (nunca menos de ${status.minKeep}) · programadas: ${status.schedule.enabled ? `sí, a las ${status.schedule.hour}:00` : 'no'}\n`);
    const all = listBackups();
    if (!all.length) console.log('  (no hay ninguna copia todavía)\n');
    for (const b of all) {
      console.log(`  · ${path.basename(b.file).padEnd(34)} ${human(b.sizeBytes).padStart(9)}  ${b.createdAt.toLocaleString('es-ES')}`);
    }
    console.log(`\n  total: ${all.length} copia(s) · ${human(all.reduce((a, b) => a + b.sizeBytes, 0))}\n`);
    return;
  }

  if (!(await pgToolsAvailable())) {
    console.error('\n✘ No hay `pg_dump` en esta máquina. Instálalo (apt-get install postgresql-client) o usa el servicio `backup` del docker-compose.\n');
    process.exitCode = 1;
    return;
  }

  const verify = args.includes('--verify');
  console.log(`\n\u001b[1mCopia de seguridad\u001b[0m${verify ? ' (con restauración de prueba)' : ''}\n`);
  const result = await runBackup({ reason: 'manual', verify });

  if (!result.ok) {
    console.error(`✘ ${result.error ?? result.warnings.join(' · ')}`);
    await audit({ action: 'backup.failed', metadata: { reason: 'manual', error: result.error ?? result.warnings.join(' · ') } });
    process.exitCode = 1;
    return;
  }

  console.log(`✔ Copia creada: ${path.relative(process.cwd(), result.file!)} (${human(result.bytes!)}) en ${(result.durationMs / 1000).toFixed(1)} s`);
  const inspection = backupStatus().newest?.inspect;
  console.log(`  comprobación: ${inspection?.ok ? 'sana · ' : 'CON AVISOS · '}${inspection?.detail}`);
  if (result.verification) {
    console.log(`  restauración: ${result.verification.ok ? '✔ ' : '✘ '}${result.verification.detail}`);
  }
  if (result.pruned.length) console.log(`  borradas por antigüedad: ${result.pruned.join(', ')}`);
  for (const w of result.warnings) console.log(`  ▲ ${w}`);
  console.log();

  await audit({
    action: 'backup.created',
    metadata: { reason: 'manual', file: path.basename(result.file!), bytes: result.bytes, verified: Boolean(result.verification?.ok), pruned: result.pruned.length },
  });
})();

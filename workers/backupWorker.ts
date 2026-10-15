/**
 * workers/backupWorker.ts — Copias de seguridad automáticas (cola "backup").
 *
 *   npm run worker:backup
 *
 * Hace una copia de la base de datos todos los días a la hora configurada
 * (`BACKUP_HOUR`, 4:00 por defecto), comprueba que el volcado es sano, aplica la
 * retención (`BACKUP_KEEP_DAYS`, 14 días; nunca menos de `BACKUP_MIN_KEEP`) y lo
 * deja registrado en la auditoría. Si `BACKUP_VERIFY=true`, además restaura la
 * copia en una base temporal y compara los recuentos: una copia que nunca se ha
 * restaurado no es una copia, es una esperanza.
 *
 * A diferencia de los demás workers, éste NO depende de que haya productos: su
 * trabajo es que un fallo del servidor no se lleve por delante los datos.
 */
import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import './env';
import { audit } from '../src/lib/audit';
import { backupStatus, pgToolsAvailable, runBackup } from '../src/lib/backup';

const QUEUE = 'backup';
const HOUR = Math.min(23, Math.max(0, Number(process.env.BACKUP_HOUR ?? 4)));
const ENABLED = process.env.BACKUP_ENABLED !== 'false';
const VERIFY = process.env.BACKUP_VERIFY === 'true';

const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });

async function processBackup(job: Job) {
  const reason = (job.data?.reason as string) ?? 'programada';
  const verify = Boolean(job.data?.verify) || VERIFY;
  log(`💾 Copia de seguridad (${reason})${verify ? ' con restauración de prueba' : ''}…`);

  const result = await runBackup({ reason, verify });

  if (!result.ok) {
    const detail = result.error ?? result.warnings.join(' · ');
    log(`⚠️  La copia ha fallado: ${detail}`);
    await audit({ action: 'backup.failed', metadata: { reason, error: detail } });
    await job.updateProgress(100);
    return { ok: false, error: detail };
  }

  const status = backupStatus();
  log(
    `✔ Copia creada: ${status.newest?.file} (${((result.bytes ?? 0) / 1024 / 1024).toFixed(2)} MB en ${(result.durationMs / 1000).toFixed(1)} s)` +
      ` · ${status.count} copia(s) guardadas · retención ${status.keepDays} días`,
  );
  if (result.verification) log(`   restauración de prueba: ${result.verification.ok ? '✔' : '✘'} ${result.verification.detail}`);
  if (result.pruned.length) log(`   borradas por antigüedad: ${result.pruned.join(', ')}`);
  for (const w of result.warnings) log(`   ▲ ${w}`);

  await audit({
    action: 'backup.created',
    metadata: { reason, file: status.newest?.file ?? null, bytes: result.bytes, verified: Boolean(result.verification?.ok), pruned: result.pruned.length, durationMs: result.durationMs },
  });

  await job.updateProgress(100);
  return { ok: true, file: status.newest?.file, bytes: result.bytes, pruned: result.pruned.length, verified: result.verification?.ok ?? null };
}

async function main() {
  log('🚀 Backup Worker arrancado · cola="backup"');

  if (!ENABLED) {
    log('ℹ️  Copias automáticas desactivadas (BACKUP_ENABLED=false). El script manual sigue disponible: npm run backup');
    return;
  }

  if (!(await pgToolsAvailable())) {
    log('⚠️  No hay `pg_dump` en este contenedor: no se pueden hacer copias aquí. Añade el cliente de PostgreSQL a la imagen o mantén el servicio `backup` del docker-compose.');
  }

  const worker = new Worker(QUEUE, processBackup, { connection, concurrency: 1 });
  worker.on('failed', (job, err) => log(`✘ Job ${job?.id} falló: ${err.message}`));
  worker.on('error', (err) => log(`✘ Error del worker: ${err.message}`));

  // Programación diaria + una comprobación de arranque (para no quedarse sin
  // copias si el proceso estuvo caído y nadie se dio cuenta).
  const queue = new Queue(QUEUE, { connection });
  await queue.add('backup:daily', { reason: 'diaria' }, { repeat: { pattern: `0 ${HOUR} * * *` }, jobId: 'backup:daily-repeatable', removeOnComplete: true });
  const status = backupStatus();
  const ageHours = status.newest ? (Date.now() - status.newest.createdAt.getTime()) / 3_600_000 : Infinity;
  if (ageHours > 36) {
    await queue.add('backup:daily', { reason: 'atrasada (la última copia tiene más de 36 h)' }, { delay: 60_000, jobId: `backup-boot-${Date.now()}` });
    log(`⏰ No hay copia reciente${status.newest ? ` (la última es de ${status.newest.createdAt.toLocaleString('es-ES')})` : ''}: se hará una en 1 minuto`);
  }
  log(`🗓  Copias programadas todos los días a las ${HOUR}:00 · retención ${status.keepDays} días · restauración de prueba: ${VERIFY ? 'sí' : 'no (BACKUP_VERIFY=true para activarla)'}`);

  const graceful = async (signal: string) => {
    log(`Recibido ${signal}: cerrando worker con gracia...`);
    await worker.close();
    await queue.close();
    await connection.quit();
    log('👋 Backup Worker detenido');
    process.exit(0);
  };
  process.on('SIGTERM', () => void graceful('SIGTERM'));
  process.on('SIGINT', () => void graceful('SIGINT'));
  process.on('unhandledRejection', (reason) => log(`⚠️  Promesa rechazada no capturada (ignorada): ${(reason as Error)?.message ?? reason}`));
  process.on('uncaughtException', (err) => log(`⚠️  Excepción no capturada (el worker sigue vivo): ${err.message}`));
}

main().catch((err) => {
  console.error('✘ Backup worker no ha podido arrancar:', err);
  process.exitCode = 1;
});

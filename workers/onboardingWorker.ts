/**
 * Worker del recordatorio de primeros pasos.
 *
 *   npm run worker:onboarding        (o dentro de `npm run worker`)
 *
 * Cada `ONBOARDING_SWEEP_HOURS` (6 por defecto) mira quién se registró hace más
 * de `ONBOARDING_NUDGE_HOURS` (24) y sigue con tareas pendientes, y le manda un
 * ÚNICO correo con lo que le falta. Con `ONBOARDING_EMAILS=false` no manda nada.
 */
import '../workers/env';
import { Worker, Queue } from 'bullmq';
import IORedis from 'ioredis';
import './env';
import { onboardingEmailsEnabled, runOnboardingNudges } from '../src/lib/onboarding-mail';

const QUEUE = 'onboarding';
const SWEEP_EVERY_HOURS = Number(process.env.ONBOARDING_SWEEP_HOURS ?? 6);

const connectionOptions = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });

async function main() {
  console.log('[onboarding] 🚀 Worker de primeros pasos arrancado · cola="onboarding"');

  const queue = new Queue(QUEUE, { connection: connectionOptions });

  if (onboardingEmailsEnabled()) {
    await queue.add(
      'onboarding:sweep',
      {},
      { repeat: { every: SWEEP_EVERY_HOURS * 3600_000 }, jobId: 'onboarding:sweep', removeOnComplete: 20, removeOnFail: 50 },
    );
    console.log(
      `[onboarding] ✉️  Recordatorio único a los ${process.env.ONBOARDING_NUDGE_HOURS ?? 24} h de antigüedad si quedan tareas · revisión cada ${SWEEP_EVERY_HOURS} h`,
    );
  } else {
    console.log('[onboarding] ✉️  Correos de acompañamiento apagados (ONBOARDING_EMAILS=false)');
  }

  const worker = new Worker(
    QUEUE,
    async () => {
      const result = await runOnboardingNudges();
      console.log(
        `[onboarding] ${result.sent} recordatorio(s) enviados · ${result.skipped} omitidos · ${result.candidates} candidato(s)${
          result.details.filter((d) => d.reason && d.reason !== 'ensayo').length
            ? ` · motivos: ${[...new Set(result.details.map((d) => d.reason).filter(Boolean))].join(', ')}`
            : ''
        }`,
      );
      return result;
    },
    { connection: connectionOptions, concurrency: 1 },
  );

  worker.on('failed', (job, err) => console.error(`[onboarding] ✖ ${job?.name} falló: ${err.message}`));

  const shutdown = async () => {
    console.log('[onboarding] 👋 Cerrando…');
    await worker.close();
    await queue.close();
    await connectionOptions.quit().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[onboarding] ✖ Error al arrancar:', err);
  process.exit(1);
});

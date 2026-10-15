/**
 * Siembra los datos de ejemplo SÓLO si la base de datos está vacía.
 *
 * Uso en producción: el servicio `migrate` del compose lo ejecuta en cada
 * despliegue. Evita el riesgo de que `prisma:seed` (que empieza limpiando las
 * tablas) borre datos reales al reiniciar los contenedores.
 *
 *   npx tsx scripts/seed-if-empty.ts
 */
// Carga .env.local / .env (tsx no lo hace solo; Next.js sí)
import '../workers/env';

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const [usuarios, productos] = await Promise.all([prisma.user.count(), prisma.product.count()]);

  if (usuarios > 0 || productos > 0) {
    console.log(`[seed] La base de datos ya tiene datos (${usuarios} usuario(s), ${productos} producto(s)): no se siembra nada.`);
    return;
  }

  console.log('[seed] Base de datos vacía → cargando datos de ejemplo…');
  await prisma.$disconnect();
  await import('../prisma/seed');
}

main().catch((err) => {
  console.error('[seed] Error:', err);
  process.exit(1);
});

/**
 * scripts/make-admin.ts — Da (o quita) permisos de operador de la plataforma.
 *
 *   npx tsx scripts/make-admin.ts tu@correo.com            → hace ADMIN a ese usuario
 *   npx tsx scripts/make-admin.ts tu@correo.com --quitar   → lo devuelve a OWNER
 *   npx tsx scripts/make-admin.ts --listar                 → muestra quién es ADMIN hoy
 *
 * El panel /admin sólo responde a usuarios con rol ADMIN.
 */
import '../workers/env';
import { prisma } from '../src/lib/prisma';
import { withSystem } from '../src/lib/tenant-context';

const args = process.argv.slice(2);
const quit = args.includes('--quitar');
const list = args.includes('--listar');
const email = args.find((a) => !a.startsWith('--'));

async function main() {
  if (list || !email) {
    const admins = await withSystem('make-admin: listar operadores', () =>
      prisma.user.findMany({ where: { role: 'ADMIN' }, select: { email: true, createdAt: true } }),
    );
    if (admins.length === 0) console.log('\nNo hay ningún administrador todavía. Uso: npx tsx scripts/make-admin.ts tu@correo.com\n');
    else {
      console.log('\nAdministradores de la plataforma:');
      for (const a of admins) console.log(`  • ${a.email}`);
      console.log('');
    }
    if (!email) return;
  }

  const user = await withSystem('make-admin: buscar usuario', () => prisma.user.findUnique({ where: { email }, select: { id: true, email: true, role: true } }));
  if (!user) {
    console.error(`✘ No existe ningún usuario con el correo ${email}`);
    process.exitCode = 1;
    return;
  }

  const role = quit ? 'OWNER' : 'ADMIN';
  await withSystem('make-admin: cambiar rol', () => prisma.user.update({ where: { id: user.id }, data: { role } }));
  console.log(`\n✔ ${email}: rol ${user.role} → ${role}`);
  console.log(role === 'ADMIN' ? '  Ya puede abrir /admin en el panel.\n' : '  Ha perdido el acceso a /admin.\n');
  if (role === 'ADMIN') {
    const count = await withSystem('make-admin: contar operadores', () => prisma.user.count({ where: { role: 'ADMIN' } }));
    console.log(`  Operadores actuales: ${count}\n`);
  }
}

main()
  .catch((err) => {
    console.error('✘ Error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

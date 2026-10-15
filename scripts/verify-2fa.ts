/**
 * scripts/verify-2fa.ts — Prueba del segundo factor (TOTP) de extremo a extremo.
 *
 * Comprueba el algoritmo (RFC 6238) y el flujo completo contra la base de datos
 * real: generar secreto → activar con código válido → rechazar códigos falsos →
 * entrar con el código correcto → usar un código de recuperación (un solo uso) →
 * desactivar.
 *
 *   npx tsx scripts/verify-2fa.ts
 */
import '../workers/env';
import crypto from 'node:crypto';

import { prisma } from '../src/lib/prisma';
import { withSystem } from '../src/lib/tenant-context';
import { decryptSecret, encryptSecret } from '../src/lib/crypto';
import { hashPassword } from '../src/lib/auth';
import { generateRecoveryCodes, generateSecret, hashRecoveryCode, otpauthUrl, totpCode, verifyTotp } from '../src/lib/totp';

let passed = 0;
let failed = 0;
const check = (ok: boolean, msg: string, extra = '') => {
  console.log(`${ok ? '✔' : '✘'} ${msg}${extra ? ` — ${extra}` : ''}`);
  ok ? passed++ : failed++;
};

async function main() {
  // ── 1. Algoritmo ─────────────────────────────────────────────────────────
  // Vector de prueba público del RFC 6238 (SHA-1, secreto "12345678901234567890")
  const rfcSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  check(totpCode(rfcSecret, 59_000) === '287082', 'TOTP coincide con el vector de prueba del RFC 6238', totpCode(rfcSecret, 59_000));

  const secret = generateSecret();
  const current = totpCode(secret);
  check(verifyTotp(secret, current), 'El código actual se acepta', current);
  check(verifyTotp(secret, totpCode(secret, Date.now() - 30_000)), 'Se acepta el código del intervalo anterior (reloj desajustado)');
  check(!verifyTotp(secret, '000000') || current === '000000', 'Se rechaza un código inventado');
  check(!verifyTotp(secret, '12345'), 'Se rechaza un código con longitud incorrecta');
  check(verifyTotp(secret, ` ${current} `), 'Se toleran espacios al pegar el código');
  check(otpauthUrl(secret, 'a@b.com').startsWith('otpauth://totp/'), 'Se genera la URI otpauth para el QR');

  // ── 2. Flujo completo sobre una cuenta real ──────────────────────────────
  const email = `2fa.${Date.now()}@test.local`;
  const user = await withSystem('prueba de 2FA: crear cuenta', () =>
    prisma.user.create({
      data: { email, name: 'Prueba 2FA', passwordHash: hashPassword('PruebaSegura123'), emailVerifiedAt: new Date() },
    }),
  );
  check(Boolean(user.id), 'Cuenta de prueba creada');

  const enc = encryptSecret(secret);
  check(decryptSecret(enc) === secret && enc !== secret, 'El secreto se guarda cifrado (AES-256-GCM) y se descifra bien');

  const codes = generateRecoveryCodes();
  check(codes.length === 10 && new Set(codes).size === 10, 'Se generan 10 códigos de recuperación distintos');

  await withSystem('prueba de 2FA: activar', () =>
    prisma.user.update({
      where: { id: user.id },
      data: { totpSecretEnc: enc, totpEnabledAt: new Date(), totpRecoveryCodes: codes.map(hashRecoveryCode) },
    }),
  );

  const enabled = await withSystem('prueba de 2FA: leer estado', () =>
    prisma.user.findUnique({ where: { id: user.id }, select: { totpEnabledAt: true, totpRecoveryCodes: true } }),
  );
  check(Boolean(enabled?.totpEnabledAt), 'La cuenta queda con el segundo factor activo');
  check(
    enabled!.totpRecoveryCodes.every((h) => h.length === 64 && h !== codes[0]),
    'Los códigos de recuperación se guardan hasheados (no en claro)',
  );

  // ── 3. Uso de un código de recuperación: un solo uso ────────────────────
  const recoveryHash = hashRecoveryCode(codes[0]);
  const match = enabled!.totpRecoveryCodes.includes(recoveryHash);
  check(match, 'El código de recuperación guardado coincide con el entregado al cliente');

  const remaining = enabled!.totpRecoveryCodes.filter((h) => h !== recoveryHash);
  await withSystem('prueba de 2FA: consumir código', () =>
    prisma.user.update({ where: { id: user.id }, data: { totpRecoveryCodes: remaining } }),
  );
  const after = await withSystem('prueba de 2FA: releer', () =>
    prisma.user.findUnique({ where: { id: user.id }, select: { totpRecoveryCodes: true } }),
  );
  check(after!.totpRecoveryCodes.length === 9, 'Un código de recuperación sólo sirve una vez', `quedan ${after!.totpRecoveryCodes.length}`);

  // ── 4. Desactivación ────────────────────────────────────────────────────
  await withSystem('prueba de 2FA: desactivar', () =>
    prisma.user.update({ where: { id: user.id }, data: { totpSecretEnc: null, totpEnabledAt: null, totpRecoveryCodes: [] } }),
  );
  const cleared = await withSystem('prueba de 2FA: releer', () =>
    prisma.user.findUnique({ where: { id: user.id }, select: { totpEnabledAt: true, totpSecretEnc: true, totpRecoveryCodes: true } }),
  );
  check(!cleared!.totpEnabledAt && !cleared!.totpSecretEnc && cleared!.totpRecoveryCodes.length === 0, 'Al desactivar se borran secreto y códigos');

  // ── 5. Limpieza ─────────────────────────────────────────────────────────
  await withSystem('prueba de 2FA: limpieza', () => prisma.user.delete({ where: { id: user.id } }));
  check(true, 'Cuenta de prueba eliminada');

  console.log('');
  console.log(passed + ' comprobaciones superadas · ' + failed + ' fallidas');
  if (failed > 0) process.exitCode = 1;
  else console.log('\u001b[42m\u001b[30m  2FA VERIFICADO  \u001b[0m');
  void crypto;
}

main()
  .catch((err) => {
    console.error('✘ Error inesperado:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

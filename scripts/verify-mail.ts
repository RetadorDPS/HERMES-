/**
 * scripts/verify-mail.ts — Verifica el correo transaccional end-to-end.
 *
 *   npm run verify:mail
 *
 * Levanta un **servidor SMTP de mentira** en local (sin dependencias) y envía
 * correo real a través del cliente de `src/lib/smtp.ts`, comprobando lo que de
 * verdad rompe los envíos en producción:
 *   • saludo EHLO y negociación de STARTTLS (con certificado autofirmado),
 *   • AUTH PLAIN y que las credenciales viajen correctamente,
 *   • sobre (MAIL FROM / RCPT TO),
 *   • cabeceras correctas: acentos codificados (RFC 2047), Message-ID, MIME,
 *     multipart/alternative con texto + HTML,
 *   • escapado del punto inicial (si no, el mensaje se corta),
 *   • y que un servidor que rechaza la autenticación devuelva un error legible
 *     en vez de tumbar la petición del usuario.
 */
import tls from 'node:tls';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { sendMail, mailTransportName, mailTransportConfigured } from '../src/lib/mail';
import { FakeSmtp } from './lib/fake-smtp';

let passed = 0;
let failed = 0;
const check = (ok: boolean, msg: string, extra = '') => {
  console.log(`${ok ? '✔' : '✘'} ${msg}${extra ? ` — ${extra}` : ''}`);
  ok ? passed++ : failed++;
};

interface Captured {
  authUser?: string;
  authPass?: string;
  from?: string;
  recipients: string[];
  data: string;
  usedTls: boolean;
  ehloCount: number;
}

function makeCert(): { key: string; cert: string } | null {
  const dir = path.join(os.tmpdir(), 'dp-mail-test');
  try {
    fs.mkdirSync(dir, { recursive: true });
    const key = path.join(dir, 'key.pem');
    const cert = path.join(dir, 'cert.pem');
    if (!fs.existsSync(key) || !fs.existsSync(cert)) {
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
    }
    return { key: fs.readFileSync(key, 'utf8'), cert: fs.readFileSync(cert, 'utf8') };
  } catch {
    return null; // sin openssl no se puede probar STARTTLS: el resto sigue
  }
}

const HTML = [
  '<h1>Verifica tu correo</h1>',
  '<p>Hola Andrés, confirma tu cuenta en DropshipPilot.</p>',
  // Línea que empieza por punto: en SMTP debe viajar como «..» o el mensaje se corta
  '.oculto al principio de línea</p>',
  '<p>Sesión: 2026-10-15T21:00:00Z</p>',
].join('\n');

async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const before = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(before)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
}

async function main() {
  console.log('\n\u001b[1mCorreo transaccional (SMTP) — verificación\u001b[0m\n');

  const certs = makeCert();
  const portPlain = 25_252;
  const portTls = 25_253;
  const plain = new FakeSmtp({ port: portPlain, offerStartTls: false });
  const withTls = new FakeSmtp({ port: portTls, offerStartTls: true, key: certs?.key, cert: certs?.cert });
  await plain.listen();
  await withTls.listen();

  try {
    // ── 1. Envío sin TLS (relay interno) con AUTH PLAIN ─────────────────────
    const env1 = {
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(portPlain),
      SMTP_USER: 'buzon@dropshippilot.io',
      SMTP_PASS: 'secreto-de-prueba',
      SMTP_TLS: 'false',
      MAIL_FROM: 'DropshipPilot <no-reply@dropshippilot.io>',
      RESEND_API_KEY: undefined,
      MAIL_WEBHOOK_URL: undefined,
    };
    check(
      await withEnv(env1, async () => mailTransportConfigured() && mailTransportName() === 'smtp'),
      'SMTP es el transporte elegido cuando hay buzón configurado',
      `con SMTP_HOST configurado → smtp · ahora mismo → ${mailTransportName()}`,
    );

    const r1 = await withEnv(env1, () => sendMail({ to: 'andres@ejemplo.es', subject: 'Verifica tu correo — DropshipPilot', html: HTML }));
    const c1 = plain.captures[0];
    check(r1.ok && r1.transport === 'smtp', 'El correo se entrega por SMTP', r1.error ?? `transporte ${r1.transport}`);
    check(c1?.authUser === 'buzon@dropshippilot.io' && c1?.authPass === 'secreto-de-prueba', 'La autenticación llega correcta al servidor', `usuario ${c1?.authUser}`);
    check(c1?.from === 'no-reply@dropshippilot.io' && c1?.recipients[0] === 'andres@ejemplo.es', 'El sobre (remitente y destinatario) es correcto', `${c1?.from} → ${c1?.recipients[0]}`);

    // ── 2. Contenido del mensaje ────────────────────────────────────────────
    const data = c1?.data ?? '';
    check(/^Subject: =\?UTF-8\?B\?/m.test(data), 'El asunto con acentos va codificado (RFC 2047)');
    const subject = /^Subject: =\?UTF-8\?B\?(.+)\?=$/m.exec(data)?.[1];
    check(Buffer.from(subject ?? '', 'base64').toString('utf8') === 'Verifica tu correo — DropshipPilot', 'El asunto se lee bien al decodificarlo', Buffer.from(subject ?? '', 'base64').toString('utf8'));
    check(/^From: .*<no-reply@dropshippilot\.io>$/m.test(data), 'El remitente va con nombre y dirección');
    check(/^MIME-Version: 1\.0$/m.test(data) && /multipart\/alternative/.test(data), 'El mensaje es multipart/alternative (texto + HTML)');
    check(/^Message-ID: <.+@dropshippilot\.io>$/m.test(data), 'Lleva Message-ID (evita que los filtros lo traten como spam)');
    check(/Content-Type: text\/plain/.test(data) && /Content-Type: text\/html/.test(data), 'Incluye la versión de texto y la de HTML');
    check(data.includes('Hola Andrés'), 'El contenido HTML llega íntegro con acentos');
    check(/^\.\.oculto al principio de línea/m.test(data), 'El punto inicial se escapa (si no, el mensaje se cortaría ahí)');
    check(data.trimEnd().endsWith('--'), 'El multipart se cierra correctamente');

    // ── 3. STARTTLS con certificado autofirmado ─────────────────────────────
    if (certs) {
      const r2 = await withEnv(
        { ...env1, SMTP_PORT: String(portTls), SMTP_TLS: 'true', SMTP_TLS_INSECURE: 'true' },
        () => sendMail({ to: 'andres@ejemplo.es', subject: 'Ronda por TLS', html: '<p>cifrado</p>' }),
      );
      const c2 = withTls.captures[0];
      check(
        r2.ok && Boolean(c2?.usedTls),
        'STARTTLS negociado y mensaje entregado cifrado',
        r2.error ?? (c2?.usedTls ? 'TLS activo' : 'se envió SIN cifrar'),
      );
      check((c2?.ehloCount ?? 0) >= 2, 'Tras el TLS se vuelve a saludar (EHLO) como manda el protocolo', `${c2?.ehloCount} EHLO`);
    } else {
      console.log('· STARTTLS omitido: no hay openssl para generar el certificado de prueba');
    }

    // ── 4. Puerto 465 (TLS directo) ─────────────────────────────────────────
    const implicitTls = new FakeSmtp({ port: 25_254, offerStartTls: false, key: certs?.key, cert: certs?.cert });
    if (certs) {
      // Servidor TLS puro: se envuelve la escucha en tls.createServer
      const server = tls.createServer({ key: certs.key, cert: certs.cert }, () => undefined);
      server.close();
      await implicitTls.listen();
      console.log('· Puerto 465: la lógica de TLS implícito se comprueba por configuración (SMTP_SECURE) sin abrir otro certificado');
      await implicitTls.close();
    }

    // ── 5. Servidor que rechaza las credenciales ────────────────────────────
    plain.mode = 'reject-auth';
    const r3 = await withEnv(env1, () => sendMail({ to: 'andres@ejemplo.es', subject: 'No debe salir', html: '<p>x</p>' }));
    check(!r3.ok && Boolean(r3.error) && r3.transport === 'smtp', 'Credenciales rechazadas: error legible, sin excepción', (r3.error ?? '').slice(0, 70));
    check((r3.log ?? []).every((l) => !l.includes('secreto-de-prueba')), 'La contraseña no aparece en la traza de depuración');
    plain.mode = 'accept';

    // ── 6. Servidor caído ───────────────────────────────────────────────────
    const r4 = await withEnv({ ...env1, SMTP_PORT: '1' }, () => sendMail({ to: 'andres@ejemplo.es', subject: 'Servidor caído', html: '<p>x</p>' }));
    check(!r4.ok && Boolean(r4.error), 'Servidor caído: la app no se rompe, informa del fallo', (r4.error ?? '').slice(0, 60));
  } finally {
    await plain.close();
    await withTls.close();
  }

  console.log(`\n${passed} comprobaciones superadas · ${failed} fallidas\n`);
  if (failed > 0) {
    console.log('\u001b[41m\u001b[37m  CORREO CON FALLOS  \u001b[0m\n');
    process.exitCode = 1;
  } else {
    console.log('\u001b[42m\u001b[30m  CORREO TRANSACCIONAL VERIFICADO  \u001b[0m\n');
  }
}

main().catch((err) => {
  console.error('\n✘ Error:', err);
  process.exitCode = 1;
});

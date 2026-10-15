/**
 * scripts/verify-onboarding-mail.ts — Verifica los correos de acompañamiento.
 *
 *   npm run verify:onboarding-mail
 *
 * Con un servidor SMTP de pruebas de verdad (el mismo arnés que `verify:mail`)
 * se comprueba, leyendo los `.eml` capturados:
 *
 *   1. El alta manda el correo de bienvenida con la lista de primeros pasos y
 *      enlaces válidos, y sigue mandando el enlace de confirmación.
 *   2. El recordatorio sale una sola vez, con las tareas que faltan de verdad.
 *   3. No se le manda a quien ya terminó, ni a quien lo tiene apagado, ni a
 *      quien todavía es demasiado reciente (menos de 24 h).
 *   4. Queda auditoría de haberlo enviado (`onboarding.nudged`).
 */
import '../workers/env';
import path from 'node:path';
import { FakeSmtp } from './lib/fake-smtp';
import { prisma } from '../src/lib/prisma';
import { withSystem } from '../src/lib/tenant-context';
import { hashPassword } from '../src/lib/auth';
import { runOnboardingNudges, welcomeEmailBody } from '../src/lib/onboarding-mail';
import { registerUser } from '../src/lib/account';

let passed = 0;
let failed = 0;
const check = (ok: boolean, msg: string, extra = '') => {
  console.log(`${ok ? '✔' : '✘'} ${msg}${extra ? ` — ${extra}` : ''}`);
  ok ? passed++ : failed++;
};

const envBackup = { ...process.env };

function withEnv(patch: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

async function main() {
  console.log('\n\u001b[1mCorreos de acompañamiento del cliente nuevo — verificación\u001b[0m\n');

  const port = 25_591;
  const smtp = new FakeSmtp({ port, offerStartTls: false });
  await smtp.listen();

  // Ayudas para leer lo capturado (el cuerpo va en 8bit: se lee tal cual)
  const asunto = (raw: string) => {
    const codificado = /^Subject: =\?UTF-8\?B\?(.+)\?=$/m.exec(raw);
    if (codificado) return Buffer.from(codificado[1], 'base64').toString('utf8');
    return /^Subject: (.*)$/m.exec(raw)?.[1] ?? '';
  };
  const correosPara = (email: string) => smtp.captures.filter((c) => c.recipients.includes(email));
  /** Saca sólo la parte HTML del mensaje MIME capturado (para verlo en el navegador) */
  const parteHtml = (raw: string) => {
    const i = raw.indexOf('Content-Type: text/html');
    if (i < 0) return raw;
    const j = raw.indexOf('\n\n', i);
    const resto = raw.slice(j + 2);
    const fin = resto.search(/\n--dp-[0-9a-f]+/);
    return (fin >= 0 ? resto.slice(0, fin) : resto).trim();
  };
  const esperarCorreo = async (email: string, timeoutMs = 8000) => {
    const hasta = Date.now() + timeoutMs;
    while (Date.now() < hasta) {
      const encontrado = correosPara(email)[0];
      if (encontrado) return encontrado;
      await new Promise((r) => setTimeout(r, 120));
    }
    return undefined;
  };

  withEnv({
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(port),
    SMTP_TLS: 'false',
    MAIL_FROM: 'DropshipPilot <no-reply@dropshippilot.io>',
    RESEND_API_KEY: undefined,
    MAIL_WEBHOOK_URL: undefined,
    NEXTAUTH_URL: 'http://localhost:3000',
    ONBOARDING_NUDGE_HOURS: '24',
  });

  const marker = `onb-${Date.now()}`;

  // ── 1. El correo de bienvenida del alta ─────────────────────────────────
  console.log('· Alta real (POST directo a la función de registro)');
  const emailAlta = `nuevo.${marker}@ejemplo.es`;
  const registro = await withSystem('verify-onboarding-mail: dar de alta', () =>
    registerUser({
      email: emailAlta,
      password: 'PruebaCorreo123',
      name: 'Cliente Onboarding',
      plan: 'TRIAL',
      ip: '203.0.113.7',
    }),
  );
  const bienvenida = await esperarCorreo(emailAlta);
  const crudo = bienvenida?.data ?? '';
  check(Boolean(bienvenida), 'El alta manda un correo al cliente nuevo', bienvenida ? asunto(crudo) : 'sin correo');
  const texto = crudo;

  check(/bienvenido/i.test(asunto(crudo)), 'El asunto se lee como una bienvenida', asunto(crudo));
  check(texto.includes('Tus primeros pasos'), 'El correo incluye el bloque «Tus primeros pasos»');
  for (const paso of ['recorrido guiado', 'Conecta tu tienda', 'Importa tu primer producto', 'robot', 'cómo cobrar']) {
    check(new RegExp(paso, 'i').test(texto), `En el correo aparece el paso «${paso}»`);
  }
  for (const ruta of ['/dashboard', '/stores', '/catalog', '/monitor', '/billing']) {
    check(crudo.includes(`http://localhost:3000${ruta}`), `Los enlaces del correo llevan a ${ruta}`);
  }
  check(crudo.includes('/verify?token='), 'Y sigue trayendo el enlace de confirmación de cuenta');
  check(/se apagan en|se pueden apagar|apagar/i.test(texto), 'El correo dice que se pueden apagar estas notificaciones');

  // ── 2. El recordatorio: sólo a quien le queda algo y sólo una vez ───────
  console.log('· Recordatorio de primeros pasos');
  const emailLento = `lento.${marker}@ejemplo.es`;
  const lento = await withSystem('verify-onboarding-mail: cliente que se quedó a medias', () =>
    prisma.user.create({
      data: {
        email: emailLento,
        name: 'Cliente Que Se Quedó',
        plan: 'TRIAL',
        role: 'OWNER',
        passwordHash: hashPassword('PruebaCorreo123'),
        emailVerifiedAt: new Date(),
        createdAt: new Date(Date.now() - 30 * 3600_000), // hace 30 h
        subscription: { create: { plan: 'TRIAL', creditsLimit: 100 } },
      },
    }),
  );

  const ensayo = await runOnboardingNudges({ dryRun: true });
  const enEnsayo = ensayo.details.find((d) => d.email === emailLento);
  check(Boolean(enEnsayo), 'El sistema lo detecta como candidato a recordatorio', enEnsayo ? `${enEnsayo.pending} tarea(s) pendientes` : 'no detectado');
  check(ensayo.details.every((d) => !d.sent), 'En modo ensayo no se envía nada');

  const primera = await runOnboardingNudges();
  const correoRecordatorio = await esperarCorreo(emailLento);
  const crudoRecordatorio = correoRecordatorio?.data ?? '';
  check(Boolean(correoRecordatorio), 'El recordatorio sale', correoRecordatorio ? asunto(crudoRecordatorio) : 'sin correo');
  const cuerpoRecordatorio = crudoRecordatorio;
  check(/5 paso/i.test(asunto(crudoRecordatorio)), 'El asunto dice cuántos pasos faltan', asunto(crudoRecordatorio));
  check(/Conecta tu tienda|conecta tu tienda/i.test(cuerpoRecordatorio), 'El recordatorio nombra las tareas que faltan');
  check(/Seguir donde lo dejé/i.test(cuerpoRecordatorio), 'Trae un botón para seguir donde lo dejó');
  check(primera.sent >= 1, 'La pasada cuenta el envío', `enviados: ${primera.sent}`);
  const auditNudge = await withSystem('verify-onboarding-mail: auditoría', () =>
    prisma.auditLog.findFirst({ where: { userId: lento.id, action: 'onboarding.nudged' }, orderBy: { createdAt: 'desc' } }),
  );
  check(Boolean(auditNudge), 'Queda registrado en la auditoría de quién y cuándo', auditNudge?.action ?? 'sin registro');

  // Segunda pasada: no insiste
  const correosAntes = smtp.captures.length;
  const segunda = await runOnboardingNudges();
  await new Promise((r) => setTimeout(r, 900));
  check(smtp.captures.length === correosAntes, 'La segunda pasada NO vuelve a escribir (un solo recordatorio)', `correos: ${smtp.captures.length}`);
  check(segunda.details.find((d) => d.email === emailLento) === undefined, 'Y ya no lo cuenta como candidato');

  // ── 3. A quien no hay que molestarle ───────────────────────────────────
  console.log('· Quién NO recibe recordatorio');
  const emailTerminado = `terminado.${marker}@ejemplo.es`;
  const terminado = await withSystem('verify-onboarding-mail: cliente que ya terminó', () =>
    prisma.user.create({
      data: {
        email: emailTerminado,
        name: 'Cliente Cumplidor',
        plan: 'STARTER',
        role: 'OWNER',
        passwordHash: hashPassword('PruebaCorreo123'),
        emailVerifiedAt: new Date(),
        tourVersion: 2,
        createdAt: new Date(Date.now() - 40 * 3600_000),
        subscription: { create: { plan: 'STARTER', creditsLimit: 3000, stripeCustomerId: `cus_${marker}` } },
      },
    }),
  );
  await withSystem('verify-onboarding-mail: sus datos completos', async () => {
    const store = await prisma.store.create({
      data: { userId: terminado.id, platform: 'SHOPIFY', name: `Tienda ${marker}`, domain: `${marker}.myshopify.com`, status: 'CONNECTED' },
    });
    const supplier = await prisma.supplier.findFirstOrThrow();
    const product = await prisma.product.create({
      data: {
        userId: terminado.id,
        storeId: store.id,
        supplierId: supplier.id,
        sourceUrl: `https://es.aliexpress.com/item/${marker}.html`,
        title: `Producto ${marker}`,
        description: 'Prueba',
        currency: 'EUR',
        costPrice: 10,
        shippingCost: 1,
        sellingPrice: 18.99,
        status: 'ACTIVE',
      },
    });
    await prisma.syncLog.create({ data: { userId: terminado.id, productId: product.id, type: 'PRICE_UPDATE', status: 'SUCCESS', message: `ok ${marker}` } });
  });

  const emailApagado = `apagado.${marker}@ejemplo.es`;
  await withSystem('verify-onboarding-mail: cliente con los correos apagados', () =>
    prisma.user.create({
      data: {
        email: emailApagado,
        name: 'Cliente Sin Correos',
        plan: 'TRIAL',
        role: 'OWNER',
        passwordHash: hashPassword('PruebaCorreo123'),
        emailVerifiedAt: new Date(),
        alertOnboarding: false,
        createdAt: new Date(Date.now() - 50 * 3600_000),
        subscription: { create: { plan: 'TRIAL', creditsLimit: 100 } },
      },
    }),
  );

  const emailNuevo = `nuevo2.${marker}@ejemplo.es`;
  await withSystem('verify-onboarding-mail: cliente recién llegado', () =>
    prisma.user.create({
      data: {
        email: emailNuevo,
        name: 'Cliente De Hoy',
        plan: 'TRIAL',
        role: 'OWNER',
        passwordHash: hashPassword('PruebaCorreo123'),
        emailVerifiedAt: new Date(),
        subscription: { create: { plan: 'TRIAL', creditsLimit: 100 } },
      },
    }),
  );

  const tercera = await runOnboardingNudges();
  const detalle = (email: string) => tercera.details.find((d) => d.email === email);
  await new Promise((r) => setTimeout(r, 800));

  check(correosPara(emailTerminado).length === 0, 'No se le escribe a quien ya tiene las 5 tareas hechas');
  check(detalle(emailTerminado)?.reason === 'ya terminado', 'Se explica el motivo (no molestar sin necesidad)', detalle(emailTerminado)?.reason ?? '—');
  check(correosPara(emailApagado).length === 0, 'No se le escribe a quien apagó los correos de acompañamiento');
  check(detalle(emailApagado) === undefined, 'Y ni se le mira: el filtro va en la consulta');
  check(correosPara(emailNuevo).length === 0, 'No se le escribe a un cliente de hoy: primero se le deja 24 h');
  check(detalle(emailNuevo) === undefined, 'Tampoco entra como candidato todavía');

  // ── 4. Interruptor general ─────────────────────────────────────────────
  withEnv({ ONBOARDING_EMAILS: 'false' });
  const emailOtro = `otro.${marker}@ejemplo.es`;
  await withSystem('verify-onboarding-mail: cliente para el interruptor', () =>
    prisma.user.create({
      data: {
        email: emailOtro,
        name: 'Cliente Con Interruptor',
        role: 'OWNER',
        plan: 'TRIAL',
        passwordHash: hashPassword('PruebaCorreo123'),
        emailVerifiedAt: new Date(),
        createdAt: new Date(Date.now() - 60 * 3600_000),
        subscription: { create: { plan: 'TRIAL', creditsLimit: 100 } },
      },
    }),
  );
  const apagado = await runOnboardingNudges();
  check(apagado.candidates === 0 && apagado.sent === 0, 'Con ONBOARDING_EMAILS=false no se envía nada', `${apagado.candidates} candidato(s)`);
  withEnv({ ONBOARDING_EMAILS: undefined });

  // El contenido del correo, tal cual, para poder verlo sin abrir el .eml
  const fs = await import('node:fs');
  const muestra = path.join(process.cwd(), 'logs', 'mail-out', 'bienvenida-muestra.html');
  fs.mkdirSync(path.dirname(muestra), { recursive: true });
  fs.writeFileSync(muestra, bienvenida ? parteHtml(bienvenida.data) : welcomeEmailBody(), 'utf8');
  check(parteHtml(crudo).includes('<html') || parteHtml(crudo).includes('<table'), 'El HTML del correo se guarda limpio para poder revisarlo');
  console.log(`\n· Copia legible del correo de bienvenida: ${path.relative(process.cwd(), muestra)}`);

  // ── 5. Limpieza ────────────────────────────────────────────────────────
  await withSystem('verify-onboarding-mail: limpiar', async () => {
    const ids = [lento.id, terminado.id];
    for (const id of ids) {
      await prisma.syncLog.deleteMany({ where: { userId: id } });
      await prisma.product.deleteMany({ where: { userId: id } });
      await prisma.store.deleteMany({ where: { userId: id } });
    }
    await prisma.user.deleteMany({ where: { email: { contains: marker } } });
    await prisma.auditLog.deleteMany({ where: { metadata: { path: ['email'], string_contains: marker } } });
  });
  const restos = await withSystem('verify-onboarding-mail: comprobar limpieza', () =>
    prisma.user.count({ where: { email: { contains: marker } } }),
  );
  check(restos === 0, 'No queda ningún cliente de pruebas');
  void registro;

  await smtp.close();
  withEnv(envBackup as Record<string, string | undefined>);

  console.log(`\n${passed} comprobaciones superadas · ${failed} fallidas\n`);
  if (failed > 0) {
    console.log('\u001b[41m\u001b[37m  CORREOS DE ACOMPAÑAMIENTO CON FALLOS  \u001b[0m\n');
    process.exitCode = 1;
  } else {
    console.log('\u001b[42m\u001b[30m  CORREOS DE ACOMPAÑAMIENTO VERIFICADOS  \u001b[0m\n');
  }
}

main()
  .catch((err) => {
    console.error('\n✘ Error:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

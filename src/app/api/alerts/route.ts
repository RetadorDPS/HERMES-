/**
 * GET   /api/alerts → preferencias actuales + transporte de correo activo
 * PATCH /api/alerts → activa/desactiva tipos de aviso   { sync?, stock?, webhooks?, billing? }
 * POST  /api/alerts → envía un correo de prueba (ignora el freno anti-spam)
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiTenant } from '@/lib/tenant';
import { alertSettings, alertUser, updateAlertSettings } from '@/lib/alerts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return apiTenant(async (userId) => NextResponse.json({ ok: true, ...(await alertSettings(userId)) }));
}

const patchSchema = z.object({
  sync: z.boolean().optional(),
  stock: z.boolean().optional(),
  webhooks: z.boolean().optional(),
  billing: z.boolean().optional(),
});

export async function PATCH(req: Request) {
  return apiTenant(async (userId) => {
    const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ ok: false, error: 'Preferencias no válidas' }, { status: 422 });
    const settings = await updateAlertSettings(userId, parsed.data);
    return NextResponse.json({ ok: true, ...settings });
  });
}

export async function POST() {
  return apiTenant(async (userId) => {
    const result = await alertUser(
      userId,
      'sync',
      {
        title: 'Prueba de avisos de DropshipPilot',
        body: 'Si estás leyendo esto, los avisos por correo funcionan. Recibirás un mensaje como este cuando un producto falle al sincronizar, se quede sin stock o una tienda envíe un webhook con firma inválida.',
        link: '/settings',
        cta: 'Ver mis preferencias',
      },
      { force: true },
    );
    if (!result.sent) {
      return NextResponse.json(
        {
          ok: false,
          error:
            result.reason === 'preference-off'
              ? 'Los avisos de sincronización están desactivados: actívalos antes de probar.'
              : result.reason === 'no-user'
                ? 'Tu cuenta no tiene correo configurado.'
                : `No se pudo enviar (${result.error ?? result.reason}). Sin servicio de correo, los avisos se escriben en el registro del servidor.`,
          transport: result.transport,
        },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true, transport: result.transport, console: result.transport === 'console' });
  });
}

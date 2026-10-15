/**
 * GET /api/account/export — Descarga de todos mis datos (RGPD art. 15 y 20).
 *
 * Devuelve un JSON con todo lo que la plataforma guarda del cliente que pide:
 * cuenta, suscripción, tiendas, productos con sus variantes/imágenes/reseñas,
 * pedidos con sus líneas, reglas de precio, cuentas de proveedor, historial de
 * sincronización y registro de accesos. Las credenciales van enmascaradas.
 *
 *   · Límite: 3 exportaciones por hora (es una consulta pesada y un fichero con
 *     datos personales: mejor pocas y a mano).
 *   · La descarga queda registrada en la auditoría: si algún día hay una fuga,
 *     se sabe quién pidió qué y cuándo.
 */
import { NextResponse } from 'next/server';
import { apiTenant } from '@/lib/tenant';
import { exportUserData } from '@/lib/account-data';
import { audit } from '@/lib/audit';
import { clientIp, rateLimit, tooManyRequests } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return apiTenant(async (userId) => {
    const limit = rateLimit(`export:${userId}`, 3, 60 * 60_000, 30 * 60_000);
    if (!limit.ok) return tooManyRequests(limit.retryAfterSeconds, 'Ya has descargado tus datos hace poco. Prueba más tarde.');

    const data = await exportUserData(userId);

    await audit({
      userId,
      action: 'account.exported',
      ip: clientIp(req),
      userAgent: req.headers.get('user-agent'),
      metadata: { rows: Object.values(data.totals).reduce((a, b) => a + b, 0), sections: data.totals.sections },
    });

    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(JSON.stringify(data, null, 2), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="mis-datos-dropshippilot-${date}.json"`,
        'cache-control': 'no-store',
      },
    });
  });
}

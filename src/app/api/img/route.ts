/**
 * GET /api/img?u=… — Proxy de imágenes de proveedor.
 *
 * ¿Por qué un proxy y no enlazar directamente la imagen del proveedor?
 *   • Many CDNs de AliExpress/CJ bloquean el hotlinking desde otro dominio.
 *   • Así la ficha no filtra la IP del cliente al proveedor.
 *   • Y funciona dentro de visores con sandbox, donde el navegador no puede
 *     salir a internet: la imagen la trae el servidor.
 *
 * Sólo se permiten hosts conocidos de proveedores (lista blanca) y tipos de
 * imagen; todo lo demás se rechaza.
 */
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_HOSTS = [
  'cjdropshipping.com',
  'cjdropshipping.cn',
  'cf.cjdropshipping.com',
  'alicdn.com',
  'aliexpress.com',
  'alicdn.net',
  'ae01.alicdn.com',
  'ae-pic-a1.aliexpress-media.com',
  'aliexpress-media.com',
  'm.media-amazon.com',
  'ssl-images-amazon.com',
  'bigbuy.eu',
  'bbcdn.eu',
];

const MAX_BYTES = 4 * 1024 * 1024;

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get('u');
  if (!raw) return NextResponse.json({ ok: false, error: 'Falta el parámetro u' }, { status: 400 });

  let target: URL;
  try {
    target = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
  } catch {
    return NextResponse.json({ ok: false, error: 'URL no válida' }, { status: 400 });
  }
  if (target.protocol !== 'https:' || !ALLOWED_HOSTS.some((h) => target.hostname === h || target.hostname.endsWith(`.${h}`))) {
    return NextResponse.json({ ok: false, error: 'Host de imagen no permitido' }, { status: 403 });
  }

  try {
    const res = await fetch(target.toString(), {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DropshipPilot/1.0)', Accept: 'image/*' },
      signal: AbortSignal.timeout(12_000),
      cache: 'no-store',
    });
    if (!res.ok) return NextResponse.json({ ok: false, error: `El proveedor respondió ${res.status}` }, { status: 502 });

    const type = res.headers.get('content-type') ?? '';
    if (!type.startsWith('image/')) return NextResponse.json({ ok: false, error: 'No es una imagen' }, { status: 415 });

    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > MAX_BYTES) return NextResponse.json({ ok: false, error: 'Imagen demasiado grande' }, { status: 413 });

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': type,
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        'X-Image-Source': target.hostname,
      },
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: `No he podido descargar la imagen: ${(err as Error).message}` }, { status: 502 });
  }
}

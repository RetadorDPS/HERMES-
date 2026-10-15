/**
 * Limitador de peticiones en memoria (ventana deslizante por clave).
 *
 * Suficiente para un despliegue de un solo servidor: protege los endpoints
 * caros (scraping, webhooks, autenticación) frente a abuso accidental o
 * ataques sencillos. Si algún día hay varias instancias, sustitúyelo por
 * un contador en Redis (ya está disponible en la infraestructura).
 */
type Bucket = { hits: number[]; blockedUntil?: number };

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function rateLimit(key: string, limit: number, windowMs: number, blockMs = 0): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { hits: [] };

  if (bucket.blockedUntil && bucket.blockedUntil > now) {
    return { ok: false, remaining: 0, retryAfterSeconds: Math.ceil((bucket.blockedUntil - now) / 1000) };
  }

  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);

  if (bucket.hits.length >= limit) {
    if (blockMs > 0) bucket.blockedUntil = now + blockMs;
    buckets.set(key, bucket);
    const oldest = bucket.hits[0] ?? now;
    return { ok: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)) };
  }

  bucket.hits.push(now);
  bucket.blockedUntil = undefined;
  buckets.set(key, bucket);

  // Limpieza oportunista para que el mapa no crezca sin límite
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (v.hits.every((t) => now - t > windowMs) && (!v.blockedUntil || v.blockedUntil < now)) buckets.delete(k);
    }
  }

  return { ok: true, remaining: limit - bucket.hits.length, retryAfterSeconds: 0 };
}

/** IP del cliente a partir de las cabeceras del proxy inverso (Nginx) */
export function clientIp(req: Request) {
  const h = req.headers;
  return (
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    h.get('x-real-ip') ||
    h.get('cf-connecting-ip') ||
    'desconocida'
  );
}

/** Respuesta 429 uniforme con cabecera Retry-After (y sin caché: son datos vivos) */
export function tooManyRequests(retryAfterSeconds: number, message = 'Demasiadas peticiones seguidas. Espera un momento.') {
  return new Response(JSON.stringify({ ok: false, error: message, retryAfterSeconds }), {
    status: 429,
    headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfterSeconds), 'Cache-Control': 'no-store' },
  });
}

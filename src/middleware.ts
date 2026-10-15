import { NextResponse, type NextRequest } from 'next/server';

/**
 * Middleware: autenticación + cabeceras de seguridad.
 *
 * ── Autenticación ────────────────────────────────────────────────────────────
 * Con AUTH_ENABLED=true protege el dashboard: si no hay cookie de sesión
 * (gestionada por NextAuth v4, /api/auth/[...nextauth]) redirige a /login.
 * Por defecto está DESACTIVADO para que la demo sea navegable de inmediato.
 * Los webhooks y las rutas de API de los workers quedan siempre públicos.
 *
 * ── Cabeceras de seguridad ───────────────────────────────────────────────────
 * Se calculan en cada petición (no en el build, que las congelaría):
 *   • En el visor de previsualización (iframe sandbox) hace falta permitir la
 *     incrustación → ALLOW_IFRAME_EMBED=true (por defecto).
 *   • En producción el compose define ALLOW_IFRAME_EMBED=false y se aplican
 *     cabeceras estrictas: sin incrustación ajena, HSTS, nosniff, etc.
 */
const PROTECTED_PREFIXES = ['/dashboard', '/catalog', '/import', '/products', '/orders', '/monitor', '/stores', '/pricing', '/proxies', '/settings', '/suppliers', '/billing', '/admin'];
const PUBLIC_API_PREFIXES = ['/api/webhooks', '/api/health', '/api/auth'];

function securityHeaders(embeddable: boolean): [string, string][] {
  const base: [string, string][] = [
    ['X-Content-Type-Options', 'nosniff'],
    ['Referrer-Policy', 'strict-origin-when-cross-origin'],
    ['X-Robots-Tag', 'noindex, nofollow'],
  ];

  return embeddable
    ? [...base, ['X-Frame-Options', 'ALLOWALL'], ['Content-Security-Policy', 'frame-ancestors *']]
    : [
        ...base,
        ['X-Frame-Options', 'SAMEORIGIN'],
        ['Content-Security-Policy', "frame-ancestors 'self'"],
        ['Strict-Transport-Security', 'max-age=31536000; includeSubDomains'],
        ['Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self)'],
      ];
}

function withHeaders(res: NextResponse, req: NextRequest) {
  const embeddable = process.env.ALLOW_IFRAME_EMBED !== 'false';
  for (const [key, value] of securityHeaders(embeddable)) res.headers.set(key, value);
  return res;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── Autenticación (sólo si está activada) ──────────────────────────────────
  if (process.env.AUTH_ENABLED === 'true') {
    const isPublicApi = PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p));
    const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));

    if (isProtected && !isPublicApi) {
      const session =
        req.cookies.get('next-auth.session-token')?.value ??
        req.cookies.get('__Secure-next-auth.session-token')?.value;

      if (!session) {
        const loginUrl = new URL('/login', req.url);
        loginUrl.searchParams.set('callbackUrl', pathname);
        return withHeaders(NextResponse.redirect(loginUrl), req);
      }
    }
  }

  return withHeaders(NextResponse.next(), req);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

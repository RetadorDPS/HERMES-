/**
 * Nota: las cabeceras de seguridad NO se definen aquí.
 * Next.js congela `headers()` dentro del build (required-server-files.json),
 * así que una variable de entorno no tendría efecto en tiempo de ejecución.
 * Se aplican dinámicamente en `src/middleware.ts`:
 *   • previsualización (iframe)  → ALLOW_IFRAME_EMBED != "false"
 *   • producción (compose)       → ALLOW_IFRAME_EMBED=false → cabeceras estrictas
 */

/**
 * Versión ESTÁTICA (solo pantallas, para GitHub Pages): se activa con ESTATICO=1
 * desde scripts/estatico/construir.mjs. Sin esa variable, nada cambia.
 */
const estatico = process.env.ESTATICO === '1';
const rutaBase = process.env.RUTA_BASE ?? '';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_ESTATICO: estatico ? '1' : '0',
    NEXT_PUBLIC_RUTA_BASE: estatico ? rutaBase : '',
    NEXT_PUBLIC_HORA_BASE: estatico ? (process.env.HORA_BASE ?? String(Date.now())) : '',
  },
  ...(estatico
    ? { output: 'export', basePath: rutaBase, assetPrefix: rutaBase || undefined, trailingSlash: true }
    : {}),
  images: {
    ...(estatico ? { unoptimized: true } : {}),
    remotePatterns: [
      { protocol: 'https', hostname: '**.alicdn.com' },
      { protocol: 'https', hostname: '**.aliexpress-media.com' },
      { protocol: 'https', hostname: '**.cjdropshipping.com' },
      { protocol: 'https', hostname: '**.media-amazon.com' },
      { protocol: 'https', hostname: '**.shopifycdn.com' },
    ],
  },
  experimental: {
    serverActions: { bodySizeLimit: '8mb' },
  },
};

export default nextConfig;

/**
 * Nota: las cabeceras de seguridad NO se definen aquí.
 * Next.js congela `headers()` dentro del build (required-server-files.json),
 * así que una variable de entorno no tendría efecto en tiempo de ejecución.
 * Se aplican dinámicamente en `src/middleware.ts`:
 *   • previsualización (iframe)  → ALLOW_IFRAME_EMBED != "false"
 *   • producción (compose)       → ALLOW_IFRAME_EMBED=false → cabeceras estrictas
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
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

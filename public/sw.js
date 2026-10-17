/**
 * Service worker de DropshipPilot (PWA).
 *
 * Reglas prudentes para no mostrar nunca datos viejos como si fueran actuales:
 *  - Solo toca peticiones GET del propio dominio. Supabase, CJ, AliExpress y cualquier otro origen pasan directo.
 *  - Páginas y datos: RED PRIMERO. Solo si no hay conexión se usa la copia guardada (o la página «sin conexión»).
 *  - Archivos con nombre único (/_next/static/) e iconos: caché primero (nunca cambian de contenido).
 * La versión llega en la propia dirección (sw.js?v=NN): al publicar una versión nueva, el navegador instala
 * el worker nuevo y borra las cachés de las versiones anteriores.
 */
const VERSION = new URL(self.location.href).searchParams.get('v') || '0';
const CACHE_ESTATICO = `dsp-estatico-v${VERSION}`;
const CACHE_PAGINAS = `dsp-paginas-v${VERSION}`;
const BASE = new URL('./', self.location.href).pathname; // p. ej. /HERMES-/
const PAGINA_SIN_CONEXION = `${BASE}sin-conexion.html`;

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches
      .open(CACHE_ESTATICO)
      .then((cache) => cache.addAll([PAGINA_SIN_CONEXION, `${BASE}iconos/icono-192.png`, `${BASE}iconos/icono-512.png`]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((nombres) =>
        Promise.all(
          nombres
            .filter((n) => n.startsWith('dsp-') && n !== CACHE_ESTATICO && n !== CACHE_PAGINAS)
            .map((n) => caches.delete(n))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (evento) => {
  const peticion = evento.request;
  if (peticion.method !== 'GET') return;
  const url = new URL(peticion.url);
  if (url.origin !== self.location.origin) return; // Supabase y proveedores: nunca intervenimos
  if (!url.pathname.startsWith(BASE)) return;

  // Archivos con nombre único: caché primero
  if (url.pathname.startsWith(`${BASE}_next/static/`) || url.pathname.startsWith(`${BASE}iconos/`)) {
    evento.respondWith(
      caches.match(peticion).then(
        (guardada) =>
          guardada ||
          fetch(peticion).then((respuesta) => {
            if (respuesta.ok) {
              const copia = respuesta.clone();
              caches.open(CACHE_ESTATICO).then((c) => c.put(peticion, copia));
            }
            return respuesta;
          })
      )
    );
    return;
  }

  // Páginas: red primero; sin conexión, la última copia o la página «sin conexión»
  if (peticion.mode === 'navigate') {
    evento.respondWith(
      fetch(peticion)
        .then((respuesta) => {
          if (respuesta.ok) {
            const copia = respuesta.clone();
            caches.open(CACHE_PAGINAS).then((c) => c.put(peticion, copia));
          }
          return respuesta;
        })
        .catch(() =>
          caches.match(peticion).then((guardada) => guardada || caches.match(PAGINA_SIN_CONEXION))
        )
    );
  }
  // Todo lo demás (datos propios): sin intervenir, siempre de la red
});

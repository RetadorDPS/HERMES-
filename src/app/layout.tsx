import type { Metadata, Viewport } from 'next';
import './globals.css';
import { SimuladorApi } from '@/components/estatico/simulador-api';
import { SesionProvider } from '@/components/auth/sesion';
import { ESTATICO } from '@/lib/ruta';

export const metadata: Metadata = {
  title: {
    default: 'DropshipPilot · Automatización de dropshipping',
    template: '%s · DropshipPilot',
  },
  description:
    'Plataforma SaaS de automatización de dropshipping: importación desde AliExpress, Amazon y CJ, sincronización 24/7 de precios y stock, gestión de pedidos y fulfillment automático.',
};

export const viewport: Viewport = {
  themeColor: '#0b1020',
  width: 'device-width',
  initialScale: 1,
};

/**
 * Recuperación tras una publicación nueva: si el navegador conserva una página vieja cuyos archivos
 * (estilos o scripts con nombre cambiante) ya no existen, la pantalla saldría sin diseño hasta refrescar.
 * Este guardián detecta el fallo y recarga la página una sola vez (como mucho una vez por minuto).
 */
const RECUPERAR_PAGINA = `(function(){
  function recargar(){
    try{
      var k='hermes-recarga', t=Number(sessionStorage.getItem(k)||0);
      if(Date.now()-t<60000) return;
      sessionStorage.setItem(k,String(Date.now()));
    }catch(e){}
    location.reload();
  }
  window.addEventListener('error',function(e){
    var el=e&&e.target;
    if(el&&(el.tagName==='LINK'||el.tagName==='SCRIPT')&&/\\/_next\\//.test(el.href||el.src||'')) recargar();
  },true);
  window.addEventListener('load',function(){
    // El cuerpo siempre lleva fondo propio (bg-background): si es transparente, los estilos no se cargaron
    if(getComputedStyle(document.body).backgroundColor==='rgba(0, 0, 0, 0)'){ recargar(); return; }
    var l=document.querySelectorAll('link[rel="stylesheet"]');
    for(var i=0;i<l.length;i++){
      if(/\\/_next\\//.test(l[i].href||'')&&!l[i].sheet){ recargar(); return; }
    }
  });
  window.addEventListener('unhandledrejection',function(e){
    var m=String((e&&e.reason&&(e.reason.message||e.reason))||'');
    if(/Loading chunk|ChunkLoadError|Failed to fetch dynamically imported/i.test(m)) recargar();
  });
})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="dark">
      <head>
        <script dangerouslySetInnerHTML={{ __html: RECUPERAR_PAGINA }} />
      </head>
      <body className="min-h-screen bg-background font-sans antialiased">
        {ESTATICO && <SimuladorApi />}
        <SesionProvider>{children}</SesionProvider>
      </body>
    </html>
  );
}

'use client';

/**
 * Pantallas con DATOS REALES (Supabase) de la versión estática.
 * Se elige por la ruta del navegador, porque en GitHub Pages cada pantalla ya
 * viene construida con los datos de ejemplo y aquí se sustituye por la real.
 */
import { usePathname } from 'next/navigation';
import { Download, Factory, RefreshCw, Shield } from 'lucide-react';
import { sinBase } from '@/lib/ruta';
import { CatalogoReal } from './real/catalogo-real';
import { AdminReal, AjustesReal, PuestaEnMarchaReal } from './real/cuenta-real';
import { FacturacionReal } from './real/facturacion-real';
import { PedidosReal, ProductosReal, TiendasReal } from './real/listados-real';
import { PreciosReal } from './real/precios-real';
import { Proximamente } from './real/proximamente';
import { ResumenReal } from './real/resumen-real';

export function PanelReal() {
  const ruta = sinBase(usePathname() ?? '/').replace(/\/+$/, '') || '/';

  if (ruta === '/dashboard') return <ResumenReal />;
  if (ruta === '/products') return <ProductosReal />;
  if (ruta === '/orders') return <PedidosReal />;
  if (ruta === '/stores') return <TiendasReal />;
  if (ruta === '/catalog') return <CatalogoReal />;
  if (ruta === '/billing') return <FacturacionReal />;
  if (ruta === '/pricing') return <PreciosReal />;
  if (ruta === '/settings') return <AjustesReal />;
  if (ruta === '/admin') return <AdminReal />;
  if (ruta === '/setup') return <PuestaEnMarchaReal />;

  if (ruta === '/import')
    return (
      <Proximamente
        titulo="Importar por enlace"
        subtitulo="Trae un producto de un proveedor pegando su dirección"
        icono={Download}
        queHara={['Pegar el enlace de un producto de CJ o AliExpress.', 'Ver variantes, fotos, envío y tu precio final con tu regla de margen.', 'Publicarlo en tu tienda con un clic.']}
        queFalta="Necesita conectar las APIs oficiales de los proveedores (siguiente fase). Mientras tanto, el catálogo común y las reglas de margen ya funcionan."
      />
    );
  if (ruta === '/monitor')
    return (
      <Proximamente
        titulo="Monitor de sincronización"
        subtitulo="Cola de tareas y registro de cambios"
        icono={RefreshCw}
        queHara={['Ver cada cuánto se revisan precios y stock.', 'Consultar el registro de cambios aplicados a tus productos.', 'Reintentar las tareas que fallaron.']}
        queFalta="Se activa cuando existan productos importados y las tareas programadas del servidor."
      />
    );
  if (ruta === '/suppliers')
    return (
      <Proximamente
        titulo="Proveedores y APIs"
        subtitulo="Conecta las APIs oficiales de CJ y AliExpress"
        icono={Factory}
        queHara={['Guardar tus claves de forma cifrada (nunca visibles desde el navegador).', 'Probar la conexión con cada proveedor.', 'Usar tu cuenta para comprar los pedidos automáticamente.']}
        queFalta="La conexión con los proveedores se construye en la siguiente fase, uno a uno y con pocas llamadas de prueba."
      />
    );
  if (ruta === '/proxies')
    return (
      <Proximamente
        titulo="Proxies y anti-bot"
        subtitulo="Extracción sin bloqueos"
        icono={Shield}
        queHara={['Validar proxies residenciales.', 'Rotar el pool para leer páginas de proveedores.']}
        queFalta="Con las APIs oficiales de CJ y AliExpress probablemente no hará falta. Se decidirá cuando se conecten los proveedores."
      />
    );

  return (
    <Proximamente titulo="Sección en preparación" subtitulo="Todavía no está conectada" icono={Shield} queHara={['Esta pantalla se conectará con tus datos reales.']} queFalta="Estamos conectando las pantallas una a una." />
  );
}

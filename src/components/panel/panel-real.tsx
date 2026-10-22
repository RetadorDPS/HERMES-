'use client';

/**
 * Pantallas con DATOS REALES (Supabase) de la versión estática.
 * Se elige por la ruta del navegador, porque en GitHub Pages cada pantalla ya
 * viene construida con los datos de ejemplo y aquí se sustituye por la real.
 */
import { usePathname } from 'next/navigation';
import { Shield } from 'lucide-react';
import { sinBase } from '@/lib/ruta';
import { CatalogoReal } from './real/catalogo-real';
import { AdminReal, AjustesReal, PuestaEnMarchaReal } from './real/cuenta-real';
import { FacturacionReal } from './real/facturacion-real';
import { ImportarReal } from './real/importar-real';
import { MonitorReal } from './real/monitor-real';
import { ProductosReal, TiendasReal } from './real/listados-real';
import { PedidosReal } from './real/pedidos-real';
import { PreciosReal } from './real/precios-real';
import { ProveedoresReal } from './real/proveedores-real';
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

  if (ruta === '/import') return <ImportarReal />;
  if (ruta === '/monitor') return <MonitorReal />;
  if (ruta === '/suppliers') return <ProveedoresReal />;
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

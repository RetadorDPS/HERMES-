import type { Metadata, Viewport } from 'next';
import './globals.css';
import { SimuladorApi } from '@/components/estatico/simulador-api';
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="dark">
      <body className="min-h-screen bg-background font-sans antialiased">
        {ESTATICO && <SimuladorApi />}
        {children}
      </body>
    </html>
  );
}

'use client';

import Link from 'next/link';
import { Suspense, useMemo } from 'react';
import { OrdersTable } from '@/app/(dashboard)/orders/orders-table';
import { StoreManager } from '@/app/(dashboard)/stores/store-manager';
import { obtenerPedidos, obtenerProveedores, obtenerTiendas } from '@/lib/real/datos';
import { Alert } from '@/components/ui/alert';
import { obtenerTiendaRetador } from '@/lib/real/retador';
import { ProductosRetador } from './productos-retador';
import { RetadorConexion } from './retador-conexion';
import { formatNumber } from '@/lib/utils';
import { PantallaReal, useCarga } from './comun';

export function ProductosReal() {
  // Pantalla real: sin las acciones de demostración (sus botones y enlaces apuntaban a páginas que no existen). Cada producto publicado
  // se gestiona aquí mismo: precio y stock, pausar, reactivar y retirar, con las reglas reales de cada tienda.
  const { datos, error, cargando, recargar } = useCarga(async () => ({ tienda: await obtenerTiendaRetador() }));
  const tienda = datos?.tienda ?? null;
  return (
    <PantallaReal titulo="Gestión de productos" subtitulo="Tus productos publicados en tus tiendas" cargando={cargando} error={error} alRecargar={recargar} tour="screen:products">
      {datos && (
        <>
          {tienda && tienda.status === 'CONNECTED' ? (
            <ProductosRetador tienda={tienda} />
          ) : (
            <Alert variant="info" title="Todavía no tienes ninguna tienda conectada">
              Conecta tu tienda en{' '}
              <Link href="/stores" className="underline">
                Tiendas
              </Link>{' '}
              y publica desde el catálogo con «Publicar en…». Tus productos publicados aparecerán aquí para cambiar su precio y stock, pausarlos o retirarlos.
            </Alert>
          )}
          <p className="text-[12px] text-muted-foreground">
            ¿Quieres añadir más? Búscalos en el{' '}
            <Link href="/catalog" className="underline">
              catálogo
            </Link>{' '}
            o impórtalos por enlace desde{' '}
            <Link href="/import" className="underline">
              Importar
            </Link>
            .
          </p>
        </>
      )}
    </PantallaReal>
  );
}

export function PedidosReal() {
  const { datos, error, cargando, recargar } = useCarga(obtenerPedidos);
  return (
    <PantallaReal
      titulo="Pedidos y monitor de envíos"
      subtitulo="Fulfillment automático: compra al proveedor, tracking y aviso al cliente"
      cargando={cargando}
      error={error}
      alRecargar={recargar}
      tour="screen:orders"
    >
      {datos && <OrdersTable orders={datos.pedidos as any} summary={datos.resumen} />}
    </PantallaReal>
  );
}

export function TiendasReal() {
  const { datos, error, cargando, recargar } = useCarga(async () => {
    const [tiendas, proveedores] = await Promise.all([obtenerTiendas(), obtenerProveedores()]);
    return { tiendas, proveedores };
  });
  return (
    <PantallaReal
      titulo="Tiendas conectadas"
      subtitulo="Retador, Shopify y WooCommerce"
      cargando={cargando}
      error={error}
      alRecargar={recargar}
      tour="screen:stores"
    >
      {datos && (
        <>
          <RetadorConexion />
          <Suspense fallback={null}>
            <StoreManager stores={datos.tiendas as any} suppliers={datos.proveedores} shopifyOAuth={false} />
          </Suspense>
        </>
      )}
    </PantallaReal>
  );
}


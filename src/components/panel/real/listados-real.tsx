'use client';

import { Suspense, useMemo } from 'react';
import { OrdersTable } from '@/app/(dashboard)/orders/orders-table';
import { ProductTableEstatico } from '@/app/(dashboard)/products/product-table-estatico';
import { StoreManager } from '@/app/(dashboard)/stores/store-manager';
import { obtenerPedidos, obtenerProductos, obtenerProveedores, obtenerTiendas } from '@/lib/real/datos';
import { RetadorConexion } from './retador-conexion';
import { formatNumber } from '@/lib/utils';
import { PantallaReal, useCarga } from './comun';

export function ProductosReal() {
  const { datos, error, cargando, recargar } = useCarga(obtenerProductos);
  const tiendas = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const p of datos ?? []) if (p.storeId) mapa.set(p.storeId, p.storeName);
    return [...mapa.entries()].map(([id, name]) => ({ id, name }));
  }, [datos]);
  return (
    <PantallaReal
      titulo="Gestión de productos"
      subtitulo={datos ? `${formatNumber(datos.length)} productos importados` : 'Tus productos importados'}
      cargando={cargando}
      error={error}
      alRecargar={recargar}
      tour="screen:products"
    >
      {datos && (
        <Suspense fallback={null}>
          <ProductTableEstatico items={datos} stores={tiendas} />
        </Suspense>
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


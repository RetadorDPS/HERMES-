'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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

export function TiendasReal() {
  // Pantalla real: solo Retador se puede conectar hoy. Shopify y WooCommerce se enseñan como «próximamente», sin formularios que no funcionan.
  const { error, cargando, recargar } = useCarga(async () => ({ listo: true }));
  return (
    <PantallaReal
      titulo="Tiendas conectadas"
      subtitulo="Dónde publicas tus productos"
      cargando={cargando}
      error={error}
      alRecargar={recargar}
      tour="screen:stores"
    >
      <RetadorConexion />
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Otras tiendas</CardTitle>
          <CardDescription>Estamos preparando la publicación en más plataformas. Te avisaremos cuando estén disponibles.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Badge variant="outline">Shopify · Próximamente</Badge>
          <Badge variant="outline">WooCommerce · Próximamente</Badge>
        </CardContent>
      </Card>
    </PantallaReal>
  );
}

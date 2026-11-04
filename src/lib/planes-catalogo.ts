/**
 * src/lib/planes-catalogo.ts — Catálogo ÚNICO de planes que enseña la app (DropshipPilot solo y conjuntos con Retador).
 *
 * Reglas:
 *  · Los límites de herramientas (fichas completas y cotizaciones de envío) son los REALES que cuenta el servidor (`PlanLimite`):
 *    si cambian allí, se cambian aquí. No se promete nada que el servidor no aplique.
 *  · Los topes de productos de los conjuntos (10 / 50 / 500) los fija y los aplica Retador.
 *  · Los precios de DropshipPilot y de los conjuntos están razonados en `docs/planes-y-precios.md`. La parte de Retador la fija Retador:
 *    si no se conoce, el precio del conjunto se enseña como «por confirmar» (nunca se inventa).
 *  · Todo en USD, como Retador. Anual = 10 mensualidades (2 meses gratis).
 */
export type CicloPlan = 'mensual' | 'anual';
export const MESES_DE_ANUAL = 10;

/** Lo que cobra Retador por sus propios planes (USD/mes). null = todavía no confirmado por Retador. */
export const RETADOR_PRO_USD: number | null = null;
export const RETADOR_PREMIUM_USD = 45;

export interface PlanTarjeta {
  id: string;
  nombre: string;
  lema: string;
  /** USD al mes; 0 = gratis; null = precio por confirmar o a medida. */
  precioMensual: number | null;
  /** Texto cuando no hay precio fijo. */
  sinPrecio?: string;
  destacado?: boolean;
  etiqueta?: string;
  /** Lo que incluye de Retador (solo en los conjuntos). */
  retador?: { plan: string; productos: string };
  /** Lo que incluye de DropshipPilot. */
  herramientas: { fichas: string; envios: string; plan: string };
  ventajas: string[];
}

const COMUN = ['Publica tus productos de CJ y AliExpress en tu tienda de Retador', 'Stock y envío al día de forma automática'];

/** Planes de DropshipPilot por separado (cada app cobra lo suyo). */
export const PLANES_SOLO: PlanTarjeta[] = [
  {
    id: 'prueba',
    nombre: 'Prueba',
    lema: 'Para probar el sistema sin pagar nada',
    precioMensual: 0,
    herramientas: { plan: 'Prueba', fichas: '5 fichas completas en total', envios: '10 cotizaciones de envío en total' },
    ventajas: [...COMUN, 'Sabes el beneficio real antes de publicar'],
  },
  {
    id: 'starter',
    nombre: 'Starter',
    lema: 'Para vender de verdad con tus primeros productos',
    precioMensual: 19,
    herramientas: { plan: 'Starter', fichas: '20 fichas completas al mes', envios: '60 cotizaciones de envío al mes' },
    ventajas: [...COMUN, 'Precio automático con frenos de seguridad', 'Opiniones reales del proveedor en tus productos'],
  },
  {
    id: 'pro',
    nombre: 'Pro',
    lema: 'Para crecer: más productos y más países',
    precioMensual: 49,
    destacado: true,
    etiqueta: 'El más completo',
    herramientas: { plan: 'Pro', fichas: '80 fichas completas al mes', envios: '300 cotizaciones de envío al mes' },
    ventajas: [...COMUN, 'Precio automático con frenos de seguridad', 'Opiniones reales del proveedor en tus productos', 'Cotiza el envío a muchos países cada mes'],
  },
  {
    id: 'enterprise',
    nombre: 'A medida',
    lema: 'Para equipos con mucho volumen',
    precioMensual: null,
    sinPrecio: 'Desde 149 USD al mes',
    herramientas: { plan: 'A medida', fichas: '250 fichas completas al mes', envios: '1.000 cotizaciones de envío al mes' },
    ventajas: [...COMUN, 'Capacidad hecha a la medida de tu volumen'],
  },
];

/** Planes CONJUNTOS: un solo plan, una sola cuenta y un solo pago, para Retador y DropshipPilot. */
export const PLANES_CONJUNTOS: PlanTarjeta[] = [
  {
    id: 'gratis-conjunto',
    nombre: 'Gratis',
    lema: 'Empieza hoy, sin tarjeta',
    precioMensual: 0,
    retador: { plan: 'Gratis', productos: 'Hasta 10 productos en tu tienda' },
    herramientas: { plan: 'Prueba', fichas: '5 fichas completas en total', envios: '10 cotizaciones de envío en total' },
    ventajas: ['Una sola cuenta para las dos apps', 'Se activa solo al vincular tu cuenta'],
  },
  {
    id: 'pro-conjunto',
    nombre: 'Pro',
    lema: 'Tu tienda en marcha con las herramientas justas',
    precioMensual: RETADOR_PRO_USD === null ? null : Math.floor((RETADOR_PRO_USD + 19) * 0.85),
    sinPrecio: 'Precio por confirmar',
    retador: { plan: 'Pro', productos: 'Hasta 50 productos en tu tienda' },
    herramientas: { plan: 'Starter', fichas: '20 fichas completas al mes', envios: '60 cotizaciones de envío al mes' },
    ventajas: ['Una sola cuenta y un solo pago', 'Precio automático con frenos de seguridad', 'Opiniones reales del proveedor en tus productos'],
  },
  {
    id: 'premium-conjunto',
    nombre: 'Premium',
    lema: 'Todo para vender en grande, a mejor precio que por separado',
    // (45 de Retador Premium + 49 de DropshipPilot Pro) con un 15 % menos, redondeado hacia abajo
    precioMensual: Math.floor((RETADOR_PREMIUM_USD + 49) * 0.85),
    destacado: true,
    etiqueta: 'El más elegido',
    retador: { plan: 'Premium', productos: 'Hasta 500 productos en tu tienda' },
    herramientas: { plan: 'Pro', fichas: '80 fichas completas al mes', envios: '300 cotizaciones de envío al mes' },
    ventajas: ['Una sola cuenta y un solo pago', 'Precio automático con frenos de seguridad', 'Opiniones reales del proveedor en tus productos', 'Cotiza el envío a muchos países cada mes'],
  },
];

/** Precio a enseñar según el ciclo. */
export function precioDelCiclo(mensual: number, ciclo: CicloPlan): { importe: number; periodo: string; ahorro?: string } {
  if (ciclo === 'mensual') return { importe: mensual, periodo: 'al mes' };
  return { importe: mensual * MESES_DE_ANUAL, periodo: 'al año', ahorro: `${12 - MESES_DE_ANUAL} meses gratis` };
}

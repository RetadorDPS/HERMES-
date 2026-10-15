import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn, statusColor } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium tracking-wide transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary/15 text-primary',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'border-white/15 text-muted-foreground',
        success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
        warning: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
        danger: 'border-rose-500/30 bg-rose-500/10 text-rose-400',
        info: 'border-sky-500/30 bg-sky-500/10 text-sky-400',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/** Badge que colorea automáticamente según el estado del dominio */
function StatusBadge({ status, className, label }: { status: string; className?: string; label?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium', statusColor(status), className)}>
      <span className="size-1.5 rounded-full bg-current" />
      {label ?? statusLabel(status)}
    </span>
  );
}

const LABELS: Record<string, string> = {
  ACTIVE: 'Activo',
  DRAFT: 'Borrador',
  PAUSED: 'Pausado',
  OUT_OF_STOCK: 'Agotado',
  ERROR: 'Error',
  ARCHIVED: 'Archivado',
  SUCCESS: 'Correcto',
  FAILED: 'Fallido',
  SKIPPED: 'Sin cambios',
  QUEUED: 'En cola',
  RUNNING: 'En proceso',
  CONNECTED: 'Conectada',
  DISCONNECTED: 'Desconectada',
  PENDING: 'Pendiente',
  PAID: 'Pagado',
  SUPPLIER_PURCHASED: 'Comprado a proveedor',
  SUPPLIER_ERROR: 'Error de proveedor',
  SHIPPED: 'Enviado',
  DELIVERED: 'Entregado',
  CANCELED: 'Cancelado',
  REFUNDED: 'Reembolsado',
  UNFULFILLED: 'Sin preparar',
  PARTIAL: 'Parcial',
  FULFILLED: 'Completado',
  RESTOCKED: 'Reabastecido',
  INFO: 'Info',
  WARN: 'Aviso',
  DEBUG: 'Debug',
  PRICE_UPDATE: 'Precio',
  STOCK_UPDATE: 'Stock',
  IMPORT: 'Importación',
  FULL_REFRESH: 'Sync completo',
  ORDER_PUSH: 'Pedido',
  DELETE: 'Borrado',
};

export const statusLabel = (s: string) => LABELS[s] ?? s;

export { Badge, StatusBadge, badgeVariants };

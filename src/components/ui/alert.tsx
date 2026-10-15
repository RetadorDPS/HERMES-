'use client';

import * as React from 'react';
import { CheckCircle2, Info, TriangleAlert, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

type AlertVariant = 'info' | 'success' | 'warning' | 'danger';

const STYLES: Record<AlertVariant, { wrap: string; icon: React.ReactNode }> = {
  info: { wrap: 'border-sky-500/25 bg-sky-500/[0.07] text-sky-100', icon: <Info className="size-4 text-sky-400" /> },
  success: { wrap: 'border-emerald-500/25 bg-emerald-500/[0.07] text-emerald-100', icon: <CheckCircle2 className="size-4 text-emerald-400" /> },
  warning: { wrap: 'border-amber-500/25 bg-amber-500/[0.07] text-amber-100', icon: <TriangleAlert className="size-4 text-amber-400" /> },
  danger: { wrap: 'border-rose-500/25 bg-rose-500/[0.07] text-rose-100', icon: <XCircle className="size-4 text-rose-400" /> },
};

export function Alert({
  variant = 'info',
  title,
  children,
  className,
  onDismiss,
}: {
  variant?: AlertVariant;
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  onDismiss?: () => void;
}) {
  const s = STYLES[variant];
  return (
    <div className={cn('flex items-start gap-3 rounded-lg border px-3.5 py-3 text-sm animate-in-up', s.wrap, className)}>
      <span className="mt-0.5 shrink-0">{s.icon}</span>
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn('text-[13px] opacity-90', title && 'mt-0.5')}>{children}</div>}
      </div>
      {onDismiss && (
        <button onClick={onDismiss} className="shrink-0 rounded p-0.5 text-white/50 transition hover:bg-white/10 hover:text-white" aria-label="Cerrar">
          <XCircle className="size-3.5" />
        </button>
      )}
    </div>
  );
}

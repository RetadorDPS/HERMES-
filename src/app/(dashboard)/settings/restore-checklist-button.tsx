'use client';

/** Recupera la lista «Tus primeros pasos» si el cliente la había ocultado. */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ListChecks, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function RestoreChecklistButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch('/api/account/onboarding', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'show' }) });
        router.refresh();
        window.setTimeout(() => setBusy(false), 1200);
      }}
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <ListChecks className="size-4" />} Volver a mostrar mis primeros pasos
    </Button>
  );
}

/**
 * Layout de páginas legales: texto público, sin menú del panel, legible e
 * imprimible. Son PLANTILLAS: los datos entre corchetes los rellena el titular.
 */
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <Link href="/login" className="mb-6 inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Volver
      </Link>

      <div className="prose-legal space-y-4 text-[13.5px] leading-relaxed text-muted-foreground">{children}</div>

      <div className="mt-10 flex flex-wrap gap-4 border-t border-white/[0.07] pt-5 text-[12px] text-muted-foreground">
        <Link href="/privacy" className="hover:text-foreground hover:underline">Privacidad</Link>
        <Link href="/terms" className="hover:text-foreground hover:underline">Términos</Link>
        <Link href="/cookies" className="hover:text-foreground hover:underline">Cookies</Link>
        <span className="ml-auto">Última actualización: {new Date().toLocaleDateString('es-ES')}</span>
      </div>
    </div>
  );
}

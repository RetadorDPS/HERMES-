'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/lib/supabase/cliente';

interface Respuesta {
  ok: boolean;
  mensaje?: string;
  error?: string;
  tokenReutilizado?: boolean;
  llamadasACj?: number;
  secretoCjApiKey?: boolean;
  secretosVistos?: string[];
  formaClave?: { longitud: number; tieneEspaciosOSaltos: boolean; contieneArrobaApi: boolean; sobrabanEspaciosAlBorde: boolean };
  muestra?: { id: string; titulo: string; costo: number; categoria: string | null; stock: number }[];
}

/** Llama a la función `cj-catalogo` (solo administrador) y devuelve su respuesta, con el error real si falla. */
async function invocarCj(cuerpo: Record<string, unknown>): Promise<Respuesta> {
  const { data, error } = await supabase().functions.invoke('cj-catalogo', { body: cuerpo });
  if (error) {
    let texto = error.message;
    try {
      const j = await (error as any).context?.json?.();
      if (j?.error) texto = j.error;
    } catch {
      /* sin cuerpo legible */
    }
    return { ok: false, error: texto };
  }
  return data as Respuesta;
}

/** Descarga del catálogo del proveedor CJ. AliExpress se añadirá aparte (son independientes). */
export function ProveedoresAdmin() {
  const [trabajando, setTrabajando] = useState<'probar' | 'descargar' | null>(null);
  const [resultado, setResultado] = useState<Respuesta | null>(null);

  const ejecutar = async (accion: 'probar' | 'descargar') => {
    setTrabajando(accion);
    setResultado(null);
    try {
      setResultado(await invocarCj(accion === 'probar' ? { accion } : { accion, tamano: 5 }));
    } catch (e) {
      setResultado({ ok: false, error: (e as Error).message });
    } finally {
      setTrabajando(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Catálogo de proveedores · CJ Dropshipping</CardTitle>
        <CardDescription>
          Usa la clave guardada en los secretos de Supabase. La descarga de prueba trae solo 5 productos, en una única petición a CJ.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={trabajando !== null} onClick={() => ejecutar('probar')}>
            {trabajando === 'probar' && <Loader2 className="size-4 animate-spin" />}
            Probar la clave de CJ
          </Button>
          <Button variant="gradient" size="sm" disabled={trabajando !== null} onClick={() => ejecutar('descargar')}>
            {trabajando === 'descargar' && <Loader2 className="size-4 animate-spin" />}
            Descargar 5 productos de prueba
          </Button>
        </div>

        {resultado && (
          <Alert variant={resultado.ok ? 'success' : 'warning'} title={resultado.ok ? 'Hecho' : 'No se pudo completar'}>
            <p>{resultado.ok ? resultado.mensaje : resultado.error}</p>
            {resultado.ok && resultado.llamadasACj !== undefined && (
              <p className="mt-1 text-[12px] opacity-80">
                Llamadas a CJ: {resultado.llamadasACj} · token {resultado.tokenReutilizado ? 'reutilizado' : 'nuevo'}
              </p>
            )}
            {!resultado.ok && resultado.secretoCjApiKey === false && (
              <p className="mt-1 text-[12px] opacity-80">
                Secretos que empiezan por CJ o ALI en el servidor: {resultado.secretosVistos?.length ? resultado.secretosVistos.join(', ') : 'ninguno'}.
              </p>
            )}
            {!resultado.ok && resultado.formaClave && resultado.secretoCjApiKey && (
              <p className="mt-1 text-[12px] opacity-80">
                Forma de la clave guardada (sin mostrarla): {resultado.formaClave.longitud} caracteres
                {resultado.formaClave.contieneArrobaApi ? ', con «@api@»' : ', sin «@api@»'}
                {resultado.formaClave.tieneEspaciosOSaltos ? ', con espacios o saltos de línea dentro' : ''}
                {resultado.formaClave.sobrabanEspaciosAlBorde ? ', con espacios en los bordes (ya se ignoran)' : ''}.
              </p>
            )}
            {resultado.muestra && resultado.muestra.length > 0 && (
              <ul className="mt-2 space-y-1 text-[12px]">
                {resultado.muestra.map((m) => (
                  <li key={m.id} className="truncate">
                    {m.titulo} · {m.costo.toFixed(2)} USD · {m.categoria ?? 'sin categoría'} · stock {m.stock}
                  </li>
                ))}
              </ul>
            )}
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

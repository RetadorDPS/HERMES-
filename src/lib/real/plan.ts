/**
 * src/lib/real/plan.ts — Plan de la cuenta: de dónde viene (propio o de Retador, plan conjunto) y si la persona ya eligió plan.
 * «Elige tu plan» es un paso obligatorio al registrarse. Si no se puede comprobar (por ejemplo, la base aún no tiene las columnas nuevas),
 * NO se bloquea a nadie: se da por elegido.
 */
import { supabase } from '../supabase/cliente';

export interface EstadoPlan {
  plan: 'TRIAL' | 'STARTER' | 'PRO' | 'ENTERPRISE';
  origen: 'PROPIO' | 'RETADOR';
  elegido: boolean;
}

export async function estadoPlan(): Promise<EstadoPlan | null> {
  try {
    const { data: auth } = await supabase().auth.getUser();
    const id = auth.user?.id;
    if (!id) return null;
    const r = await supabase().from('User').select('plan,planOrigen,planElegidoEn').eq('id', id).maybeSingle();
    if (r.error || !r.data) return null;
    const f: any = r.data;
    return { plan: f.plan, origen: f.planOrigen === 'RETADOR' ? 'RETADOR' : 'PROPIO', elegido: Boolean(f.planElegidoEn) };
  } catch {
    return null;
  }
}

/** Elige el plan Gratis (hoy el único que se puede elegir aquí; Pro y Premium se contratan en Retador y llegan al vincular). */
export async function elegirPlanGratis(): Promise<void> {
  const { data, error } = await supabase().functions.invoke('acciones-usuario', { body: { accion: 'elegir_plan', plan: 'TRIAL' } });
  if (error || !data?.ok) {
    let mensaje = 'No se pudo guardar tu plan. Inténtalo de nuevo.';
    try {
      const c = await (error as any)?.context?.json?.();
      if (c?.error) mensaje = c.error;
    } catch {
      /* mensaje general */
    }
    throw new Error(data?.error ?? mensaje);
  }
}

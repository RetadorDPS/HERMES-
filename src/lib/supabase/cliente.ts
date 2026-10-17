/**
 * Cliente de Supabase para el navegador (versión estática de GitHub Pages).
 * Se crea una sola vez y solo en el navegador.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLAVE_PUBLICA, SUPABASE_URL } from './config';
import { RUTA_BASE } from '../ruta';

let cliente: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (typeof window === 'undefined') {
    throw new Error('El cliente de Supabase solo se usa en el navegador');
  }
  if (!cliente) {
    cliente = createClient(SUPABASE_URL, SUPABASE_CLAVE_PUBLICA, {
      auth: {
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'hermes-sesion',
      },
    });
  }
  return cliente;
}

/** Dirección absoluta de una pantalla de esta web (para enlaces de correo y vuelta de Google). */
export function urlAbsoluta(ruta: string): string {
  const limpia = ruta.startsWith('/') ? ruta : `/${ruta}`;
  const conBarra = limpia.endsWith('/') || limpia.includes('?') ? limpia : `${limpia}/`;
  return `${window.location.origin}${RUTA_BASE}${conBarra}`;
}

/** Traduce los mensajes de error de Supabase Auth a español claro. */
export function mensajeDeError(err: { message?: string; status?: number; code?: string } | null | undefined): string {
  const texto = (err?.message ?? '').toLowerCase();
  const codigo = (err?.code ?? '').toLowerCase();
  if (texto.includes('invalid login credentials') || codigo === 'invalid_credentials') return 'Correo o contraseña incorrectos.';
  if (texto.includes('email not confirmed') || codigo === 'email_not_confirmed')
    return 'Todavía no has confirmado tu correo. Abre el enlace que te enviamos (revisa también Spam).';
  if (texto.includes('user already registered') || codigo === 'user_already_exists') return 'Ese correo ya tiene una cuenta. Inicia sesión o recupera tu contraseña.';
  if (texto.includes('password should be at least') || codigo === 'weak_password') return 'La contraseña es demasiado débil. Usa al menos 8 caracteres.';
  if (texto.includes('rate limit') || codigo.includes('rate_limit') || err?.status === 429)
    return 'Demasiados intentos seguidos. Espera unos minutos y vuelve a probar.';
  if (texto.includes('unable to validate email') || texto.includes('invalid email')) return 'Ese correo no parece válido.';
  if (texto.includes('provider is not enabled') || codigo === 'validation_failed' && texto.includes('provider'))
    return 'Entrar con Google todavía no está activado en el servidor. Usa tu correo y contraseña mientras tanto.';
  if (texto.includes('failed to fetch') || texto.includes('network')) return 'No se pudo conectar con el servidor. Revisa tu conexión a internet.';
  if (texto.includes('same password') || codigo === 'same_password') return 'La nueva contraseña debe ser distinta de la anterior.';
  if (texto.includes('expired') || texto.includes('invalid') && texto.includes('token')) return 'El enlace ha caducado o ya se usó. Pide uno nuevo.';
  return err?.message ? `No se pudo completar la acción (${err.message}).` : 'No se pudo completar la acción.';
}

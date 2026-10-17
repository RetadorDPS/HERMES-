/**
 * Modo de uso de la versión estática:
 *   • «demo» → datos de ejemplo, sin iniciar sesión (nada se guarda)
 *   • «real» → sesión de Supabase y datos reales de la cuenta
 * Se recuerda en el navegador. Solo tiene efecto en la versión estática.
 */
const CLAVE = 'hermes-modo';

export type Modo = 'demo' | 'real';

export function leerModo(): Modo {
  try {
    return window.localStorage.getItem(CLAVE) === 'demo' ? 'demo' : 'real';
  } catch {
    return 'real';
  }
}

export function guardarModo(modo: Modo) {
  try {
    if (modo === 'demo') window.localStorage.setItem(CLAVE, 'demo');
    else window.localStorage.removeItem(CLAVE);
  } catch {
    /* sin almacenamiento: se usa el modo real por defecto */
  }
}

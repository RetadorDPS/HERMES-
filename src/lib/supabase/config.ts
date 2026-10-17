/**
 * Datos PÚBLICOS de conexión con el proyecto de Supabase de Hermes.
 *
 * La clave «publicable» está pensada para ir en el navegador: por sí sola no da acceso a nada.
 * Lo que protege los datos son las reglas de seguridad por fila (RLS) de la base de datos.
 * NUNCA poner aquí la clave «service_role» ni contraseñas.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://zucoorfalpylffustiax.supabase.co';
export const SUPABASE_CLAVE_PUBLICA = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_gJv6YnczXWyh0FI_KPheqg_tEnbWx95';

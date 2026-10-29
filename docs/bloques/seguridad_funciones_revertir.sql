-- Marcha atrás de seguridad_funciones.sql
grant execute on function public.catalogo_forzar_envio_gratis() to public, anon, authenticated;
grant execute on function public.catalogo_guardar_resumen_envio() to public, anon, authenticated;
grant execute on function public.catalogo_recalcular_envio_gratis() to public, anon, authenticated;

-- Cierra el acceso público a 3 funciones internas del catálogo (hoy cualquiera podía llamarlas por la dirección /rest/v1/rpc/…).
-- Las usan solo disparadores y la propia base de datos; ninguna pantalla ni función las llama. Todo o nada, con comprobación final.
begin;
revoke execute on function public.catalogo_forzar_envio_gratis() from public, anon, authenticated;
revoke execute on function public.catalogo_guardar_resumen_envio() from public, anon, authenticated;
revoke execute on function public.catalogo_recalcular_envio_gratis() from public, anon, authenticated;
commit;
select
  not has_function_privilege('anon', 'public.catalogo_forzar_envio_gratis()', 'execute') as forzar_cerrada,
  not has_function_privilege('anon', 'public.catalogo_guardar_resumen_envio()', 'execute') as resumen_cerrada,
  not has_function_privilege('anon', 'public.catalogo_recalcular_envio_gratis()', 'execute') as recalcular_cerrada,
  not has_function_privilege('authenticated', 'public.catalogo_recalcular_envio_gratis()', 'execute') as recalcular_cerrada_usuarios,
  has_function_privilege('authenticated', 'public.estado_proveedores()', 'execute') as estado_proveedores_sigue_abierta_a_usuarios;

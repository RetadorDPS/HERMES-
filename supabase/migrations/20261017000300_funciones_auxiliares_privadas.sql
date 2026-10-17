-- Hermes — Las funciones auxiliares de seguridad pasan a un esquema privado.
-- Así las reglas de seguridad pueden usarlas, pero nadie puede llamarlas desde fuera
-- (Supabase avisaba de que eran invocables por /rest/v1/rpc).
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;

ALTER FUNCTION public.es_admin() SET SCHEMA private;
ALTER FUNCTION public.es_mi_producto(text) SET SCHEMA private;
ALTER FUNCTION public.es_mi_pedido(text) SET SCHEMA private;

REVOKE ALL ON FUNCTION private.es_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.es_mi_producto(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.es_mi_pedido(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.es_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION private.es_mi_producto(text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.es_mi_pedido(text) TO authenticated;

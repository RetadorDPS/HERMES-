-- Vincular con Retador (contrato 1.6), paso 1: los dos secretos de la aplicación, creados DENTRO de la base (nunca pasan por un chat ni por el repositorio).
--  · retador_cliente_secreto: identifica a esta aplicación frente a Retador (a Retador solo se le da su huella sha256).
--  · retador_avisos_secreto:  con él firma Retador sus avisos hacia esta aplicación.
-- Las funciones los leen con `leer_secreto_retador`, que solo puede ejecutar el servidor (clave de servicio).
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'retador_cliente_secreto') then
    perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'retador_cliente_secreto', 'Secreto de aplicación de DropshipPilot frente a Retador');
  end if;
  if not exists (select 1 from vault.secrets where name = 'retador_avisos_secreto') then
    perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'retador_avisos_secreto', 'Secreto con el que Retador firma sus avisos a DropshipPilot');
  end if;
end $$;

create or replace function public.leer_secreto_retador(p_nombre text)
returns text
language sql
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets
  where name = p_nombre and name in ('retador_cliente_secreto', 'retador_avisos_secreto');
$$;
revoke all on function public.leer_secreto_retador(text) from public, anon, authenticated;
grant execute on function public.leer_secreto_retador(text) to service_role;

-- La huella (no es secreta) es lo único que se le da a Retador:
select encode(sha256(convert_to(decrypted_secret, 'UTF8')), 'hex') as huella_sha256
from vault.decrypted_secrets where name = 'retador_cliente_secreto';

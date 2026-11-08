-- Personas «sin límite»: pueden importar, completar fichas y cotizar envíos sin tope de cupo (igual que el administrador) pero SIN ningún otro permiso de administrador.
-- Tabla privada: solo el administrador puede ver o cambiar quién está en ella (nadie puede ponérselo a sí mismo). Las funciones del servidor la leen con la clave de servicio.
create table if not exists public."UsuarioSinLimite" (
  "userId"   text primary key references public."User"(id) on update cascade on delete cascade,
  nota       text,
  "creadoEn" timestamp without time zone not null default now()
);
alter table public."UsuarioSinLimite" enable row level security;
revoke all on public."UsuarioSinLimite" from anon, authenticated;
grant select, insert, update, delete on public."UsuarioSinLimite" to authenticated;
drop policy if exists "sin_limite_solo_administrador" on public."UsuarioSinLimite";
create policy "sin_limite_solo_administrador" on public."UsuarioSinLimite" for all to authenticated using (public.es_admin()) with check (public.es_admin());

-- `consumir_cuota` respeta la marca: no cuenta nada para esa persona (misma función de antes, con una comprobación al principio).
create or replace function public.consumir_cuota(p_user text, p_tipo text, p_cantidad integer default 1)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan "PlanTier";
  v_lim public."PlanLimite"%rowtype;
  v_ahora timestamp := (now() at time zone 'utc');
  v_clave_v text;
  v_clave_d text;
  v_usado_v integer;
  v_usado_d integer;
begin
  if p_cantidad is null or p_cantidad < 1 or p_cantidad > 50 then
    return jsonb_build_object('permitido', false, 'motivo', 'cantidad');
  end if;
  select plan into v_plan from public."User" where id = p_user;
  if v_plan is null then
    return jsonb_build_object('permitido', false, 'motivo', 'usuario');
  end if;
  if exists (select 1 from public."UsuarioSinLimite" where "userId" = p_user) then
    return jsonb_build_object('permitido', true, 'plan', v_plan, 'sinLimite', true);
  end if;
  select * into v_lim from public."PlanLimite" where plan = v_plan and tipo = p_tipo;
  if not found then
    return jsonb_build_object('permitido', false, 'motivo', 'sin_limite');
  end if;
  v_clave_v := case v_lim.ventana when 'TOTAL' then 'T' else 'M:' || to_char(v_ahora, 'YYYY-MM') end;
  v_clave_d := 'D:' || to_char(v_ahora, 'YYYY-MM-DD');
  perform pg_advisory_xact_lock(hashtextextended(p_user || ':' || p_tipo, 0));
  select coalesce(max(usado), 0) into v_usado_v from public."UsoCuota" where "userId" = p_user and tipo = p_tipo and clave = v_clave_v;
  select coalesce(max(usado), 0) into v_usado_d from public."UsoCuota" where "userId" = p_user and tipo = p_tipo and clave = v_clave_d;
  if v_usado_d + p_cantidad > v_lim."limiteDia" then
    return jsonb_build_object('permitido', false, 'motivo', 'dia', 'plan', v_plan, 'usadoDia', v_usado_d, 'limiteDia', v_lim."limiteDia", 'usadoVentana', v_usado_v, 'limiteVentana', v_lim."limiteVentana", 'ventana', v_lim.ventana);
  end if;
  if v_usado_v + p_cantidad > v_lim."limiteVentana" then
    return jsonb_build_object('permitido', false, 'motivo', 'ventana', 'plan', v_plan, 'usadoDia', v_usado_d, 'limiteDia', v_lim."limiteDia", 'usadoVentana', v_usado_v, 'limiteVentana', v_lim."limiteVentana", 'ventana', v_lim.ventana);
  end if;
  insert into public."UsoCuota" ("userId", tipo, clave, usado) values (p_user, p_tipo, v_clave_v, p_cantidad)
    on conflict ("userId", tipo, clave) do update set usado = public."UsoCuota".usado + p_cantidad, "actualizadoEn" = now();
  insert into public."UsoCuota" ("userId", tipo, clave, usado) values (p_user, p_tipo, v_clave_d, p_cantidad)
    on conflict ("userId", tipo, clave) do update set usado = public."UsoCuota".usado + p_cantidad, "actualizadoEn" = now();
  return jsonb_build_object('permitido', true, 'plan', v_plan, 'usadoDia', v_usado_d + p_cantidad, 'limiteDia', v_lim."limiteDia", 'usadoVentana', v_usado_v + p_cantidad, 'limiteVentana', v_lim."limiteVentana", 'ventana', v_lim.ventana);
end;
$$;
revoke all on function public.consumir_cuota(text, text, integer) from public, anon, authenticated;
grant execute on function public.consumir_cuota(text, text, integer) to service_role;

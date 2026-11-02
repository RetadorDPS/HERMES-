-- Límites por plan (estrictos): cuántas veces al mes (y al día) puede cada usuario pedir él mismo «completar una ficha» o «cotizar el envío de un producto a un país».
-- Cada una de esas acciones gasta una llamada al proveedor (CJ o AliExpress), y el cupo de llamadas es compartido por todos los usuarios, así que se cuenta en el servidor.
-- Solo las funciones del servidor (clave de servicio) pueden gastar o devolver cupo; el usuario solo puede LEER su propio uso.

-- 1) Límites de cada plan. TRIAL cuenta «en total» (no se renueva); los demás, por mes natural (UTC). Además hay un tope diario.
create table if not exists public."PlanLimite" (
  plan            "PlanTier" not null,
  tipo            text not null check (tipo in ('FICHA', 'COTIZACION_ENVIO')),
  ventana         text not null check (ventana in ('MES', 'TOTAL')),
  "limiteVentana" integer not null check ("limiteVentana" >= 0),
  "limiteDia"     integer not null check ("limiteDia" >= 0),
  primary key (plan, tipo)
);
alter table public."PlanLimite" enable row level security;
drop policy if exists "PlanLimite_ver" on public."PlanLimite";
create policy "PlanLimite_ver" on public."PlanLimite" for select to authenticated using (true);
revoke all on public."PlanLimite" from anon;
revoke insert, update, delete on public."PlanLimite" from authenticated;

insert into public."PlanLimite" (plan, tipo, ventana, "limiteVentana", "limiteDia") values
  ('TRIAL',      'FICHA',            'TOTAL',   5,   2),
  ('TRIAL',      'COTIZACION_ENVIO', 'TOTAL',  10,   4),
  ('STARTER',    'FICHA',            'MES',    20,   5),
  ('STARTER',    'COTIZACION_ENVIO', 'MES',    60,  15),
  ('PRO',        'FICHA',            'MES',    80,  15),
  ('PRO',        'COTIZACION_ENVIO', 'MES',   300,  50),
  ('ENTERPRISE', 'FICHA',            'MES',   250,  40),
  ('ENTERPRISE', 'COTIZACION_ENVIO', 'MES',  1000, 150)
on conflict (plan, tipo) do update set ventana = excluded.ventana, "limiteVentana" = excluded."limiteVentana", "limiteDia" = excluded."limiteDia";

-- 2) Cuánto ha usado cada persona. `clave`: «T» (en total), «M:2026-11» (mes) o «D:2026-11-02» (día).
create table if not exists public."UsoCuota" (
  "userId"       text not null references public."User"(id) on update cascade on delete cascade,
  tipo           text not null check (tipo in ('FICHA', 'COTIZACION_ENVIO')),
  clave          text not null,
  usado          integer not null default 0 check (usado >= 0),
  "actualizadoEn" timestamp without time zone not null default now(),
  primary key ("userId", tipo, clave)
);
alter table public."UsoCuota" enable row level security;
drop policy if exists "UsoCuota_ver_propio" on public."UsoCuota";
create policy "UsoCuota_ver_propio" on public."UsoCuota" for select to authenticated using ("userId" = (select auth.uid())::text);
revoke all on public."UsoCuota" from anon;
revoke insert, update, delete on public."UsoCuota" from authenticated;

-- 3) Gastar cupo. Atómico (un bloqueo por persona y tipo) y todo-o-nada: si no cabe en el día o en el mes, no gasta nada y dice por qué.
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

-- 4) Devolver cupo cuando el proveedor falla (no es justo cobrarle al usuario una llamada que no funcionó).
create or replace function public.devolver_cuota(p_user text, p_tipo text, p_cantidad integer default 1)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ahora timestamp := (now() at time zone 'utc');
begin
  if p_cantidad is null or p_cantidad < 1 or p_cantidad > 50 then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user || ':' || p_tipo, 0));
  update public."UsoCuota" set usado = greatest(usado - p_cantidad, 0), "actualizadoEn" = now()
   where "userId" = p_user and tipo = p_tipo
     and clave in ('T', 'M:' || to_char(v_ahora, 'YYYY-MM'), 'D:' || to_char(v_ahora, 'YYYY-MM-DD'));
end;
$$;

revoke all on function public.consumir_cuota(text, text, integer) from public, anon, authenticated;
revoke all on function public.devolver_cuota(text, text, integer) from public, anon, authenticated;
grant execute on function public.consumir_cuota(text, text, integer) to service_role;
grant execute on function public.devolver_cuota(text, text, integer) to service_role;

-- 5) Presupuesto por proveedor (fase 2): cuántas llamadas se hacen cada día a CJ y a AliExpress en TOTAL entre todos los usuarios.
-- Sirve para medir los límites reales y para frenar lo no urgente antes de que el proveedor nos corte. `tope` vacío = aún sin medir (solo se cuenta).
create table if not exists public."UsoProveedorDia" (
  proveedor  text not null check (proveedor in ('CJ_DROPSHIPPING', 'ALIEXPRESS')),
  dia        date not null,
  llamadas   integer not null default 0 check (llamadas >= 0),
  rechazos   integer not null default 0 check (rechazos >= 0),
  tope       integer check (tope is null or tope >= 0),
  primary key (proveedor, dia)
);
alter table public."UsoProveedorDia" enable row level security;
revoke all on public."UsoProveedorDia" from anon, authenticated;

create or replace function public.contar_llamada_proveedor(p_proveedor text, p_rechazada boolean default false)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public."UsoProveedorDia" (proveedor, dia, llamadas, rechazos)
  values (p_proveedor, (now() at time zone 'utc')::date, 1, case when p_rechazada then 1 else 0 end)
  on conflict (proveedor, dia) do update set llamadas = public."UsoProveedorDia".llamadas + 1, rechazos = public."UsoProveedorDia".rechazos + (case when p_rechazada then 1 else 0 end);
$$;
revoke all on function public.contar_llamada_proveedor(text, boolean) from public, anon, authenticated;
grant execute on function public.contar_llamada_proveedor(text, boolean) to service_role;

-- 6) Turno por proveedor: nunca dos consultas a la vez contra el mismo proveedor (el turno caduca solo por si algo falla).
create table if not exists public."TurnoProveedor" (
  proveedor text primary key check (proveedor in ('CJ_DROPSHIPPING', 'ALIEXPRESS')),
  hasta     timestamp without time zone not null default now()
);
alter table public."TurnoProveedor" enable row level security;
revoke all on public."TurnoProveedor" from anon, authenticated;
insert into public."TurnoProveedor" (proveedor, hasta) values ('CJ_DROPSHIPPING', now() - interval '1 minute'), ('ALIEXPRESS', now() - interval '1 minute') on conflict (proveedor) do nothing;

create or replace function public.tomar_turno_proveedor(p_proveedor text, p_segundos integer default 120)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_filas integer;
begin
  update public."TurnoProveedor" set hasta = now() + make_interval(secs => greatest(least(p_segundos, 300), 5))
   where proveedor = p_proveedor and hasta <= now();
  get diagnostics v_filas = row_count;
  return v_filas = 1;
end;
$$;

create or replace function public.soltar_turno_proveedor(p_proveedor text)
returns void
language sql
security definer
set search_path = public
as $$
  update public."TurnoProveedor" set hasta = now() - interval '1 second' where proveedor = p_proveedor;
$$;
revoke all on function public.tomar_turno_proveedor(text, integer) from public, anon, authenticated;
revoke all on function public.soltar_turno_proveedor(text) from public, anon, authenticated;
grant execute on function public.tomar_turno_proveedor(text, integer) to service_role;
grant execute on function public.soltar_turno_proveedor(text) to service_role;

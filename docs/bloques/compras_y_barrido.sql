-- BLOQUE ÚNICO «todo o nada» para pegar en el editor SQL de Supabase (proyecto zucoorfalpylffustiax).
-- Crea las tablas de compras y programa el barrido de pedidos. Al final devuelve una fila con las comprobaciones.
begin;
create table if not exists public."ConfigCompras" (
  "userId"        text primary key references public."User"(id) on update cascade on delete cascade,
  modo            text not null default 'SIMULACION' check (modo in ('APAGADO', 'SIMULACION', 'MANUAL', 'AUTOMATICO')),
  "limitePedidoUsd" numeric(12,2) not null default 50  check ("limitePedidoUsd" >= 0),
  "limiteDiaUsd"    numeric(12,2) not null default 200 check ("limiteDiaUsd" >= 0),
  "subidaMaxPct"    numeric(5,2)  not null default 10  check ("subidaMaxPct" >= 0),
  "actualizadoEn" timestamp without time zone not null default now()
);
alter table public."ConfigCompras" enable row level security;
drop policy if exists "ConfigCompras_ver_propia" on public."ConfigCompras";
create policy "ConfigCompras_ver_propia" on public."ConfigCompras" for select to authenticated using ("userId" = (select auth.uid())::text);
revoke all on public."ConfigCompras" from anon;
revoke insert, update, delete on public."ConfigCompras" from authenticated;

create table if not exists public."CompraProveedor" (
  id              text primary key default (gen_random_uuid())::text,
  "orderId"       text not null references public."Order"(id) on update cascade on delete cascade,
  "userId"        text not null references public."User"(id) on update cascade on delete cascade,
  proveedor       text not null check (proveedor in ('CJ_DROPSHIPPING', 'ALIEXPRESS')),
  modo            text not null check (modo in ('SIMULACION', 'MANUAL', 'AUTOMATICO')),
  estado          text not null check (estado in ('SIMULADA', 'EN_CURSO', 'CREADA', 'COMPRADA', 'ERROR', 'CANCELADA')),
  "costeUsd"      numeric(12,2),
  "proveedorPedidoId" text,
  mensaje         text,
  "creadoEn"      timestamp without time zone not null default now()
);
create unique index if not exists "CompraProveedor_una_real" on public."CompraProveedor" ("orderId", proveedor) where estado in ('EN_CURSO', 'CREADA', 'COMPRADA');
create index if not exists "CompraProveedor_user_fecha" on public."CompraProveedor" ("userId", "creadoEn");
alter table public."CompraProveedor" enable row level security;
drop policy if exists "CompraProveedor_ver_propia" on public."CompraProveedor";
create policy "CompraProveedor_ver_propia" on public."CompraProveedor" for select to authenticated using ("userId" = (select auth.uid())::text);
revoke all on public."CompraProveedor" from anon;
revoke insert, update, delete on public."CompraProveedor" from authenticated;
-- Barrido programado de los pedidos de Retador: cada 5 minutos llama a `pedidos-barrido` con la misma clave del almacén de secretos que usa el monitor.
select cron.schedule(
  'pedidos-barrido',
  '*/5 * * * *',
  $cron$ select net.http_post(
    url := 'https://zucoorfalpylffustiax.supabase.co/functions/v1/pedidos-barrido',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-monitor-secreto', (select decrypted_secret from vault.decrypted_secrets where name = 'monitor_secreto')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) $cron$
);
commit;
select
  to_regclass('public."ConfigCompras"') is not null as tabla_config,
  to_regclass('public."CompraProveedor"') is not null as tabla_compras,
  (select count(*) from pg_indexes where indexname = 'CompraProveedor_una_real') = 1 as indice_unico,
  (select count(*) from pg_policies where tablename in ('ConfigCompras','CompraProveedor')) = 2 as dos_politicas,
  (select count(*) from cron.job where jobname = 'pedidos-barrido') = 1 as barrido_programado,
  (select count(*) from vault.decrypted_secrets where name = 'monitor_secreto') = 1 as secreto_del_barrido;

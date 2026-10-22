-- Tablas de las compras al proveedor (pedidos de Retador, docs/contrato-pedidos.md). Pendiente de aplicar: la herramienta de la base pidió permiso para crear tablas y políticas.
-- 2) Qué hace DropshipPilot con los pedidos pagados. Por defecto NO compra nada (SIMULACION). Solo la función del servidor la modifica.
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

-- 3) Registro de cada intento de compra (nunca se borra): sirve para no comprar dos veces y para saber qué pasó.
create table if not exists public."CompraProveedor" (
  id              text primary key default (gen_random_uuid())::text,
  "orderId"       text not null references public."Order"(id) on update cascade on delete cascade,
  "userId"        text not null references public."User"(id) on update cascade on delete cascade,
  proveedor       text not null check (proveedor in ('CJ_DROPSHIPPING', 'ALIEXPRESS')),
  modo            text not null check (modo in ('SIMULACION', 'MANUAL', 'AUTOMATICO')),
  estado          text not null check (estado in ('SIMULADA', 'EN_CURSO', 'COMPRADA', 'ERROR', 'CANCELADA')),
  "costeUsd"      numeric(12,2),
  "proveedorPedidoId" text,
  mensaje         text,
  "creadoEn"      timestamp without time zone not null default now()
);
-- Una compra real (en curso o hecha) por pedido y proveedor: impide comprar dos veces aunque se pulse dos veces o fallen los reintentos.
create unique index if not exists "CompraProveedor_una_real" on public."CompraProveedor" ("orderId", proveedor) where estado in ('EN_CURSO', 'COMPRADA');
create index if not exists "CompraProveedor_user_fecha" on public."CompraProveedor" ("userId", "creadoEn");
alter table public."CompraProveedor" enable row level security;
drop policy if exists "CompraProveedor_ver_propia" on public."CompraProveedor";
create policy "CompraProveedor_ver_propia" on public."CompraProveedor" for select to authenticated using ("userId" = (select auth.uid())::text);
revoke all on public."CompraProveedor" from anon;
revoke insert, update, delete on public."CompraProveedor" from authenticated;

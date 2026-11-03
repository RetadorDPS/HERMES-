-- Vincular con Retador (contrato 1.6), paso 2: tablas privadas de la vinculación y de los avisos, y los datos del plan.
-- Requiere haber pegado antes `20261103000150_secretos_vinculo.sql`.

-- 1) Vinculaciones en curso. Dos usos: el `state` de un solo uso (empieza aquí, 10 min) y la respuesta de Retador guardada CIFRADA
--    hasta que la persona confirme (empieza en Retador, 15 min). Solo las funciones del servidor la tocan: sin políticas, nadie la lee desde el navegador.
create table if not exists public."VinculoRetador" (
  id             uuid primary key default gen_random_uuid(),
  "userId"       text not null references public."User"(id) on update cascade on delete cascade,
  tipo           text not null check (tipo in ('A', 'B')),
  "stateHash"    text,
  "respuestaEnc" text,
  "emailRetador" text,
  "creadoEn"     timestamp without time zone not null default now(),
  "venceEn"      timestamp without time zone not null,
  "usadoEn"      timestamp without time zone
);
create unique index if not exists "VinculoRetador_stateHash_key" on public."VinculoRetador" ("stateHash") where "stateHash" is not null;
create index if not exists "VinculoRetador_userId_idx" on public."VinculoRetador" ("userId");
alter table public."VinculoRetador" enable row level security;
revoke all on public."VinculoRetador" from anon, authenticated;

-- 2) Avisos recibidos de Retador (para no procesar dos veces el mismo `id`). Tampoco se lee desde el navegador.
create table if not exists public."AvisoRetador" (
  id            text primary key,
  tipo          text not null,
  "vendedorId"  text,
  "recibidoEn"  timestamp without time zone not null default now(),
  "procesadoEn" timestamp without time zone,
  error         text
);
alter table public."AvisoRetador" enable row level security;
revoke all on public."AvisoRetador" from anon, authenticated;

-- 3) Plan: de dónde viene (propio o de Retador, plan conjunto) y si la persona ya eligió plan. Quien ya existe se da por «ya eligió».
alter table public."User" add column if not exists "planOrigen" text not null default 'PROPIO' check ("planOrigen" in ('PROPIO', 'RETADOR'));
alter table public."User" add column if not exists "planElegidoEn" timestamp without time zone;
update public."User" set "planElegidoEn" = coalesce("createdAt", now()) where "planElegidoEn" is null;
-- La persona puede LEER estas dos columnas de su ficha (para saber si debe elegir plan y de dónde viene el suyo), pero no cambiarlas: solo las cambia el servidor.
grant select ("planOrigen", "planElegidoEn") on public."User" to authenticated;

-- Importar por enlace: registro de cada importación pedida por un usuario.
-- Sirve para tres cosas: limitar cuántas puede pedir cada persona al día (las llamadas al proveedor gastan la cuota
-- de la plataforma), no lanzar dos a la vez contra el mismo proveedor, y saber qué falló.
-- Tabla privada: sin políticas ni permisos para clientes; solo la lee y escribe la función `importar-enlace`.
create table if not exists "ImportacionEnlace" (
  id uuid primary key default gen_random_uuid(),
  "userId" text not null,
  provider text not null,
  "externalId" text not null,
  estado text not null default 'en_curso' check (estado in ('en_curso', 'ok', 'error', 'sin_llamada')),
  mensaje text,
  "createdAt" timestamp without time zone not null default current_timestamp,
  "updatedAt" timestamp without time zone not null default current_timestamp
);
create index if not exists "ImportacionEnlace_usuario_fecha" on "ImportacionEnlace" ("userId", "createdAt");
create index if not exists "ImportacionEnlace_proveedor_estado_fecha" on "ImportacionEnlace" (provider, estado, "createdAt");
alter table "ImportacionEnlace" enable row level security;
revoke all on "ImportacionEnlace" from anon, authenticated;
comment on table "ImportacionEnlace" is 'Importaciones por enlace (límite diario y exclusión mutua por proveedor). Privada.';

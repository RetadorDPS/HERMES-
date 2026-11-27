-- Buscador en vivo de CJ y AliExpress para todos los usuarios, con límite por plan.
-- Cada búsqueda (una página de resultados) gasta 1 del cupo BUSQUEDA. Una búsqueda repetida en 24 h sale de la caché y no gasta.

alter table public."PlanLimite" drop constraint if exists "PlanLimite_tipo_check";
alter table public."PlanLimite" add constraint "PlanLimite_tipo_check" check (tipo = any (array['FICHA', 'COTIZACION_ENVIO', 'BUSQUEDA']));
alter table public."UsoCuota" drop constraint if exists "UsoCuota_tipo_check";
alter table public."UsoCuota" add constraint "UsoCuota_tipo_check" check (tipo = any (array['FICHA', 'COTIZACION_ENVIO', 'BUSQUEDA']));

insert into public."PlanLimite" (plan, tipo, ventana, "limiteVentana", "limiteDia") values
  ('TRIAL', 'BUSQUEDA', 'MES', 60, 15),
  ('STARTER', 'BUSQUEDA', 'MES', 300, 30),
  ('PRO', 'BUSQUEDA', 'MES', 1000, 80),
  ('ENTERPRISE', 'BUSQUEDA', 'MES', 3000, 200)
on conflict (plan, tipo) do update set ventana = excluded.ventana, "limiteVentana" = excluded."limiteVentana", "limiteDia" = excluded."limiteDia";

-- Caché privada de búsquedas (sin políticas: solo la lee y escribe el servidor)
create table if not exists public."BusquedaProveedor" (
  proveedor text not null,
  clave text not null,
  respuesta jsonb not null,
  "creadoEn" timestamptz not null default now(),
  primary key (proveedor, clave)
);
alter table public."BusquedaProveedor" enable row level security;
create index if not exists "BusquedaProveedor_creadoEn" on public."BusquedaProveedor" ("creadoEn");

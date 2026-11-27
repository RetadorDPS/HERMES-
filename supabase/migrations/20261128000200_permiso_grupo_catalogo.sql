-- v81: la columna «grupo» (v78) no tenía permiso de lectura para los usuarios. La tabla da permisos columna por columna
-- y catalogo_resumen() (security invoker) la lee, así que el catálogo fallaba con «permission denied for table CatalogItem».
-- Comprobado después con el papel «authenticated» (no con el dueño de la base, que no tiene esa restricción).
grant select ("grupo") on public."CatalogItem" to authenticated;

-- Pedidos de Retador (contrato docs/contrato-pedidos.md) y configuración de las compras al proveedor.
-- 1) Un pedido de Retador solo puede existir una vez por tienda (clave para no duplicar al sincronizar ni al comprar).
create unique index if not exists "Order_storeId_storeOrderId_key" on public."Order" ("storeId", "storeOrderId");

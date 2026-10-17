# Base de datos de Hermes (Supabase)

Proyecto: **DropshipPilot** · referencia `zucoorfalpylffustiax` · región `eu-west-1` (Irlanda).

## Migraciones (en orden)

| Archivo | Qué hace |
|---|---|
| `20261017000100_esquema_base.sql` | Las 21 tablas, enumerados, índices y relaciones (generado desde `prisma/schema.prisma`). |
| `20261017000200_seguridad.sql` | Seguridad por fila (RLS), permisos por columna, alta automática de la ficha del cliente. |
| `20261017000300_funciones_auxiliares_privadas.sql` | Mueve las funciones auxiliares a un esquema privado. |

Para repetirlas en otro proyecto, aplicarlas en ese orden.

## Reglas de seguridad (resumen)

1. Sin sesión no se ve nada (el rol `anon` no tiene permisos).
2. Cada cliente solo ve y toca lo suyo.
3. Las claves y secretos (`...Enc`, contraseñas, tokens) no se pueden leer desde el navegador.
4. El cliente no puede cambiarse el rol ni el plan.
5. `VerificationToken`, `WebhookEvent`, `ShippingQuote` y `PlatformCredential` son solo del servidor
   (Supabase avisa de «RLS sin reglas» en ellas: es intencionado).

## Verificado (17/17)

Prueba con dos clientes de mentira, deshecha al terminar: el cliente B no ve ni edita lo del A, no puede
cambiarse el rol ni el plan, no lee `passwordHash`, tokens de tiendas ni claves de plataforma, no crea
productos directamente, y un visitante sin sesión no lee nada.

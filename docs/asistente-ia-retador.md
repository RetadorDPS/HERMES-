# Asistente de IA: buscar, importar y publicar desde el chat (evaluación, 28/11/2026)

Idea de Daniel: que el asistente de IA conectado a Retador (el MCP de Retador, el mismo que usa Claude) pueda, cuando el
vendedor se lo pida, buscar productos en DropshipPilot o en internet, traerlos al catálogo de DropshipPilot con sus
variantes y su envío según lo que diga el vendedor, y publicarlos en su tienda de Retador «en un solo movimiento».

## 1. Qué hay hoy (comprobado el 28/11/2026)

- El MCP de Retador tiene unas 90 herramientas, todas de la tienda del propio vendedor: productos, stock, pedidos, diseño
  de la tienda, fotos, Facebook… Las que cambian algo piden permiso en el chat («¿Permitir?») o con un enlace de
  aprobación en la app de Retador, y algunas van por plan (`retador_mis_permisos` lo dice).
- **Ninguna habla con DropshipPilot ni con CJ o AliExpress.** La única cercana es `retador_cotizar_envio`, que solo vale
  para productos de proveedor que YA están en Retador.
- DropshipPilot ya tiene todas las piezas que harían falta, con los límites del plan aplicados en el servidor:
  - buscar en CJ y AliExpress (`acciones-usuario`, acción `buscar_proveedor`);
  - añadir al catálogo con ficha y envío (`importar-enlace`, también con un enlace de AliExpress o CJ encontrado en internet);
  - cotizar envíos (`cotizar_envio`);
  - preparar y publicar en Retador (`retador-tienda`, acciones `preparar` y `publicar`), con las mismas comprobaciones de
    precio mínimo, stock y código que la pantalla.
- Las cuentas ya están vinculadas: DropshipPilot guarda el `vendedorId` de Retador de cada vendedor vinculado, y ya hay
  un canal firmado entre los dos (avisos de Retador y llamadas con el secreto de cliente).

## 2. Veredicto

**Sí, es viable y vale la pena.** No hay que inventar nada nuevo en la parte de proveedores: es dar al asistente una
puerta a lo que DropshipPilot ya hace, con los mismos límites y comprobaciones. Lo que falta es:

1. **En DropshipPilot**, una función nueva de entrada para el asistente (`asistente-retador`), que:
   - solo acepte llamadas FIRMADAS por el servidor de Retador (no del navegador ni del chat), con el `vendedorId`;
   - encuentre al usuario de DropshipPilot vinculado a ese vendedor (si no está vinculado, lo dice y no hace nada);
   - pase por las mismas funciones de siempre como ese usuario (buscar, añadir, cotizar, preparar, publicar), así que
     gasta su cupo del plan y respeta su «a la vez», su precio mínimo, el stock obligatorio y el turno con cada proveedor;
   - lleve al servidor las cuentas de `src/lib/retador/plan-publicacion.ts` (hoy solo están en la pantalla), para que el
     asistente proponga exactamente lo mismo que la pantalla.
2. **En Retador**, las herramientas nuevas del MCP (las escribe el equipo o el Claude de Retador), que llaman a esa función:

| Herramienta | Tipo | Qué hace | Gasta del plan |
|---|---|---|---|
| `dropship_buscar` | lectura | Busca en AliExpress o CJ por palabras (lo mismo que «Buscar en proveedores») | 1 búsqueda |
| `dropship_mi_catalogo` | lectura | Lista el catálogo de DropshipPilot por categoría sencilla o texto | no |
| `dropship_ver_producto` | lectura | Ficha con variantes, stock, envío cotizado y lo que le quedaría por variante | no |
| `dropship_añadir` | escritura | Añade al catálogo desde un resultado o un enlace de AliExpress/CJ (también uno encontrado en internet) | 1 producto añadido |
| `dropship_cotizar_envio` | escritura | Cotiza el envío a los países que diga el vendedor | 1 por país nuevo |
| `dropship_preparar_publicacion` | lectura | Propuesta completa: variantes, precios, «te quedan», categoría | no |
| `dropship_publicar` | escritura | Publica lo preparado (con «¿Permitir?») | no (Retador cuenta sus productos) |
| `dropship_importar_y_publicar` | escritura | **El «solo movimiento»**: enlace o resultado → añadir → cotizar → preparar → una sola tarjeta de aprobación → publicar | lo de cada paso |

## 3. Cómo sería «el solo movimiento»

El vendedor escribe, por ejemplo: «Búscame unas zapatillas de running de hombre que se vendan bien, súbelas a mi tienda en
negro y blanco, tallas 40 a 44, y que el envío a Cuba vaya incluido».

1. El asistente busca con `dropship_buscar` (o en internet con su propio buscador y encuentra el enlace de AliExpress).
2. Llama a `dropship_importar_y_publicar` con el enlace y las indicaciones (colores, tallas, países).
3. DropshipPilot añade el producto, cotiza el envío, elige SOLO las variantes con stock que encajan con lo pedido, pone el
   precio de la regla del vendedor (nunca bajo el mínimo de Retador) y devuelve la propuesta.
4. Retador enseña una tarjeta: fotos, variantes, precio, «te quedan» y categoría. El vendedor pulsa «Permitir».
5. Se publica. Si algo no se puede (sin stock, sin variantes para dropshipping, límite del plan), se dice por qué y no se
   publica nada a medias.

## 4. Riesgos y cómo se controlan

- **Gastar el cupo sin querer.** Un asistente puede pedir muchas cosas seguidas. Lo frena el plan (búsquedas, productos
  añadidos y «a la vez» ya van por plan desde v80) y cada paso que gasta pide permiso o lo pidió el vendedor explícitamente.
- **Precios de internet.** El precio que el asistente vea en la web de AliExpress no es el coste: el coste siempre sale de
  la API (regla de la casa). El asistente solo usa la web para encontrar el ENLACE.
- **Productos que no se pueden revender.** Muchos de AliExpress no están para dropshipping (por ejemplo, el Poco F7 Pro): la
  herramienta lo dice y propone parecidos, como ya hace el buscador.
- **Llamadas en paralelo a CJ y AliExpress.** Si el asistente pide 10 a la vez, la función los hace de uno en uno (ya hay
  turno por proveedor) y avisa del progreso.
- **Seguridad.** La función solo acepta llamadas firmadas del servidor de Retador; nunca recibe claves de proveedor ni
  devuelve el coste a nadie que no sea el vendedor; lo que venga de terceros (títulos, descripciones) se marca como dato,
  nunca como instrucción para el asistente.
- **Pruebas.** Todo se puede probar antes con el Retador simulado (`retador-simulado`) sin tocar tiendas reales.

## 5. Plan de trabajo propuesto

1. **Fase 1 (lectura y añadir):** función `asistente-retador` con buscar, catálogo, ver producto y añadir; contrato en
   `docs/contrato-retador.md`; en Retador las 4 herramientas. Probar con la cuenta de Daniel.
2. **Fase 2 (publicar):** preparar y publicar con «¿Permitir?», con las cuentas de `plan-publicacion.ts` en el servidor.
3. **Fase 3 (un solo movimiento):** `dropship_importar_y_publicar` con indicaciones de variantes y países, y envío
   incluido por país (contrato 1.8).

Esfuerzo estimado: la parte de DropshipPilot, una función nueva y el contrato (2 o 3 sesiones de trabajo). La parte de
Retador la hace su equipo (las herramientas del MCP y la tarjeta de aprobación). No cambia ningún precio ni ninguna regla
de dinero: todo pasa por las mismas comprobaciones que la pantalla.

Lo que NO se sabe todavía y hay que confirmar con Retador: si su MCP puede llamar a un servicio externo firmado (como ya
hace con los avisos) y quién paga el uso de la IA (si es el Claude del propio vendedor conectado al MCP, no cuesta nada a
la plataforma).

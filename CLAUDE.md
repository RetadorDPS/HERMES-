# CLAUDE.md — Hermes (DropshipPilot)

## Regla de idioma (obligatoria)

Todo el trabajo en este repositorio va en **ESPAÑOL**: respuestas, comentarios del código, mensajes de commit,
textos visibles en la app y documentación. Solo se conservan en su idioma original los nombres de funciones,
variables, tablas e identificadores técnicos que ya existen. El dueño del proyecto no habla inglés.

## Cómo está publicada la app

- **Versión estática (GitHub Pages):** solo pantallas, con datos de ejemplo. Se construye con
  `node scripts/estatico/construir.mjs` (variable `RUTA_BASE` = subcarpeta del repositorio). Se publica sola al
  hacer push a `main` (`.github/workflows/pages.yml`). Las llamadas `/api/*` las contesta el navegador con
  `src/lib/simulador-api.ts`; nada se guarda.
- **App completa (Next.js + servidor):** es la que se conectará a Supabase. Cualquier cambio de pantallas debe
  funcionar en las dos versiones.
- Rutas y recursos propios: usar `conBase()` de `src/lib/ruta.ts` para rutas absolutas planas (imágenes, `<a href>`),
  y `<Link>` de Next para navegar. Nunca escribir `/ruta` a pelo en un enlace plano.

## Reglas de trabajo

- Nunca inventar datos. Si algo no se puede verificar, se dice.
- Reportar siempre qué se verificó en la app real, qué solo en datos y qué no se pudo verificar.
- Nada de pruebas masivas ni en paralelo contra APIs externas (CJ, AliExpress): en serie, con pausa y lo mínimo.
- El costo real del proveedor nunca lo ve un vendedor ni un comprador (solo el administrador).
- Arreglos en el sistema, nunca parches a un producto concreto.
- Las pantallas deben verse bien en ordenador, Android y Apple (comprobar siempre con ancho de móvil de 390 px).

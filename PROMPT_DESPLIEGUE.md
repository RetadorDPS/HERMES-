# 🤖 Prompt para Claude Code (copiar y pegar)

Pega el bloque de abajo en Claude Code **desde la carpeta del proyecto**. Sustituye
lo que va entre `<>`. El despliegue completo es un solo comando y el script ya está escrito:
Claude Code sólo tiene que ejecutarlo y resolver lo que falte.

---

## Versión automática (recomendada)

```
Tengo en esta carpeta un proyecto Next.js 14 + PostgreSQL + Redis + FastAPI (DropshipPilot,
clon de AutoDS) y quiero desplegarlo en mi servidor <usuario@IP> con el dominio
<tudominio.com> (ya apunta por DNS a ese servidor).

El despliegue es automático y ya está preparado en el repo:
- `./scripts/deploy.sh` → genera `.env.prod` con secretos aleatorios, comprueba DNS y
  puertos, construye y levanta TODO con HTTPS de Let's Encrypt y renovación automática.
- `docker-compose.prod.yml` → 9 servicios: nginx-proxy, acme, web, worker (BullMQ 24/7),
  scraper (Playwright), db, redis, migrate (esquema Prisma) y backup (pg_dump diario).
- `DEPLOY.md` → guía completa con checklist de verificación.

Lo que necesito que hagas:
1. Comprueba que el servidor tiene Docker + Docker Compose v2 (instálalos si no).
2. Sube el proyecto con rsync/scp (o git clone) a /opt/autods-clone.
   IMPORTANTE: NO subas ni copies `.env.local` (es de desarrollo); el script lo aparta
   solo, pero mejor no enviarlo.
3. Ejecuta `./scripts/deploy.sh` en el servidor. Te pedirá dominio, email de Let's Encrypt
   y las credenciales del panel (<tu@email> y una contraseña larga que yo te doy).
4. Verifica que `https://<tudominio.com>/api/health` responde mode=production con postgres,
   redis y scraper en verde, y que `/login` sólo acepta MIS credenciales (las de demo
   están bloqueadas a propósito).
5. Comprueba que el worker está procesando (logs) y que el certificado se emitió.
6. Explícame cómo actualizar (`./scripts/deploy.sh --actualizar`), cómo ver el estado
   (`--estado`), cómo ver logs y cómo restaurar una copia de seguridad.

No modifiques la lógica de negocio ni el esquema de datos: sólo infraestructura.
Si algo falla (DNS, puerto ocupado, certificado), diagnostícalo y dime exactamente qué
falta, sin inventar pasos que no hayas comprobado.
```

---

## Versión sin Docker (procesos nativos + systemd)

```
Tengo en esta carpeta un proyecto Next.js 14 + PostgreSQL + Redis + FastAPI (DropshipPilot)
y quiero desplegarlo SIN Docker en <usuario@IP> con el dominio <tudominio.com>, siguiendo
la sección "Modo manual" de `DEPLOY.md`.

Resumen: Node 20+, Python 3.11+, PostgreSQL 15+ y Redis 7+; `npm ci && npx prisma db push &&
npm run build`; venv del scraper con `playwright install --with-deps chromium`; tres servicios
systemd (web = `npm run start`, worker = `npm run worker`, scraper = uvicorn en 127.0.0.1:8000);
Nginx como reverse proxy + `certbot --nginx`; `.env` de producción con ENCRYPTION_KEY,
NEXTAUTH_SECRET, NEXTAUTH_URL=https://<tudominio.com>, AUTH_ENABLED=true, AUTH_EMAIL,
AUTH_PASSWORD y ALLOW_IFRAME_EMBED=false.

Al final verifica /api/health y /login, y explícame cómo ver logs y actualizar.
No toques la lógica de la aplicación.
```

---

## Después del despliegue: 3 cosas que sólo puedes hacer tú

1. **Conectar tu tienda real** (página *Tiendas*): token de Shopify o claves de WooCommerce.
   La app valida contra la API real y registra los webhooks automáticamente.
2. **Proxies residenciales o APIs oficiales** (página *Proxies y anti-bot*): sin esto el
   importador funciona, pero avisa de que los datos son de demostración. Añade
   `PROXY_USERNAME`/`PROXY_PASSWORD` a `.env.prod` y ejecuta `./scripts/deploy.sh --actualizar`.
3. **Stripe** (opcional): sólo si vas a cobrar suscripciones a terceros con esta instalación.

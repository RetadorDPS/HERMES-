#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/start-everything.sh — Levanta TODO de una vez y te dice dónde mirar.
#
#   ./scripts/start-everything.sh            # arranca lo que falte y resume el estado
#   ./scripts/start-everything.sh --rebuild  # además recompila la web (next build)
#
# Orden: PostgreSQL → Redis → microservicio de scraping → web (Next.js) →
# workers 24/7. Es idempotente: lo que ya esté escuchando no se toca.
# Registros en ./logs/*.log · PIDs en ./logs/*.pid
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

REBUILD=0
[[ "${1:-}" == "--rebuild" ]] && REBUILD=1

mkdir -p logs
GREEN=$'\e[32m'; RED=$'\e[31m'; YELLOW=$'\e[33m'; BOLD=$'\e[1m'; OFF=$'\e[0m'
ok()   { printf '%s✔%s %s\n' "$GREEN" "$OFF" "$1"; }
bad()  { printf '%s✘%s %s\n' "$RED" "$OFF" "$1"; }
warn() { printf '%s▲%s %s\n' "$YELLOW" "$OFF" "$1"; }

listening() { # puerto
  (command -v ss >/dev/null && ss -ltn "sport = :$1" 2>/dev/null | grep -q LISTEN) ||
  (command -v lsof >/dev/null && lsof -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1) ||
  (command -v nc >/dev/null && nc -z 127.0.0.1 "$1" >/dev/null 2>&1)
}

wait_port() { # puerto segundos etiqueta
  for _ in $(seq 1 "$2"); do listening "$1" && return 0; sleep 1; done
  return 1
}

printf '\n%sDropshipPilot — puesta en marcha completa%s\n\n' "$BOLD" "$OFF"

# ── 0. Requisitos ────────────────────────────────────────────────────────────
[[ -f .env.local ]] || { [[ -f .env ]] && cp .env .env.local || cp .env.example .env.local; warn '.env.local creado desde la plantilla: revisa DATABASE_URL, REDIS_URL y ENCRYPTION_KEY'; }
[[ -d node_modules ]] || { warn 'Instalando dependencias (npm install)…'; npm install --no-audit --no-fund >logs/npm-install.log 2>&1 || { bad 'npm install falló (ver logs/npm-install.log)'; exit 1; }; }
ok 'Dependencias de Node presentes'

set -a; . ./.env.local; set +a   # DATABASE_URL, REDIS_URL, SCRAPER_*

# ── 1. PostgreSQL ────────────────────────────────────────────────────────────
if listening 5432; then
  ok 'PostgreSQL escuchando en :5432'
else
  if command -v pg_ctlcluster >/dev/null; then
    sudo pg_ctlcluster "$(ls /etc/postgresql | head -1)" main start >logs/postgres.log 2>&1 || true
    wait_port 5432 20 && ok 'PostgreSQL arrancado (:5432)' || { bad 'No he podido arrancar PostgreSQL (¿está instalado? sudo apt-get install postgresql)'; }
  else
    bad 'PostgreSQL no está instalado en este entorno (sudo apt-get install postgresql)'
  fi
fi

# ── 2. Redis ─────────────────────────────────────────────────────────────────
if listening 6379; then
  ok 'Redis escuchando en :6379'
elif command -v redis-server >/dev/null; then
  (sudo redis-server --daemonize yes --save '' --bind 0.0.0.0 >logs/redis.log 2>&1 || redis-server --daemonize yes --save '' >logs/redis.log 2>&1 || true)
  wait_port 6379 10 && ok 'Redis arrancado (:6379)' || bad 'No he podido arrancar Redis (sudo apt-get install redis-server)'
else
  bad 'Redis no está instalado (sudo apt-get install redis-server)'
fi

# ── 3. Esquema de base de datos ──────────────────────────────────────────────
if [[ -n "${DATABASE_URL:-}" ]]; then
  if npx prisma db push --skip-generate --accept-data-loss >logs/prisma-push.log 2>&1; then
    ok 'Esquema de base de datos al día (prisma db push)'
  else
    bad 'prisma db push falló (ver logs/prisma-push.log)'
  fi
  npx prisma generate >logs/prisma-generate.log 2>&1 && ok 'Cliente de Prisma generado' || warn 'prisma generate con avisos (ver logs/prisma-generate.log)'
  npx tsx scripts/seed-if-empty.ts >logs/seed.log 2>&1 && ok 'Datos de ejemplo cargados (si hacían falta)' || warn 'El sembrado de datos falló (ver logs/seed.log)'
else
  warn 'Sin DATABASE_URL: la app arrancará en modo demo (memoria), sin persistencia'
fi

# ── 4. Microservicio de scraping (Playwright) ────────────────────────────────
SCRA_PORT=8000
if listening "$SCRA_PORT"; then
  ok "Microservicio de scraping escuchando en :$SCRA_PORT"
elif [[ -x services/scraper/.venv/bin/python ]]; then
  (cd services/scraper && exec ./.venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port "$SCRA_PORT" --no-access-log) >logs/scraper.log 2>&1 &
  echo $! > logs/scraper.pid
  wait_port "$SCRA_PORT" 25 && ok "Microservicio de scraping arrancado (:$SCRA_PORT)" || warn 'El scraper no respondió; la extracción caerá a modo local/demo'
else
  warn 'Sin entorno de Python del scraper: ejecuta (cd services/scraper && python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt && ./.venv/bin/playwright install chromium)'
fi

# ── 5. Web (Next.js) ─────────────────────────────────────────────────────────
[[ $REBUILD -eq 1 || ! -d .next ]] && { warn 'Compilando la web (next build)…'; npx next build >logs/build.log 2>&1 || { bad 'La compilación falló (ver logs/build.log)'; exit 1; }; }
if listening 3000; then
  ok 'Web escuchando en :3000'
else
  nohup npm run start >logs/web.log 2>&1 &
  echo $! > logs/web.pid
  wait_port 3000 45 && ok 'Web arrancada (:3000)' || bad 'La web no arrancó (ver logs/web.log)'
fi

# ── 6. Workers 24/7 (BullMQ) ─────────────────────────────────────────────────
if listening 6379 && ! pgrep -f "tsx workers/index.ts" >/dev/null 2>&1; then
  nohup npm run worker >logs/workers.log 2>&1 &
  echo $! > logs/workers.pid
  sleep 6
  pgrep -f "workers/(sync|order|catalog)Worker" >/dev/null 2>&1 && ok 'Workers 24/7 arrancados (sync · pedidos · catálogo)' || warn 'Los workers no arrancaron (ver logs/workers.log)'
elif pgrep -f "tsx workers/index.ts" >/dev/null 2>&1; then
  ok 'Workers 24/7 ya estaban en marcha'
else
  warn 'Sin Redis no se arrancan los workers'
fi

# ── 6b. Buzón de correo de pruebas (si el correo apunta a esta máquina) ──────
MAIL_PORT="${SMTP_PORT:-2525}"
if [[ "${SMTP_HOST:-}" == "127.0.0.1" || "${SMTP_HOST:-}" == "localhost" ]]; then
  if listening "$MAIL_PORT"; then
    ok "Buzón de correo de pruebas escuchando en :$MAIL_PORT"
  else
    nohup npm run mail:dev-server -- "$MAIL_PORT" >logs/mail.log 2>&1 &
    echo $! > logs/mail.pid
    sleep 3
    listening "$MAIL_PORT" && ok "Buzón de correo de pruebas arrancado (:$MAIL_PORT → logs/mail-out/)" || warn 'El buzón de pruebas no arrancó (ver logs/mail.log)'
  fi
fi

# ── 7. Resumen y URL ─────────────────────────────────────────────────────────
SANDBOX="${E2B_SANDBOX_ID:-}"
printf '\n%s── Estado ──%s\n' "$BOLD" "$OFF"
listening 5432 && ok 'Base de datos (PostgreSQL)' || bad 'Base de datos'
listening 6379 && ok 'Colas (Redis)' || bad 'Colas (Redis)'
listening 8000 && ok 'Extracción (Playwright)' || warn 'Extracción (modo local/demo)'
listening 3000 && ok 'Web' || bad 'Web'
pgrep -f "tsx workers/index.ts" >/dev/null 2>&1 && ok 'Motor 24/7' || warn 'Motor 24/7'

printf '\n%s── Abre la aplicación ──%s\n' "$BOLD" "$OFF"
if [[ -n "$SANDBOX" ]]; then
  printf '  Vista previa:  %shttps://3000-%s.e2b.app%s\n' "$BOLD" "$SANDBOX" "$OFF"
else
  printf '  En este servidor:  %shttp://localhost:3000%s\n' "$BOLD" "$OFF"
fi
if [[ -z "${SMTP_HOST:-}" && -z "${RESEND_API_KEY:-}" && -z "${MAIL_WEBHOOK_URL:-}" ]]; then
  printf '  Correo: sin transporte configurado. Para verlo en local:  npm run mail:dev-server  (luego pon SMTP_HOST=127.0.0.1 y SMTP_PORT=2525 en .env.local)\n'
fi
printf '  Tipos de cambio: se descargan solos del BCE (o fuerza ahora con: npm run fx:refresh)\n'
printf '  Comprobación rápida: curl -s localhost:3000/api/health | head -c 200\n'
printf '  Verificación completa: npm run verify:e2e · npm run verify:catalog · npm run verify:fx\n\n'
printf 'Nota: si el sandbox se reinicia, los procesos se pierden y hay que volver a ejecutar este script (los datos en PostgreSQL se mantienen).\n\n'

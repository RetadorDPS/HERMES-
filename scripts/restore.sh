#!/usr/bin/env bash
#
# scripts/restore.sh — Restaura una copia de seguridad sobre la base de datos.
#
#   ./scripts/restore.sh backups/autods-2026-10-15-0400.sql.gz            # restaura
#   ./scripts/restore.sh backups/autods-2026-10-15-0400.sql.gz --dry-run  # sólo comprueba
#
# SIEMPRE pide confirmación escrita antes de tocar datos: sobrescribe la base
# de datos actual. Para el servicio web y los workers antes de restaurar.
set -euo pipefail

cd "$(dirname "$0")/.."

FILE="${1:-}"
DRY_RUN="${2:-}"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "Uso: ./scripts/restore.sh <copia.sql.gz> [--dry-run]"
  echo ""
  echo "Copias disponibles:"
  ls -lh backups/autods-*.sql.gz 2>/dev/null | tail -10 || echo "  (ninguna en ./backups)"
  exit 1
fi

if [ -f .env.local ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env.local
  set +a
fi

if [ -n "${DATABASE_URL:-}" ]; then
  proto_stripped="${DATABASE_URL#*://}"
  creds="${proto_stripped%@*}"
  hostpart="${proto_stripped#*@}"
  PGUSER="${PGUSER:-${creds%%:*}}"
  PGPASSWORD="${PGPASSWORD:-${creds#*:}}"
  hostport="${hostpart%%/*}"
  PGHOST="${PGHOST:-${hostport%%:*}}"
  PGPORT="${PGPORT:-${hostport##*:}}"
  PGDATABASE="${PGDATABASE:-${hostpart#*/}}"
  PGDATABASE="${PGDATABASE%%\?*}"
fi

PGUSER="${PGUSER:-autods}"
PGDATABASE="${PGDATABASE:-autods}"
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
export PGPASSWORD PGUSER PGHOST PGPORT PGDATABASE

echo "Copia   : ${FILE} ($(du -h "$FILE" | cut -f1))"
echo "Destino : postgresql://${PGUSER}@${PGHOST}:${PGPORT}/${PGDATABASE}"
echo "Tablas  : $(gzip -dc "$FILE" | grep -c '^CREATE TABLE' || true)"
echo ""

if [ "$DRY_RUN" = "--dry-run" ]; then
  echo "[dry-run] Copia legible y sin errores de formato. No se ha tocado la base de datos."
  exit 0
fi

echo "⚠️  Esto SOBRESCRIBE la base de datos actual. Detén antes la web y los workers."
read -r -p "Escribe RESTAURAR para continuar: " CONFIRM
if [ "$CONFIRM" != "RESTAURAR" ]; then
  echo "Cancelado."
  exit 1
fi

echo "── Restaurando… ──"
gzip -dc "$FILE" | psql -v ON_ERROR_STOP=1 -q -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE"
echo "✔ Restauración completada. Comprueba el panel y reinicia web + workers."

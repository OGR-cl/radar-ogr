#!/usr/bin/env bash
# Publica el slice del repo actual en el dashboard Radar OGR.
#
# No usa ningún token ni GitHub Action: corre en la máquina de quien trabaja,
# con sus propias credenciales de git (Daniel y José ya tienen push a OGR-cl).
#
# Uso: ejecutar desde cualquier punto dentro de proyectos-ogr o Repositorio-OGR.
#     ./radar_publicar.sh
set -euo pipefail

CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/radar-ogr"
DASHBOARD_URL="https://github.com/OGR-cl/radar-ogr.git"

# --- 1. Identificar en qué repo estamos ------------------------------------
if ! ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  echo "error: no estás dentro de un repo git" >&2
  exit 1
fi

REMOTE="$(git -C "$ROOT" remote get-url origin 2>/dev/null || echo '')"
case "$REMOTE" in
  *proyectos-ogr*)
    KEY="proyectos-ogr"
    SLICE="data/proyectos-ogr.json"
    EXCLUDE='_Archivados,00_Plantilla_Proyecto,📓 Notas OGR,09_Radar_OGR'
    ;;
  *[Rr]epositorio-[Oo][Gg][Rr]*)
    KEY="Repositorio-OGR"
    SLICE="data/repositorio-ogr.json"
    EXCLUDE=''
    ;;
  *)
    echo "error: '$REMOTE' no es proyectos-ogr ni Repositorio-OGR — no hay slice que publicar" >&2
    exit 1
    ;;
esac

# --- 2. Clon de trabajo del dashboard (cacheado) ---------------------------
if [ -d "$CACHE/.git" ]; then
  git -C "$CACHE" fetch --quiet origin
  git -C "$CACHE" reset --quiet --hard origin/main
else
  mkdir -p "$(dirname "$CACHE")"
  git clone --quiet "$DASHBOARD_URL" "$CACHE"
fi

# --- 3. Generar el slice ----------------------------------------------------
python3 "$CACHE/generar_data.py" \
  --root "$ROOT" --key "$KEY" --exclude "$EXCLUDE" \
  --out "$CACHE/$SLICE" >/dev/null

# --- 4. Publicar, reintentando si el otro pushea a la vez -------------------
cd "$CACHE"
if git diff --quiet -- "$SLICE"; then
  echo "Radar: $KEY ya estaba al día."
  exit 0
fi

for intento in 1 2 3; do
  git add "$SLICE"
  git commit --quiet -m "radar: slice de $KEY"
  if git push --quiet 2>/dev/null; then
    echo "Radar actualizado: $KEY → https://ogr-cl.github.io/radar-ogr/"
    exit 0
  fi
  # Alguien pusheó primero: rehacer el slice sobre la punta nueva.
  git reset --quiet --hard HEAD~1
  git fetch --quiet origin
  git reset --quiet --hard origin/main
  python3 "$CACHE/generar_data.py" \
    --root "$ROOT" --key "$KEY" --exclude "$EXCLUDE" \
    --out "$CACHE/$SLICE" >/dev/null
  if git diff --quiet -- "$SLICE"; then
    echo "Radar: $KEY ya estaba al día (lo publicó otro push)."
    exit 0
  fi
  sleep "$intento"
done

echo "error: no se pudo publicar el slice de $KEY tras 3 intentos" >&2
exit 1

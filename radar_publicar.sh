#!/usr/bin/env bash
# Publica el slice del repo actual en el dashboard Radar OGR.
#
# No usa ningún token ni GitHub Action: corre en la máquina de quien trabaja,
# con sus propias credenciales de git (Daniel y José ya tienen push a OGR-cl).
#
# Uso: ejecutar desde cualquier punto dentro de proyectos-ogr o Repositorio-OGR.
#     ./radar_publicar.sh
set -euo pipefail

CACHE="${RADAR_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/radar-ogr}"
DASHBOARD_URL="${RADAR_DASHBOARD_URL:-https://github.com/OGR-cl/radar-ogr.git}"

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
  git -C "$CACHE" checkout --quiet -B main origin/main
else
  mkdir -p "$(dirname "$CACHE")"
  git clone --quiet --branch main "$DASHBOARD_URL" "$CACHE"
fi

TMP_SLICE="$(mktemp)"
trap 'rm -f "$TMP_SLICE"' EXIT

generar() {
  python3 "$CACHE/generar_data.py" \
    --root "$ROOT" --key "$KEY" --exclude "$EXCLUDE" \
    --out "$TMP_SLICE" >/dev/null
}

# `generated_at` cambia en cada corrida, así que comparar los ficheros crudos
# marcaría "cambió" siempre y cada empiezo dejaría un commit basura. Solo
# cuentan los datos: el repo y sus proyectos.
sin_cambios() {
  python3 - "$CACHE/$SLICE" "$TMP_SLICE" <<'PY'
import json, sys
def datos(p):
    try:
        with open(p, encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        return None
    return d.get("repo"), d.get("projects")
sys.exit(0 if datos(sys.argv[1]) == datos(sys.argv[2]) else 1)
PY
}

# --- 3. Publicar, reintentando si el otro pushea a la vez -------------------
cd "$CACHE"
for intento in 1 2 3; do
  generar
  if sin_cambios; then
    echo "Radar: $KEY ya estaba al día."
    exit 0
  fi

  cp "$TMP_SLICE" "$CACHE/$SLICE"
  git add "$SLICE"
  git commit --quiet -m "radar: slice de $KEY"
  if git push --quiet origin main 2>/dev/null; then
    echo "Radar actualizado: $KEY → https://ogr-cl.github.io/radar-ogr/"
    exit 0
  fi

  # Alguien pusheó primero: volver a la punta remota y rehacer el slice.
  git reset --quiet --hard HEAD~1
  git fetch --quiet origin
  git checkout --quiet -B main origin/main
  sleep "$intento"
done

echo "error: no se pudo publicar el slice de $KEY tras 3 intentos" >&2
exit 1

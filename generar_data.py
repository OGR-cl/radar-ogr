#!/usr/bin/env python3
"""Genera la porción de data del Radar OGR correspondiente a UN repo.

Recorre las carpetas de primer nivel del repo indicado, saca el último commit
de cada una (presencia) y cuenta el estado de las tareas en su TAREAS.md.

Escribe un "slice": {repo, generated_at, projects:[...]}. El dashboard fusiona
los slices de todos los repos y calcula quién está activo EN EL NAVEGADOR, a
partir de last_commit.date. Por eso aquí no se calcula `active`: un JSON
generado hace 5 horas seguiría diciendo "activo" y sería mentira.

Uso (dentro del checkout del repo, en un GitHub Action):
    python3 generar_data.py --root . --key proyectos-ogr \
        --exclude _Archivados,00_Plantilla_Proyecto --out slice.json

Requiere historial completo (`fetch-depth: 0` en actions/checkout).
"""
import argparse
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

TASK_HEADER_RE = re.compile(r"^##\s+(.+)$")
ESTADO_RE = re.compile(r"^Estado:\s*(⬜|🔄|✅|🧪)")
ESTADO_MAP = {"⬜": "pendiente", "🔄": "en_curso", "✅": "hecho", "🧪": "qa"}
EMPIEZO_RE = re.compile(r"empiezo:\s*(.+?)\s*$")


def last_commit_for_path(repo_path, subpath):
    result = subprocess.run(
        ["git", "-C", str(repo_path), "log", "-1", "--format=%an|%aI|%H", "--", subpath],
        capture_output=True, text=True, check=False,
    )
    out = result.stdout.strip()
    if not out:
        return None
    author, iso_date, commit_hash = out.split("|", 2)
    return {"author": author, "date": iso_date, "hash": commit_hash}


def empiezo_commits(repo_path):
    """Último commit de presencia (skill /empiezo) por carpeta de proyecto.

    Los commits de presencia son vacíos: no tocan ninguna ruta, así que
    `git log -- <carpeta>` no los ve. Se rescatan por el asunto
    "⏳ empiezo: <carpeta>".
    """
    result = subprocess.run(
        ["git", "-C", str(repo_path), "log", "-n", "500",
         "--format=%an|%aI|%H|%s", "--grep", "empiezo:"],
        capture_output=True, text=True, check=False,
    )
    latest = {}
    for line in result.stdout.strip().splitlines():
        author, iso_date, commit_hash, subject = line.split("|", 3)
        m = EMPIEZO_RE.search(subject)
        if not m:
            continue
        folder = m.group(1)
        if folder not in latest:  # el log viene de más nuevo a más viejo
            latest[folder] = {"author": author, "date": iso_date, "hash": commit_hash}
    return latest


def newest_commit(a, b):
    if a is None:
        return b
    if b is None:
        return a
    da = datetime.fromisoformat(a["date"])
    db = datetime.fromisoformat(b["date"])
    return a if da >= db else b


def parse_tareas_md(tareas_path):
    if not tareas_path.exists():
        return None
    counts = {"pendiente": 0, "en_curso": 0, "hecho": 0, "qa": 0}
    text = tareas_path.read_text(encoding="utf-8", errors="ignore")
    for line in text.splitlines():
        m = ESTADO_RE.match(line.strip())
        if m:
            counts[ESTADO_MAP[m.group(1)]] += 1
    counts["total"] = sum(counts.values())
    return counts


def build_project_entry(repo_path, folder, empiezos):
    tareas_path = folder / "TAREAS.md"
    last = newest_commit(
        last_commit_for_path(repo_path, folder.name), empiezos.get(folder.name)
    )
    return {
        "folder": folder.name,
        "name": folder.name,
        "last_commit": last,
        "tasks": parse_tareas_md(tareas_path),
        "has_tareas_md": tareas_path.exists(),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True, help="Ruta al checkout del repo")
    parser.add_argument("--key", required=True, help="Nombre del repo (ej. proyectos-ogr)")
    parser.add_argument("--exclude", default="", help="Carpetas a omitir, separadas por coma")
    parser.add_argument("--out", required=True, help="Ruta del slice JSON de salida")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    exclude = {e.strip() for e in args.exclude.split(",") if e.strip()}

    empiezos = empiezo_commits(root)
    projects = []
    for folder in sorted(root.iterdir()):
        if not folder.is_dir():
            continue
        if folder.name in exclude or folder.name.startswith("."):
            continue
        projects.append(build_project_entry(root, folder, empiezos))

    slice_data = {
        "repo": args.key,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "projects": projects,
    }

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(slice_data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"slice de {args.key}: {len(projects)} proyectos → {out_path}")


if __name__ == "__main__":
    main()

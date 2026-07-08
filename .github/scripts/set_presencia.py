#!/usr/bin/env python3
"""Actualiza presencia.json desde el workflow 'Marcar presencia'.

Recibe QUIEN y PROYECTO por variables de entorno (los inputs del
workflow_dispatch). Un PROYECTO vacío, "libre", "-", "off" o "ninguno" apaga la
luz (proyecto = null). Escribe la marca de tiempo del cambio.
"""
import json
import os
from datetime import datetime, timezone
from pathlib import Path

PATH = Path("presencia.json")
APAGADO = {"", "libre", "-", "off", "ninguno"}

quien = os.environ["QUIEN"].strip()
proyecto_in = os.environ.get("PROYECTO", "").strip()
proyecto = None if proyecto_in.lower() in APAGADO else proyecto_in

if PATH.exists():
    data = json.loads(PATH.read_text(encoding="utf-8"))
else:
    data = {"personas": {}}
data.setdefault("personas", {})

now = datetime.now(timezone.utc).isoformat()
data["personas"][quien] = {"proyecto": proyecto, "desde": now}
data["updated_at"] = now

PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(f"presencia: {quien} -> {proyecto or 'libre'}")

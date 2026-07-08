# Radar OGR

Dashboard de coordinación de Daniel y José: quién está trabajando en qué proyecto
ahora mismo, y cómo va el checklist de tareas de cada uno.

**URL: https://ogr-cl.github.io/radar-ogr/**

No se edita a mano. Todo sale del historial de commits y de los `TAREAS.md` de los
repos `OGR-cl/proyectos-ogr` y `OGR-cl/Repositorio-OGR`.

## Cómo se actualiza

Cada repo de trabajo tiene un workflow (`.github/workflows/radar.yml`) que corre en
cada push a `main`:

1. Hace checkout de **su propio** repo (con el `GITHUB_TOKEN` que GitHub da gratis).
2. Descarga `generar_data.py` desde este repo (es público, no hace falta auth).
3. Genera su porción — un "slice" — con el último commit por carpeta y el conteo
   de estados de cada `TAREAS.md`.
4. Publica el slice en `data/<repo>.json` de este repo, usando el secret
   `RADAR_OGR_TOKEN`.

El navegador fusiona los slices y **calcula la presencia al pintar**
(`activo = último push hace menos de 2 h`), refrescando cada minuto. Por eso el
`active` no se guarda en el JSON: un archivo generado hace 5 horas seguiría
diciendo "activo" y sería mentira.

Cada repo publica solo su propio slice. Así el token compartido necesita permiso de
**escritura únicamente sobre `radar-ogr`** (repo público) y **no puede leer** el
código de los repos privados de OGR.

## El secret `RADAR_OGR_TOKEN`

Fine-grained PAT, configurado como secret en `proyectos-ogr` y `Repositorio-OGR`:

- **Resource owner:** `OGR-cl`
- **Repository access:** solo `OGR-cl/radar-ogr`
- **Permisos:** `Contents: Read and write` (nada más)

Es lo único que puede hacer: escribir en este dashboard.

## Correr el generador a mano

```bash
python3 generar_data.py --root /ruta/a/proyectos-ogr --key proyectos-ogr \
  --exclude '_Archivados,00_Plantilla_Proyecto,📓 Notas OGR,09_Radar_OGR' \
  --out data/proyectos-ogr.json
```

Necesita el historial completo de git (en CI: `fetch-depth: 0`).

## Convención de tareas

Ver `09_Radar_OGR/GUIA_TAREAS.md` en `proyectos-ogr` — formato de `TAREAS.md` y la
skill `/empiezo` para marcar presencia con un commit vacío.

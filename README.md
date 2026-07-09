# Radar OGR

Dashboard de coordinación de Daniel y José: quién está trabajando en qué proyecto
ahora mismo, y cómo va el checklist de tareas de cada uno.

**URL: https://ogr-cl.github.io/radar-ogr/**

No se edita a mano. Todo sale del historial de commits y de los `TAREAS.md` de los
repos `OGR-cl/proyectos-ogr` y `OGR-cl/Repositorio-OGR`.

## Cómo se actualiza

**Sin tokens y sin GitHub Actions.** La actualización corre en la máquina de quien
trabaja, con sus credenciales de git normales — Daniel y José ya tienen push a
`OGR-cl`. Un runner de GitHub habría necesitado un PAT; vosotros no.

Al decir "empiezo" (skill `/empiezo`), tras el commit de presencia se ejecuta
`radar_publicar.sh`, que:

1. Detecta en qué repo estás por la URL del `origin`.
2. Genera tu porción — un "slice" — con el último commit por carpeta y el conteo
   de estados de cada `TAREAS.md`.
3. La publica en `data/<repo>.json` de este repo, solo si cambió algo.

El navegador fusiona los slices y **calcula la presencia al pintar**
(`activo = último push hace menos de 30 min`), refrescando cada minuto. Por eso el
`active` no se guarda en el JSON: un archivo generado hace 5 horas seguiría
diciendo "activo" y sería mentira. Y por eso tampoco hace falta ningún cron.

Cada repo publica solo su propio slice, así que el dashboard se pinta igual aunque
uno de los dos lleve tiempo sin publicar.

## Marcar presencia — el interruptor (embebido en la página)

Además de la presencia automática por commits, cada uno tiene un **interruptor
manual**: una luz con su nombre que enciende a mano, sin depender de hacer push
ni de salir del dashboard.

El botón **"Cambiar"** vive en la propia tarjeta de tu nombre. La primera vez
hay que conectar tu GitHub (una vez por navegador):

1. Botón **"Conectar mi GitHub"** (arriba de las tarjetas de presencia).
2. Crea un *fine-grained token* en GitHub → *Settings → Developer settings →
   Fine-grained tokens*, con acceso solo a **`OGR-cl/radar-ogr`** y permiso
   **`Contents: Read and write`**.
3. Pega el token y elige tu nombre. Se guarda solo en ese navegador
   (`localStorage`) — nunca viaja a ningún repo ni a un servidor.

Con eso conectado, tu tarjeta muestra "Cambiar": eliges el proyecto (o "marcar
libre") y guardas — el JS escribe `presencia.json` directo contra la Contents
API de GitHub con tu token, sin pasar por Actions. Si el otro está publicando
a la vez, reintenta una vez (mismo espíritu que el rebase de
`radar_publicar.sh`). Cada uno solo puede cambiar su propia luz (candado 🔒 en
la del otro). Si olvidas apagarla, tras 6 h la luz pasa a 🟡 «¿sigue activo?».

- **Sin backend:** el "servidor" es tu propio navegador con tu propio token.
- **Sin secreto compartido:** cada quien crea y guarda el suyo, con permiso
  mínimo (solo este repo, solo lectura/escritura de contenido).
- Sigue funcionando desde el móvil. El estado vive en `presencia.json`, un
  commit como cualquier otro.

El workflow `Actions → Marcar presencia`
([presencia.yml](.github/workflows/presencia.yml)) se mantiene como respaldo
manual (por si alguien no quiere crear un token), pero ya no es el camino
principal.

## Publicar a mano

Clona este repo una vez, y luego, desde cualquier punto dentro de `proyectos-ogr`
o `Repositorio-OGR`:

```bash
bash /ruta/a/radar-ogr/radar_publicar.sh
```

Si nada cambió, no deja commit. Si el otro pushea a la vez, rebasa y reintenta.

## Correr solo el generador

```bash
python3 generar_data.py --root /ruta/a/proyectos-ogr --key proyectos-ogr \
  --exclude '_Archivados,00_Plantilla_Proyecto,📓 Notas OGR,09_Radar_OGR' \
  --out data/proyectos-ogr.json
```

Necesita el historial completo de git.

## Convención de tareas

Ver `09_Radar_OGR/GUIA_TAREAS.md` en `proyectos-ogr` — formato de `TAREAS.md` y la
skill `/empiezo` para marcar presencia con un commit vacío.

// El dashboard fusiona un slice por repo y calcula la presencia AQUÍ, no en el
// generador: así "activo" caduca solo aunque el JSON lleve horas sin regenerarse.
const SLICES = ["data/proyectos-ogr.json", "data/repositorio-ogr.json"];
const ACTIVE_WINDOW_MIN = 30;
const REFRESH_MS = 60_000;

const TASK_LABELS = {
  pendiente: "pendiente",
  en_curso: "en curso",
  hecho: "hecho",
  qa: "QA",
};

function fmtMinutes(min) {
  if (min == null) return "sin historial";
  if (min < 60) return `hace ${min} min`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `hace ${days} d`;
}

function minutesSince(isoDate) {
  if (!isoDate) return null;
  const then = new Date(isoDate).getTime();
  if (Number.isNaN(then)) return null;
  return Math.round((Date.now() - then) / 60_000);
}

function renderTasks(tasks) {
  if (!tasks || tasks.total === 0) {
    return '<p class="no-tasks">sin TAREAS.md</p>';
  }
  const pills = Object.entries(TASK_LABELS)
    .filter(([key]) => tasks[key] > 0)
    .map(([key, label]) => `<span class="pill ${key}">${tasks[key]} ${label}</span>`)
    .join("");
  return `<div class="tasks">${pills}</div>`;
}

function renderCard(p) {
  const author = p.last_commit ? p.last_commit.author : "sin commits";
  const activeClass = p.active ? "active" : "idle";
  const activeLabel = p.active ? `🟢 ${author}` : "libre";
  return `
    <div class="card">
      <div class="card-head">
        <div>
          <div class="card-name">${p.name}</div>
          <div class="card-repo">${p.repo}</div>
        </div>
        <span class="badge ${activeClass}">${activeLabel}</span>
      </div>
      <div class="last-push">último push: ${fmtMinutes(p.minutes_since_last_push)}</div>
      ${renderTasks(p.tasks)}
    </div>
  `;
}

async function fetchSlice(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

async function main() {
  // Un slice caído no debe tumbar el dashboard entero: se pinta lo que haya.
  const settled = await Promise.allSettled(SLICES.map(fetchSlice));
  const slices = settled.filter((r) => r.status === "fulfilled").map((r) => r.value);
  settled
    .filter((r) => r.status === "rejected")
    .forEach((r) => console.error("slice no disponible:", r.reason));

  if (slices.length === 0) throw new Error("ningún slice disponible");

  const projects = slices.flatMap((slice) =>
    slice.projects.map((p) => {
      const mins = minutesSince(p.last_commit?.date);
      return {
        ...p,
        repo: slice.repo,
        minutes_since_last_push: mins,
        active: mins != null && mins <= ACTIVE_WINDOW_MIN,
      };
    })
  );

  const newest = slices
    .map((s) => new Date(s.generated_at))
    .sort((a, b) => b - a)[0];
  document.getElementById("updated").textContent =
    `Actualizado: ${newest.toLocaleString("es-CL")}`;

  projects.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return (a.minutes_since_last_push ?? Infinity) - (b.minutes_since_last_push ?? Infinity);
  });

  document.getElementById("grid").innerHTML = projects.map(renderCard).join("");
}

function run() {
  main().catch((err) => {
    document.getElementById("grid").textContent = "No se pudo cargar el radar.";
    console.error(err);
  });
}

run();
// Repinta sin recargar: la presencia caduca sola aunque nadie pushee.
setInterval(run, REFRESH_MS);

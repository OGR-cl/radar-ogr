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

async function main() {
  const res = await fetch("data.json", { cache: "no-store" });
  const data = await res.json();

  const updated = new Date(data.generated_at);
  document.getElementById("updated").textContent =
    `Actualizado: ${updated.toLocaleString("es-CL")}`;

  const grid = document.getElementById("grid");
  const projects = [...data.projects].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return (a.minutes_since_last_push ?? Infinity) - (b.minutes_since_last_push ?? Infinity);
  });
  grid.innerHTML = projects.map(renderCard).join("");
}

main().catch((err) => {
  document.getElementById("grid").textContent = "No se pudo cargar data.json.";
  console.error(err);
});

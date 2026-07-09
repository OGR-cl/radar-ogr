// El dashboard fusiona un slice por repo y calcula la presencia AQUÍ, no en el
// generador: así "activo" caduca solo aunque el JSON lleve horas sin regenerarse.
const SLICES = ["data/proyectos-ogr.json", "data/repositorio-ogr.json"];
const ACTIVE_WINDOW_MIN = 30;
const REFRESH_MS = 60_000;

// Presencia manual: cada uno enciende su luz desde la propia página, sin salir
// a GitHub. Escribe con SU token de fine-grained PAT (guardado solo en este
// navegador) contra la Contents API de GitHub — sin backend, sin secreto
// compartido. El JSON solo guarda proyecto + desde; la luz se pinta aquí.
const PRESENCIA = "presencia.json";
const PRESENCIA_STALE_MIN = 6 * 60;
const PERSONAS_ORDEN = ["Daniel", "José"];
const REPO = "OGR-cl/radar-ogr";
const AUTH_KEY = "radarOgrAuth";

const TASK_LABELS = {
  pendiente: "pendiente",
  en_curso: "en curso",
  hecho: "hecho",
  qa: "QA",
};

// Se rellena con los proyectos reales que trae cada slice, para que el
// selector de "cambiar presencia" ofrezca nombres que existen de verdad.
let knownProjects = [];
// Nombre en edición ahora mismo (una sola persona puede tener el editor
// abierto en un momento dado dentro de este navegador).
let editingName = null;
// Sobrescritura optimista tras un guardado propio: se ve al instante aunque
// GitHub Pages tarde unos segundos en republicar presencia.json.
const overridePersonas = {};

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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function showToast(msg) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(showToast._h);
  showToast._h = setTimeout(() => el.classList.remove("show"), 3200);
}

// --- Autenticación local (fine-grained PAT del propio usuario) ---------

function getAuth() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY) || "null");
  } catch {
    return null;
  }
}

function setAuth(nombre, token) {
  localStorage.setItem(AUTH_KEY, JSON.stringify({ nombre, token }));
}

function clearAuth() {
  localStorage.removeItem(AUTH_KEY);
}

function canEdit(nombre) {
  const auth = getAuth();
  return Boolean(auth && auth.nombre === nombre);
}

// --- Base64 UTF-8 seguro (nombres con tilde) ---------------------------

function b64EncodeUnicode(str) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(str)));
}

function b64DecodeUnicode(str) {
  const bytes = Uint8Array.from(atob(str.replace(/\n/g, "")), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// --- Escritura contra la Contents API de GitHub ------------------------

async function fetchPresenciaFile(token) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${PRESENCIA}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error("Token sin permiso o vencido — vuelve a conectar.");
    }
    throw new Error(`No se pudo leer presencia.json (HTTP ${res.status})`);
  }
  const json = await res.json();
  return { sha: json.sha, data: JSON.parse(b64DecodeUnicode(json.content)) };
}

async function putPresenciaFile(token, data, sha, nombre, proyecto) {
  const body = {
    message: `🔦 presencia: ${nombre} → ${proyecto || "libre"}`,
    content: b64EncodeUnicode(JSON.stringify(data, null, 2) + "\n"),
    sha,
    branch: "main",
  };
  return fetch(`https://api.github.com/repos/${REPO}/contents/${PRESENCIA}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

// Escribe la presencia de `nombre`. Reintenta una vez si el archivo cambió
// entre el GET y el PUT (choque con el otro publicando a la vez) — mismo
// espíritu que el rebase-y-reintenta de radar_publicar.sh, pero sobre la API.
async function writePresencia(nombre, proyecto) {
  const auth = getAuth();
  if (!auth) throw new Error("Conecta tu GitHub primero.");

  for (let attempt = 0; attempt < 2; attempt++) {
    const { sha, data } = await fetchPresenciaFile(auth.token);
    data.personas = data.personas || {};
    data.personas[nombre] = proyecto
      ? { proyecto, desde: new Date().toISOString() }
      : { proyecto: null, desde: null };
    data.updated_at = new Date().toISOString();

    const res = await putPresenciaFile(auth.token, data, sha, nombre, proyecto);
    if (res.ok) return data;
    if (res.status === 409 && attempt === 0) continue; // el otro escribió primero: reintenta
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `No se pudo guardar (HTTP ${res.status})`);
  }
  throw new Error("No se pudo guardar tras reintentar — vuelve a intentar.");
}

// --- Render: presencia + editor embebido --------------------------------

function personaOptions(selected) {
  const opts = ["libre", ...knownProjects];
  return opts
    .map((p) => {
      const label = p === "libre" ? "— Marcar libre —" : p;
      const sel = p === (selected || "libre") ? "selected" : "";
      return `<option value="${escapeHtml(p)}" ${sel}>${escapeHtml(label)}</option>`;
    })
    .join("");
}

function renderPersona(nombre, estado) {
  const proyecto = estado && estado.proyecto;
  const mins = minutesSince(estado && estado.desde);
  const on = Boolean(proyecto);
  const stale = on && mins != null && mins > PRESENCIA_STALE_MIN;
  const cls = !on ? "off" : stale ? "stale" : "on";
  const luz = !on ? "⚪" : stale ? "🟡" : "🟢";
  const estadoTxt = on ? `en <strong>${escapeHtml(proyecto)}</strong>` : "libre";
  const desde = on
    ? `desde ${fmtMinutes(mins)}${stale ? " · ¿sigue activo?" : ""}`
    : "";
  const editable = canEdit(nombre);
  const editing = editingName === nombre;

  const accion = editable
    ? `<button class="persona-editar" data-toggle="${escapeHtml(nombre)}">${editing ? "Cerrar" : "Cambiar"}</button>`
    : `<span class="persona-lock" title="Solo ${escapeHtml(nombre)} puede cambiar esta luz">🔒</span>`;

  const editor = editable && editing
    ? `<div class="persona-editor">
        <select data-select="${escapeHtml(nombre)}">${personaOptions(proyecto)}</select>
        <div class="persona-editor-btns">
          <button class="btn-mini ghost" data-cancel="${escapeHtml(nombre)}">Cancelar</button>
          <button class="btn-mini primary" data-save="${escapeHtml(nombre)}">Guardar</button>
        </div>
      </div>`
    : "";

  return `
    <div class="persona ${cls}">
      <div class="persona-row">
        <span class="luz">${luz}</span>
        <div class="persona-info">
          <div class="persona-nombre">${escapeHtml(nombre)}</div>
          <div class="persona-estado">${estadoTxt}</div>
          ${desde ? `<div class="persona-desde">${desde}</div>` : ""}
        </div>
        ${accion}
      </div>
      ${editor}
    </div>
  `;
}

function renderTokenBanner() {
  const el = document.getElementById("tokenBanner");
  if (!el) return;
  const auth = getAuth();
  if (auth) {
    el.className = "presencia-accion connected";
    el.innerHTML = `
      <span class="token-status"><span class="dot">●</span> Conectado como <strong>${escapeHtml(auth.nombre)}</strong></span>
      <button class="link-quiet" id="btnDisconnect">Desconectar</button>
    `;
  } else {
    el.className = "presencia-accion";
    el.innerHTML = `
      <span class="presencia-accion-txt">🔒 <strong>Sin conectar</strong> — necesitas tu token para cambiar tu presencia desde aquí.</span>
      <button class="btn-connect" id="btnConnect">Conectar mi GitHub</button>
    `;
  }
  const btnConnect = document.getElementById("btnConnect");
  if (btnConnect) btnConnect.onclick = openModal;
  const btnDisconnect = document.getElementById("btnDisconnect");
  if (btnDisconnect) btnDisconnect.onclick = () => {
    clearAuth();
    editingName = null;
    renderTokenBanner();
    run();
    showToast("Token olvidado en este navegador.");
  };
}

function bindPresenciaEvents(personas) {
  document.querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.onclick = () => {
      const n = btn.dataset.toggle;
      editingName = editingName === n ? null : n;
      paintPersonas(personas);
    };
  });
  document.querySelectorAll("[data-cancel]").forEach((btn) => {
    btn.onclick = () => {
      editingName = null;
      paintPersonas(personas);
    };
  });
  document.querySelectorAll("[data-save]").forEach((btn) => {
    btn.onclick = async () => {
      const n = btn.dataset.save;
      const select = document.querySelector(`[data-select="${n}"]`);
      const val = select.value === "libre" ? null : select.value;
      btn.disabled = true;
      btn.textContent = "Guardando…";
      try {
        const data = await writePresencia(n, val);
        overridePersonas[n] = data.personas[n];
        editingName = null;
        showToast(val ? `${n} marcado en ${val} ✅` : `${n} ahora está libre ✅`);
        paintPersonas({ ...personas, [n]: overridePersonas[n] });
      } catch (err) {
        showToast(err.message || "No se pudo guardar.");
        btn.disabled = false;
        btn.textContent = "Guardar";
      }
    };
  });
}

function paintPersonas(personas) {
  const el = document.getElementById("presencia");
  if (!el) return;
  const nombres = [...new Set([...PERSONAS_ORDEN, ...Object.keys(personas)])];
  el.innerHTML = nombres.map((n) => renderPersona(n, personas[n])).join("");
  bindPresenciaEvents(personas);
}

async function fetchPresenciaData() {
  const data = await fetchSlice(PRESENCIA);
  const personas = { ...(data.personas || {}) };
  // La sobrescritura optimista manda mientras Pages no haya republicado el
  // mismo valor; en cuanto coincide, se suelta y manda el archivo real.
  for (const [n, estado] of Object.entries(overridePersonas)) {
    const real = personas[n];
    const yaIgual = real && real.proyecto === estado.proyecto;
    if (yaIgual) delete overridePersonas[n];
    else personas[n] = estado;
  }
  return personas;
}

// A quién le corresponde marcar manualmente cada proyecto activo, para que
// las tarjetas de abajo reflejen también el interruptor de arriba (no solo
// push reciente). Se ignora si la marca lleva más de PRESENCIA_STALE_MIN
// sin apagarse — igual que la luz pasa a 🟡, deja de "encender" la tarjeta.
function manualPresenceByProject(personas) {
  const porProyecto = {};
  for (const [nombre, estado] of Object.entries(personas || {})) {
    if (!estado || !estado.proyecto) continue;
    const mins = minutesSince(estado.desde);
    if (mins != null && mins > PRESENCIA_STALE_MIN) continue;
    porProyecto[estado.proyecto] = nombre;
  }
  return porProyecto;
}

// --- Modal de conexión ---------------------------------------------------

function openModal() {
  document.getElementById("modalOverlay").classList.add("open");
}

function closeModal() {
  document.getElementById("modalOverlay").classList.remove("open");
  document.getElementById("modalToken").value = "";
}

function bindModal() {
  document.getElementById("modalCancel").onclick = closeModal;
  document.getElementById("modalOverlay").addEventListener("click", (e) => {
    if (e.target.id === "modalOverlay") closeModal();
  });
  document.getElementById("modalSave").onclick = () => {
    const nombre = document.getElementById("modalNombre").value;
    const token = document.getElementById("modalToken").value.trim();
    if (!token) {
      showToast("Pega tu token primero.");
      return;
    }
    setAuth(nombre, token);
    closeModal();
    renderTokenBanner();
    run();
    showToast(`Conectado como ${nombre} 🔑`);
  };
}

// --- Proyectos (grid) ----------------------------------------------------

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
  const author = p.manualBy || (p.last_commit ? p.last_commit.author : "sin commits");
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

async function main(personas) {
  // Un slice caído no debe tumbar el dashboard entero: se pinta lo que haya.
  const settled = await Promise.allSettled(SLICES.map(fetchSlice));
  const slices = settled.filter((r) => r.status === "fulfilled").map((r) => r.value);
  settled
    .filter((r) => r.status === "rejected")
    .forEach((r) => console.error("slice no disponible:", r.reason));

  if (slices.length === 0) throw new Error("ningún slice disponible");

  const manualPorProyecto = manualPresenceByProject(personas);

  const projects = slices.flatMap((slice) =>
    slice.projects.map((p) => {
      const mins = minutesSince(p.last_commit?.date);
      const pushActive = mins != null && mins <= ACTIVE_WINDOW_MIN;
      const manualBy = manualPorProyecto[p.name];
      return {
        ...p,
        repo: slice.repo,
        minutes_since_last_push: mins,
        // Activo por push reciente O por presencia manual: son dos señales,
        // basta con una para encender la tarjeta.
        active: pushActive || Boolean(manualBy),
        manualBy,
      };
    })
  );

  knownProjects = [...new Set(projects.map((p) => p.name))].sort();

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

async function run() {
  // La presencia se resuelve primero porque el grid la necesita para encender
  // tarjetas por marca manual, no solo por push. Si falla, el grid sigue
  // pintándose solo con la señal de push (personas = {}).
  let personas = {};
  try {
    personas = await fetchPresenciaData();
    paintPersonas(personas);
  } catch (err) {
    console.error("presencia no disponible:", err);
  }
  main(personas).catch((err) => {
    document.getElementById("grid").textContent = "No se pudo cargar el radar.";
    console.error(err);
  });
}

bindModal();
renderTokenBanner();
run();
// Repinta sin recargar: la presencia caduca sola aunque nadie pushee.
setInterval(run, REFRESH_MS);

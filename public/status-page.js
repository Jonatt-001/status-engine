const STATUS_API = "/api/status";

const statusCopy = {
  operational: {
    title: "All systems operational",
    description: "Dyve services are operating normally.",
    className: "operational"
  },
  degraded: {
    title: "Some systems are degraded",
    description: "One or more services are experiencing reduced availability.",
    className: "warning"
  },
  major_outage: {
    title: "A service disruption is active",
    description: "One or more Dyve services are currently unavailable.",
    className: "danger"
  },
  unknown: {
    title: "Checking systems",
    description: "The monitoring engine is still collecting live service data.",
    className: ""
  }
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatTime(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function formatRelative(value) {
  if (!value) return "never";

  const time = new Date(value).getTime();

  if (!Number.isFinite(time)) return "never";

  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));

  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);

  if (hours < 24) return `${hours}h ago`;

  return `${Math.floor(hours / 24)}d ago`;
}

function statusLabel(status) {
  return {
    operational: "Operational",
    degraded: "Degraded",
    major_outage: "Major outage",
    unknown: "Collecting data"
  }[status] || "Unknown";
}

function uptimeLabel(value) {
  if (value === null || value === undefined) return "—";
  return `${Number(value).toFixed(2)}%`;
}

function renderServices(services) {
  const container = document.getElementById("services");

  container.innerHTML = services.map(service => `
    <article class="service">
      <span class="service-dot ${escapeHtml(service.status)}"></span>
      <div>
        <div class="service-name">${escapeHtml(service.name)}</div>
        <div class="service-description">${escapeHtml(service.description)}</div>
      </div>
      <div class="service-right">
        <div class="service-status ${escapeHtml(service.status)}">${escapeHtml(statusLabel(service.status))}</div>
        <div class="service-metrics">
          ${service.responseTime !== null ? `${escapeHtml(service.responseTime)}ms` : "Response —"}
          · checked ${escapeHtml(formatRelative(service.lastChecked))}
        </div>
      </div>
    </article>
  `).join("");
}

function renderUptime(services) {
  const container = document.getElementById("uptimeGrid");

  container.innerHTML = services.map(service => `
    <article class="uptime-card">
      <div class="uptime-label">${escapeHtml(service.shortName)}</div>
      <div class="uptime-value">${escapeHtml(uptimeLabel(service.uptime))}</div>
      <div class="uptime-note">Measured from real checks</div>
    </article>
  `).join("");
}

function renderIncidents(incidents) {
  const panel = document.getElementById("incidentPanel");
  const list = document.getElementById("incidents");
  const count = document.getElementById("incidentCount");

  count.textContent = String(incidents.length);

  if (!incidents.length) {
    panel.classList.add("hidden");
    list.innerHTML = "";
    return;
  }

  panel.classList.remove("hidden");

  list.innerHTML = incidents.map(incident => `
    <article class="incident-card">
      <div class="incident-title">${escapeHtml(incident.title)}</div>
      <div class="incident-detail">${escapeHtml(incident.details || "Health checks are failing.")}</div>
      <div class="incident-time">Started ${escapeHtml(formatTime(incident.startedAt))}</div>
    </article>
  `).join("");
}

function renderHistory(incidents) {
  const container = document.getElementById("incidentHistory");

  const history = incidents
    .filter(incident => incident.resolvedAt)
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
    .slice(0, 10);

  if (!history.length) {
    container.innerHTML = `
      <div class="history-empty">
        No resolved incidents have been recorded by this monitor yet.
      </div>
    `;
    return;
  }

  container.innerHTML = history.map(incident => `
    <article class="history-item">
      <span class="history-icon"></span>
      <div>
        <div class="history-title">${escapeHtml(incident.title)}</div>
        <div class="history-meta">
          ${escapeHtml(formatTime(incident.startedAt))}
          → ${escapeHtml(formatTime(incident.resolvedAt))}
        </div>
      </div>
      <div class="history-state">Resolved</div>
    </article>
  `).join("");
}

async function loadStatus() {
  const response = await fetch(`${STATUS_API}?t=${Date.now()}`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Status API returned ${response.status}`);
  }

  const data = await response.json();

  const copy = statusCopy[data.overallStatus] || statusCopy.unknown;

  document.getElementById("overallTitle").textContent = copy.title;
  document.getElementById("overallDescription").textContent = copy.description;
  document.getElementById("lastChecked").textContent = formatTime(data.monitoredAt);

  const mark = document.getElementById("overallMark");
  mark.className = `overall-mark ${copy.className}`;

  renderServices(data.services || []);
  renderUptime(data.services || []);
  renderIncidents(data.incidents || []);

  // The public endpoint may include active incidents only.
  // The engine's persisted incident history is exposed through a future
  // authenticated/admin endpoint if required. This page remains public-safe.
  renderHistory([]);
}

async function refresh() {
  const button = document.getElementById("refreshButton");

  button.disabled = true;
  button.textContent = "Checking";

  try {
    await loadStatus();
  } catch (error) {
    document.getElementById("overallTitle").textContent = "Status unavailable";
    document.getElementById("overallDescription").textContent =
      "The public status endpoint could not be reached. This does not by itself indicate a Dyve outage.";

    console.error(error);
  } finally {
    button.disabled = false;
    button.textContent = "Refresh";
  }
}

document.getElementById("refreshButton").addEventListener("click", refresh);

loadStatus();

setInterval(loadStatus, 60 * 1000);

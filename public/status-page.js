const STATUS_API = "https://status.dyve.online/api/status";

const REFRESH_INTERVAL = 60 * 1000;

const statusCopy = {
  operational: {
    title: "All systems operational",
    description: "All monitored Dyve services are responding normally.",
    className: "operational"
  },

  degraded: {
    title: "Some systems are degraded",
    description: "One or more monitored services are experiencing reduced availability.",
    className: "warning"
  },

  major_outage: {
    title: "A service disruption is active",
    description: "One or more monitored services are currently unavailable.",
    className: "danger"
  },

  unknown: {
    title: "Monitor unavailable",
    description:
      "The public status monitor could not verify service health. No service state is being fabricated.",
    className: "unknown"
  }
};


/* =========================================================
   HELPERS
========================================================= */

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function getElement(id) {
  return document.getElementById(id);
}


function formatTime(value) {

  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}


function formatTimeShort(value) {

  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}


function formatRelative(value) {

  if (!value) {
    return "never";
  }

  const time = new Date(value).getTime();

  if (!Number.isFinite(time)) {
    return "never";
  }

  const seconds = Math.max(
    0,
    Math.floor(
      (Date.now() - time) / 1000
    )
  );


  if (seconds < 60) {
    return `${seconds}s ago`;
  }


  const minutes =
    Math.floor(seconds / 60);


  if (minutes < 60) {
    return `${minutes}m ago`;
  }


  const hours =
    Math.floor(minutes / 60);


  if (hours < 24) {
    return `${hours}h ago`;
  }


  return `${Math.floor(hours / 24)}d ago`;
}


function statusLabel(status) {

  return {

    operational:
      "Operational",

    degraded:
      "Degraded",

    major_outage:
      "Major outage",

    unknown:
      "Collecting data"

  }[status] || "Unknown";

}


function normalizeStatus(status) {

  if (!status) {
    return "unknown";
  }

  const normalized =
    String(status)
      .trim()
      .toLowerCase()
      .replaceAll("-", "_")
      .replaceAll(" ", "_");


  if (
    normalized === "operational" ||
    normalized === "up" ||
    normalized === "healthy" ||
    normalized === "online" ||
    normalized === "ok"
  ) {

    return "operational";

  }


  if (
    normalized === "degraded" ||
    normalized === "warning" ||
    normalized === "partial"
  ) {

    return "degraded";

  }


  if (
    normalized === "major_outage" ||
    normalized === "outage" ||
    normalized === "down" ||
    normalized === "offline" ||
    normalized === "critical"
  ) {

    return "major_outage";

  }


  return "unknown";
}


function uptimeLabel(value) {

  if (
    value === null ||
    value === undefined ||
    value === "" ||
    !Number.isFinite(Number(value))
  ) {

    return "—";

  }


  return `${Number(value).toFixed(2)}%`;
}


function responseLabel(value) {

  if (
    value === null ||
    value === undefined ||
    value === "" ||
    !Number.isFinite(Number(value))
  ) {

    return "—";

  }


  return `${Math.round(Number(value))}ms`;
}


function countByStatus(services) {

  return services.reduce(
    (counts, service) => {

      const status =
        normalizeStatus(
          service.status
        );


      counts.total++;


      if (status === "operational") {
        counts.operational++;
      }

      else if (status === "degraded") {
        counts.degraded++;
      }

      else if (status === "major_outage") {
        counts.outage++;
      }

      else {
        counts.unknown++;
      }


      return counts;

    },
    {
      total: 0,
      operational: 0,
      degraded: 0,
      outage: 0,
      unknown: 0
    }
  );

}


/* =========================================================
   API NORMALIZATION
========================================================= */

function normalizeService(service) {

  return {

    id:
      service.id ||
      "",

    name:
      service.name ||
      service.shortName ||
      "Unnamed service",

    shortName:
      service.shortName ||
      service.name ||
      "Service",

    description:
      service.description ||
      "Monitored Dyve service.",

    status:
      normalizeStatus(
        service.status
      ),

    responseTime:
      service.responseTime ??
      null,

    httpStatus:
      service.httpStatus ??
      null,

    lastChecked:
      service.lastChecked ||
      null,

    lastSuccess:
      service.lastSuccess ||
      null,

    uptime:
      service.uptime ??
      null,

    heartbeat:
      service.heartbeat ||
      {}

  };

}


function normalizeIncident(incident) {

  return {

    id:
      incident.id ||
      "",

    title:
      incident.title ||
      incident.name ||
      "Service incident",

    details:
      incident.details ||
      incident.description ||
      "Health checks are reporting an issue.",

    startedAt:
      incident.startedAt ||
      incident.createdAt ||
      incident.started ||
      null,

    resolvedAt:
      incident.resolvedAt ||
      incident.closedAt ||
      null

  };

}


function normalizePayload(data) {

  const services =
    Array.isArray(data?.services)
      ? data.services.map(
          normalizeService
        )
      : [];


  const incidents =
    Array.isArray(data?.incidents)
      ? data.incidents.map(
          normalizeIncident
        )
      : [];


  let overallStatus =
    normalizeStatus(
      data?.overallStatus
    );


  /*
     If the API explicitly says "unknown",
     we do not invent an operational state.

     However, if overallStatus is missing entirely,
     we can safely derive it from actual service states.
  */

  if (
    !data?.overallStatus &&
    services.length
  ) {

    const counts =
      countByStatus(
        services
      );


    if (counts.outage > 0) {

      overallStatus =
        "major_outage";

    }

    else if (counts.degraded > 0) {

      overallStatus =
        "degraded";

    }

    else if (
      counts.operational ===
      counts.total
    ) {

      overallStatus =
        "operational";

    }

    else {

      overallStatus =
        "unknown";

    }

  }


  return {

    schemaVersion:
      data?.schemaVersion ||
      null,

    generatedAt:
      data?.generatedAt ||
      null,

    monitoredAt:
      data?.monitoredAt ||
      data?.generatedAt ||
      null,

    overallStatus,

    services,

    incidents

  };

}


/* =========================================================
   OVERALL STATE
========================================================= */

function renderOverall(data) {

  const copy =
    statusCopy[
      data.overallStatus
    ] ||
    statusCopy.unknown;


  const title =
    getElement(
      "overallTitle"
    );


  const description =
    getElement(
      "overallDescription"
    );


  const lastChecked =
    getElement(
      "lastChecked"
    );


  const mark =
    getElement(
      "overallMark"
    );


  if (title) {

    title.textContent =
      copy.title;

  }


  if (description) {

    description.textContent =
      copy.description;

  }


  if (lastChecked) {

    lastChecked.textContent =
      formatTime(
        data.monitoredAt
      );

  }


  if (mark) {

    mark.className =
      `overall-mark ${copy.className}`;

  }


  /*
     Optional elements supported if they exist
     in the HTML.
  */

  const state =
    getElement(
      "overallState"
    );


  if (state) {

    state.textContent =
      statusLabel(
        data.overallStatus
      );

  }

}


/* =========================================================
   SERVICE MATRIX
========================================================= */

function renderServices(services) {

  const container =
    getElement(
      "services"
    );


  if (!container) {
    return;
  }


  if (!services.length) {

    container.innerHTML = `
      <div class="empty-state">
        <strong>No services available</strong>
        <span>The monitoring engine has not returned any service data yet.</span>
      </div>
    `;

    return;

  }


  container.innerHTML =
    services.map(
      service => {

        const status =
          normalizeStatus(
            service.status
          );


        const checked =
          formatRelative(
            service.lastChecked
          );


        const response =
          responseLabel(
            service.responseTime
          );


        const uptime =
          uptimeLabel(
            service.uptime
          );


        const http =
          service.httpStatus !== null &&
          service.httpStatus !== undefined
            ? `HTTP ${escapeHtml(service.httpStatus)}`
            : "HTTP —";


        return `

          <article
            class="service"
            data-service-status="${escapeHtml(status)}"
          >

            <span
              class="service-dot ${escapeHtml(status)}"
            ></span>


            <div class="service-main">

              <div class="service-name">
                ${escapeHtml(service.name)}
              </div>

              <div class="service-description">
                ${escapeHtml(service.description)}
              </div>

            </div>


            <div class="service-right">

              <div
                class="service-status ${escapeHtml(status)}"
              >
                ${escapeHtml(
                  statusLabel(status)
                )}
              </div>


              <div class="service-metrics">

                ${
                  response === "—"
                    ? "Response —"
                    : escapeHtml(response)
                }

                · checked
                ${escapeHtml(checked)}

              </div>


              <div class="service-secondary">

                ${escapeHtml(http)}

                ${
                  uptime !== "—"
                    ? ` · ${escapeHtml(uptime)} uptime`
                    : ""
                }

              </div>

            </div>

          </article>

        `;

      }
    ).join("");

}


/* =========================================================
   UPTIME
========================================================= */

function renderUptime(services) {

  const container =
    getElement(
      "uptimeGrid"
    );


  if (!container) {
    return;
  }


  if (!services.length) {

    container.innerHTML = `
      <div class="history-empty">
        Uptime data is not currently available.
      </div>
    `;

    return;

  }


  container.innerHTML =
    services.map(
      service => {

        const status =
          normalizeStatus(
            service.status
          );


        const uptime =
          uptimeLabel(
            service.uptime
          );


        const uptimeNote =
          uptime === "—"
            ? "No verified uptime data"
            : "Measured from real health checks";


        return `

          <article
            class="uptime-card ${escapeHtml(status)}"
          >

            <div class="uptime-label">
              ${escapeHtml(service.shortName)}
            </div>


            <div class="uptime-value">
              ${escapeHtml(uptime)}
            </div>


            <div class="uptime-note">
              ${escapeHtml(uptimeNote)}
            </div>

          </article>

        `;

      }
    ).join("");

}


/* =========================================================
   INCIDENTS
========================================================= */

function renderIncidents(incidents) {

  const panel =
    getElement(
      "incidentPanel"
    );


  const list =
    getElement(
      "incidents"
    );


  const count =
    getElement(
      "incidentCount"
    );


  if (count) {

    count.textContent =
      String(
        incidents.length
      );

  }


  if (!list) {
    return;
  }


  if (!incidents.length) {

    if (panel) {

      panel.classList.add(
        "hidden"
      );

    }


    list.innerHTML = `
      <div class="history-empty">
        No active incidents have been reported by the monitor.
      </div>
    `;

    return;

  }


  if (panel) {

    panel.classList.remove(
      "hidden"
    );

  }


  list.innerHTML =
    incidents.map(
      incident => `

        <article class="incident-card">

          <div class="incident-title">
            ${escapeHtml(
              incident.title
            )}
          </div>


          <div class="incident-detail">
            ${escapeHtml(
              incident.details
            )}
          </div>


          <div class="incident-time">
            Started
            ${escapeHtml(
              formatTime(
                incident.startedAt
              )
            )}
          </div>

        </article>

      `
    ).join("");

}


/* =========================================================
   INCIDENT HISTORY
========================================================= */

function renderHistory(incidents) {

  const container =
    getElement(
      "incidentHistory"
    );


  if (!container) {
    return;
  }


  const history =
    incidents
      .filter(
        incident =>
          incident.resolvedAt
      )
      .sort(
        (a, b) =>
          new Date(
            b.startedAt
          ) -
          new Date(
            a.startedAt
          )
      )
      .slice(
        0,
        10
      );


  if (!history.length) {

    container.innerHTML = `
      <div class="history-empty">
        No resolved incidents have been recorded by this monitor yet.
      </div>
    `;

    return;

  }


  container.innerHTML =
    history.map(
      incident => `

        <article class="history-item">

          <span class="history-icon"></span>


          <div>

            <div class="history-title">
              ${escapeHtml(
                incident.title
              )}
            </div>


            <div class="history-meta">

              ${escapeHtml(
                formatTime(
                  incident.startedAt
                )
              )}

              →

              ${escapeHtml(
                formatTime(
                  incident.resolvedAt
                )
              )}

            </div>

          </div>


          <div class="history-state">
            Resolved
          </div>

        </article>

      `
    ).join("");

}


/* =========================================================
   SUMMARY METRICS
========================================================= */

function renderSummary(data) {

  const services =
    data.services || [];


  const counts =
    countByStatus(
      services
    );


  const serviceCount =
    getElement(
      "serviceCount"
    );


  const operationalCount =
    getElement(
      "operationalCount"
    );


  const degradedCount =
    getElement(
      "degradedCount"
    );


  const outageCount =
    getElement(
      "outageCount"
    );


  const unknownCount =
    getElement(
      "unknownCount"
    );


  const activeIncidentCount =
    getElement(
      "activeIncidentCount"
    );


  if (serviceCount) {

    serviceCount.textContent =
      String(
        counts.total
      ).padStart(
        2,
        "0"
      );

  }


  if (operationalCount) {

    operationalCount.textContent =
      String(
        counts.operational
      ).padStart(
        2,
        "0"
      );

  }


  if (degradedCount) {

    degradedCount.textContent =
      String(
        counts.degraded
      ).padStart(
        2,
        "0"
      );

  }


  if (outageCount) {

    outageCount.textContent =
      String(
        counts.outage
      ).padStart(
        2,
        "0"
      );

  }


  if (unknownCount) {

    unknownCount.textContent =
      String(
        counts.unknown
      ).padStart(
        2,
        "0"
      );

  }


  if (activeIncidentCount) {

    activeIncidentCount.textContent =
      String(
        data.incidents.length
      ).padStart(
        2,
        "0"
      );

  }

}


/* =========================================================
   LATEST PROBE
========================================================= */

function renderLatestProbe(data) {

  const services =
    data.services || [];


  const probe =
    getElement(
      "latestProbe"
    );


  if (!probe) {
    return;
  }


  if (!services.length) {

    probe.innerHTML = `
      <div class="probe-status unknown">
        NO DATA
      </div>

      <div class="probe-description">
        The monitoring engine has not returned service telemetry.
      </div>
    `;

    return;

  }


  const latest =
    [...services]
      .sort(
        (a, b) => {

          const aTime =
            new Date(
              a.lastChecked || 0
            ).getTime();


          const bTime =
            new Date(
              b.lastChecked || 0
            ).getTime();


          return bTime - aTime;

        }
      )[0];


  const status =
    normalizeStatus(
      latest.status
    );


  const response =
    responseLabel(
      latest.responseTime
    );


  const checked =
    formatTime(
      latest.lastChecked
    );


  probe.innerHTML = `

    <div class="probe-status ${escapeHtml(status)}">

      ${escapeHtml(
        statusLabel(status).toUpperCase()
      )}

    </div>


    <div class="probe-description">

      ${escapeHtml(
        latest.name
      )}

      ·

      ${escapeHtml(
        response
      )}

      · checked

      ${escapeHtml(
        checked
      )}

    </div>

  `;

}


/* =========================================================
   MONITOR STATUS
========================================================= */

function renderMonitorState(data) {

  const monitor =
    getElement(
      "monitorState"
    );


  if (!monitor) {
    return;
  }


  const hasServices =
    data.services.length > 0;


  const hasRecentTelemetry =
    data.services.some(
      service =>
        service.lastChecked
    );


  if (!hasServices) {

    monitor.textContent =
      "OFFLINE";

    return;

  }


  if (!hasRecentTelemetry) {

    monitor.textContent =
      "WAITING";

    return;

  }


  monitor.textContent =
    "ACTIVE";

}


/* =========================================================
   LOAD STATUS
========================================================= */

async function loadStatus() {

  const requestUrl =
    `${STATUS_API}?t=${Date.now()}`;


  try {

    const response =
      await fetch(
        requestUrl,
        {
          method: "GET",

          cache:
            "no-store",

          headers: {
            "Accept":
              "application/json"
          }
        }
      );


    if (!response.ok) {

      throw new Error(
        `Status API returned HTTP ${response.status}`
      );

    }


    const raw =
      await response.json();


    const data =
      normalizePayload(
        raw
      );


    /*
       The API has responded successfully.
       Render the actual state it returned.
    */

    renderOverall(
      data
    );


    renderServices(
      data.services
    );


    renderUptime(
      data.services
    );


    renderIncidents(
      data.incidents
    );


    renderHistory(
      data.incidents
    );


    renderSummary(
      data
    );


    renderLatestProbe(
      data
    );


    renderMonitorState(
      data
    );


    /*
       Optional timestamp elements.
    */

    const generatedAt =
      getElement(
        "generatedAt"
      );


    if (generatedAt) {

      generatedAt.textContent =
        formatTime(
          data.generatedAt
        );

    }


    const schemaVersion =
      getElement(
        "schemaVersion"
      );


    if (schemaVersion) {

      schemaVersion.textContent =
        data.schemaVersion
          ? `v${data.schemaVersion}`
          : "—";

    }


    return data;

  }

  catch (error) {

    console.error(
      "[DYVE STATUS]",
      error
    );


    /*
       IMPORTANT:
       Do not label the platform itself as down merely because
       the status API cannot be reached.

       The monitor is unavailable.
       That is different from the monitored services being down.
    */

    const title =
      getElement(
        "overallTitle"
      );


    const description =
      getElement(
        "overallDescription"
      );


    const lastChecked =
      getElement(
        "lastChecked"
      );


    const mark =
      getElement(
        "overallMark"
      );


    if (title) {

      title.textContent =
        "Monitor unavailable";

    }


    if (description) {

      description.textContent =
        "The public status monitor could not be reached. Service health cannot currently be verified.";

    }


    if (lastChecked) {

      lastChecked.textContent =
        "Connection failed";

    }


    if (mark) {

      mark.className =
        "overall-mark unknown";

    }


    const services =
      getElement(
        "services"
      );


    if (services) {

      services.innerHTML = `
        <div class="empty-state">
          <strong>Monitoring data unavailable</strong>
          <span>
            The status engine did not return live service telemetry.
            No service is being incorrectly marked operational.
          </span>
        </div>
      `;

    }


    const uptime =
      getElement(
        "uptimeGrid"
      );


    if (uptime) {

      uptime.innerHTML = `
        <div class="history-empty">
          Uptime cannot be verified while the monitor is unavailable.
        </div>
      `;

    }


    const latestProbe =
      getElement(
        "latestProbe"
      );


    if (latestProbe) {

      latestProbe.innerHTML = `
        <div class="probe-status unknown">
          NO DATA
        </div>

        <div class="probe-description">
          The monitoring engine could not be reached.
        </div>
      `;

    }


    const monitor =
      getElement(
        "monitorState"
      );


    if (monitor) {

      monitor.textContent =
        "OFFLINE";

    }


    return null;

  }

}


/* =========================================================
   MANUAL REFRESH
========================================================= */

async function refresh() {

  const button =
    getElement(
      "refreshButton"
    );


  if (button) {

    button.disabled =
      true;

    button.textContent =
      "Checking...";

  }


  try {

    await loadStatus();

  }

  finally {

    if (button) {

      button.disabled =
        false;

      button.textContent =
        "Refresh";

    }

  }

}


/* =========================================================
   INITIALIZATION
========================================================= */

document.addEventListener(
  "DOMContentLoaded",
  () => {

    const button =
      getElement(
        "refreshButton"
      );


    if (button) {

      button.addEventListener(
        "click",
        refresh
      );

    }


    loadStatus();


    setInterval(
      loadStatus,
      REFRESH_INTERVAL
    );

  }
);
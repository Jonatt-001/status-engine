"use strict";

/* =========================================================
   DYVE PUBLIC STATUS ENGINE
   Synced specifically with index.html
========================================================= */

const STATUS_API = "https://status.dyve.online/api/status";

const REFRESH_INTERVAL = 60 * 1000;
const CLOCK_INTERVAL = 1000;
const MAX_EVENTS = 30;
const AVAILABILITY_DAYS = 30;

let latestData = null;
let lastFetchDuration = null;
let refreshInProgress = false;
let bootComplete = false;

const eventHistory = [];


/* =========================================================
   STATUS DEFINITIONS
========================================================= */

const STATUS_COPY = {

  operational: {
    title: "ALL SYSTEMS OPERATIONAL",
    description:
      "All monitored DYVE services are responding normally.",
    className: "operational"
  },

  degraded: {
    title: "SOME SYSTEMS ARE DEGRADED",
    description:
      "One or more monitored services are experiencing reduced availability.",
    className: "warning"
  },

  major_outage: {
    title: "A SERVICE DISRUPTION IS ACTIVE",
    description:
      "One or more monitored services are currently unavailable.",
    className: "danger"
  },

  unknown: {
    title: "MONITOR UNAVAILABLE",
    description:
      "The monitoring engine could not verify service health. No service state is being fabricated.",
    className: "unknown"
  }

};


/* =========================================================
   DOM HELPERS
========================================================= */

function $(id) {
  return document.getElementById(id);
}


function setText(id, value) {

  const element = $(id);

  if (!element) {
    return;
  }

  element.textContent = value ?? "";

}


function escapeHtml(value) {

  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

}


/* =========================================================
   TIME
========================================================= */

function formatDate(value) {

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


function formatClock(value = new Date()) {

  const date =
    value instanceof Date
      ? value
      : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "00:00:00 UTC";
  }

  const hours =
    String(date.getUTCHours()).padStart(2, "0");

  const minutes =
    String(date.getUTCMinutes()).padStart(2, "0");

  const seconds =
    String(date.getUTCSeconds()).padStart(2, "0");

  return `${hours}:${minutes}:${seconds} UTC`;

}


function formatRelative(value) {

  if (!value) {
    return "never";
  }

  const timestamp =
    new Date(value).getTime();

  if (!Number.isFinite(timestamp)) {
    return "never";
  }

  const seconds =
    Math.max(
      0,
      Math.floor(
        (Date.now() - timestamp) / 1000
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

  const days =
    Math.floor(hours / 24);

  return `${days}d ago`;

}


function formatDurationFromNow(value) {

  if (!value) {
    return "—";
  }

  const timestamp =
    new Date(value).getTime();

  if (!Number.isFinite(timestamp)) {
    return "—";
  }

  const seconds =
    Math.max(
      0,
      Math.floor(
        (Date.now() - timestamp) / 1000
      )
    );

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes =
    Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours =
    Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}h`;
  }

  return `${Math.floor(hours / 24)}d`;

}


/* =========================================================
   STATUS NORMALIZATION
========================================================= */

function normalizeStatus(status) {

  if (
    status === null ||
    status === undefined
  ) {
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
    normalized === "healthy" ||
    normalized === "online" ||
    normalized === "up" ||
    normalized === "ok" ||
    normalized === "success"
  ) {
    return "operational";
  }


  if (
    normalized === "degraded" ||
    normalized === "warning" ||
    normalized === "partial" ||
    normalized === "slow"
  ) {
    return "degraded";
  }


  if (
    normalized === "major_outage" ||
    normalized === "outage" ||
    normalized === "down" ||
    normalized === "offline" ||
    normalized === "critical" ||
    normalized === "failed" ||
    normalized === "failure"
  ) {
    return "major_outage";
  }


  return "unknown";

}


function statusLabel(status) {

  const normalized =
    normalizeStatus(status);

  return {

    operational: "Operational",
    degraded: "Degraded",
    major_outage: "Major outage",
    unknown: "Unknown"

  }[normalized];

}


/* =========================================================
   NUMBERS
========================================================= */

function isNumber(value) {

  return (
    value !== null &&
    value !== undefined &&
    value !== "" &&
    Number.isFinite(
      Number(value)
    )
  );

}


function formatPercentage(value) {

  if (!isNumber(value)) {
    return "—";
  }

  return `${Number(value).toFixed(2)}%`;

}


function formatLatency(value) {

  if (!isNumber(value)) {
    return "—";
  }

  return `${Math.round(Number(value))}ms`;

}


function padNumber(value, length = 2) {

  return String(
    Number(value) || 0
  ).padStart(
    length,
    "0"
  );

}


/* =========================================================
   ARRAY / OBJECT NORMALIZATION
========================================================= */

function normalizeService(service, index) {

  const source =
    service &&
    typeof service === "object"
      ? service
      : {};


  return {

    id:
      source.id ||
      source.slug ||
      source.key ||
      `service-${index + 1}`,

    name:
      source.name ||
      source.shortName ||
      source.title ||
      `Service ${index + 1}`,

    shortName:
      source.shortName ||
      source.name ||
      source.title ||
      `Service ${index + 1}`,

    description:
      source.description ||
      "Monitored DYVE service.",

    status:
      normalizeStatus(
        source.status
      ),

    responseTime:
      isNumber(source.responseTime)
        ? Number(source.responseTime)
        : null,

    httpStatus:
      isNumber(source.httpStatus)
        ? Number(source.httpStatus)
        : null,

    uptime:
      isNumber(source.uptime)
        ? Number(source.uptime)
        : null,

    lastChecked:
      source.lastChecked ||
      source.checkedAt ||
      source.lastProbe ||
      null,

    lastSuccess:
      source.lastSuccess ||
      null,

    heartbeat:
      source.heartbeat ||
      null,

    availability:
      source.availability ||
      source.history ||
      null,

    history:
      source.history ||
      null,

    region:
      source.region ||
      source.identifier ||
      source.origin ||
      "01"

  };

}


function normalizeIncident(incident, index) {

  const source =
    incident &&
    typeof incident === "object"
      ? incident
      : {};


  return {

    id:
      source.id ||
      `incident-${index + 1}`,

    title:
      source.title ||
      source.name ||
      "Service incident",

    details:
      source.details ||
      source.description ||
      "Health checks are reporting an issue.",

    status:
      normalizeStatus(
        source.status
      ),

    startedAt:
      source.startedAt ||
      source.started ||
      source.createdAt ||
      null,

    resolvedAt:
      source.resolvedAt ||
      source.resolved ||
      source.closedAt ||
      null

  };

}


/* =========================================================
   PAYLOAD NORMALIZATION
========================================================= */

function normalizePayload(raw) {

  const data =
    raw &&
    typeof raw === "object"
      ? raw
      : {};


  const services =
    Array.isArray(data.services)
      ? data.services.map(
          normalizeService
        )
      : [];


  const incidents =
    Array.isArray(data.incidents)
      ? data.incidents.map(
          normalizeIncident
        )
      : [];


  let overallStatus =
    data.overallStatus
      ? normalizeStatus(
          data.overallStatus
        )
      : null;


  /*
     Only derive an overall status if the API did not
     explicitly provide one.

     This prevents the frontend from turning an explicit
     "unknown" state into "operational".
  */

  if (!overallStatus) {

    overallStatus =
      deriveOverallStatus(
        services
      );

  }


  return {

    schemaVersion:
      data.schemaVersion ||
      null,

    generatedAt:
      data.generatedAt ||
      null,

    monitoredAt:
      data.monitoredAt ||
      data.generatedAt ||
      null,

    overallStatus,

    services,

    incidents,

    raw: data

  };

}


/* =========================================================
   OVERALL STATUS
========================================================= */

function deriveOverallStatus(services) {

  if (!services.length) {
    return "unknown";
  }


  const statuses =
    services.map(
      service =>
        normalizeStatus(
          service.status
        )
    );


  if (
    statuses.includes(
      "major_outage"
    )
  ) {
    return "major_outage";
  }


  if (
    statuses.includes(
      "degraded"
    )
  ) {
    return "degraded";
  }


  if (
    statuses.every(
      status =>
        status === "operational"
    )
  ) {
    return "operational";
  }


  return "unknown";

}


/* =========================================================
   SUMMARY CALCULATIONS
========================================================= */

function getServiceCounts(services) {

  return services.reduce(
    (result, service) => {

      const status =
        normalizeStatus(
          service.status
        );


      result.total++;


      if (
        status ===
        "operational"
      ) {
        result.operational++;
      }

      else if (
        status ===
        "degraded"
      ) {
        result.degraded++;
      }

      else if (
        status ===
        "major_outage"
      ) {
        result.outage++;
      }

      else {
        result.unknown++;
      }


      return result;

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


function calculateAverageUptime(services) {

  const values =
    services
      .map(
        service =>
          Number(service.uptime)
      )
      .filter(
        value =>
          Number.isFinite(value)
      );


  if (!values.length) {
    return null;
  }


  return (
    values.reduce(
      (sum, value) =>
        sum + value,
      0
    ) / values.length
  );

}


function calculateMedianLatency(services) {

  const values =
    services
      .map(
        service =>
          Number(service.responseTime)
      )
      .filter(
        value =>
          Number.isFinite(value)
      )
      .sort(
        (a, b) =>
          a - b
      );


  if (!values.length) {
    return null;
  }


  const middle =
    Math.floor(
      values.length / 2
    );


  if (
    values.length % 2 ===
    0
  ) {

    return (
      values[middle - 1] +
      values[middle]
    ) / 2;

  }


  return values[middle];

}


/* =========================================================
   GLOBAL OVERVIEW
========================================================= */

function renderGlobalState(data) {

  const status =
    normalizeStatus(
      data.overallStatus
    );


  const copy =
    STATUS_COPY[status] ||
    STATUS_COPY.unknown;


  setText(
    "globalState",
    copy.title
  );


  setText(
    "globalSub",
    copy.description
  );


  const indicator =
    $("globalIndicator");


  if (indicator) {

    indicator.className =
      `overview-status-indicator ${copy.className}`;

  }


  document.body.dataset.status =
    status;

}


/* =========================================================
   METRICS
========================================================= */

function renderMetrics(data) {

  const services =
    data.services;


  const counts =
    getServiceCounts(
      services
    );


  const uptime =
    calculateAverageUptime(
      services
    );


  const latency =
    calculateMedianLatency(
      services
    );


  const errorRate =
    uptime === null
      ? null
      : Math.max(
          0,
          100 - uptime
        );


  setText(
    "uptimeMetric",
    formatPercentage(
      uptime
    )
  );


  setText(
    "latencyMetric",
    formatLatency(
      latency
    )
  );


  setText(
    "errorMetric",
    formatPercentage(
      errorRate
    )
  );


  setText(
    "nodeMetric",
    `${padNumber(counts.operational)} / ${padNumber(counts.total)}`
  );


  setText(
    "incidentMetric",
    padNumber(
      data.incidents.length
    )
  );


  setText(
    "serviceCount",
    padNumber(
      counts.total
    )
  );


  const serviceMeta =
    $("serviceMeta");


  if (serviceMeta) {

    if (!counts.total) {

      serviceMeta.textContent =
        "0 SERVICES / WAITING";

    }

    else {

      serviceMeta.textContent =
        `${padNumber(counts.total)} SERVICES / LIVE`;

    }

  }


  setText(
    "checksPassed",
    padNumber(
      counts.total
    )
  );


  setText(
    "requestsMinute",
    padNumber(
      counts.operational
    )
  );


  setText(
    "p95",
    padNumber(
      counts.degraded
    )
  );


  setText(
    "p99",
    padNumber(
      counts.outage
    )
  );


  setText(
    "errorBudget",
    padNumber(
      counts.unknown
    )
  );

}


/* =========================================================
   SERVICE MATRIX
========================================================= */

function serviceSymbolSvg(service) {

  const name =
    String(
      service.name
    ).toLowerCase();


  if (
    name.includes("api")
  ) {

    return `
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
      >
        <path d="M8 9l-4 3 4 3"/>
        <path d="M16 9l4 3-4 3"/>
        <path d="M14 5l-4 14"/>
      </svg>
    `;

  }


  if (
    name.includes("database") ||
    name.includes("db")
  ) {

    return `
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
      >
        <ellipse cx="12" cy="5" rx="7" ry="3"/>
        <path d="M5 5v7c0 1.7 3.1 3 7 3s7-1.3 7-3V5"/>
        <path d="M5 12v7c0 1.7 3.1 3 7 3s7-1.3 7-3v-7"/>
      </svg>
    `;

  }


  if (
    name.includes("auth") ||
    name.includes("identity")
  ) {

    return `
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
      >
        <rect x="5" y="10" width="14" height="10" rx="1"/>
        <path d="M8 10V7a4 4 0 018 0v3"/>
        <circle cx="12" cy="15" r="1"/>
      </svg>
    `;

  }


  if (
    name.includes("media") ||
    name.includes("image") ||
    name.includes("cdn")
  ) {

    return `
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
      >
        <rect x="4" y="4" width="16" height="16" rx="1"/>
        <circle cx="9" cy="9" r="1.5"/>
        <path d="M4 17l5-5 3 3 2-2 6 5"/>
      </svg>
    `;

  }


  return `
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
    >
      <rect x="4" y="4" width="16" height="16" rx="2"/>
      <path d="M8 12h8"/>
      <path d="M12 8v8"/>
    </svg>
  `;

}


function renderServiceMatrix(services) {

  const container =
    $("serviceMatrix");


  if (!container) {
    return;
  }


  if (!services.length) {

    container.innerHTML = `
      <div class="incident-empty">
        No service telemetry is currently available.
      </div>
    `;

    return;

  }


  container.innerHTML =
    services.map(
      (service, index) => {

        const status =
          normalizeStatus(
            service.status
          );


        const latency =
          formatLatency(
            service.responseTime
          );


        const uptime =
          formatPercentage(
            service.uptime
          );


        const checked =
          service.lastChecked
            ? formatRelative(
                service.lastChecked
              )
            : "not checked";


        const identifier =
          service.id ||
          `service-${index + 1}`;


        return `

          <article
            class="service-row"
            data-service-id="${escapeHtml(identifier)}"
            tabindex="0"
            role="button"
            aria-label="View telemetry for ${escapeHtml(service.name)}"
          >

            <div class="service-name-cell">

              <div class="service-symbol">
                ${serviceSymbolSvg(service)}
              </div>

              <div>

                <div class="service-name">
                  ${escapeHtml(service.name)}
                </div>

                <div class="service-id">
                  ${escapeHtml(service.description)}
                </div>

              </div>

            </div>


            <div class="service-state">

              <span
                class="health-dot ${escapeHtml(status)}"
              ></span>

              ${escapeHtml(
                statusLabel(status)
              )}

            </div>


            <div class="service-data">

              <div class="service-data-item">

                <div class="service-data-label">
                  Latency
                </div>

                <div class="service-data-value">
                  ${escapeHtml(latency)}
                </div>

              </div>


              <div class="service-data-item">

                <div class="service-data-label">
                  Uptime
                </div>

                <div class="service-data-value ${status === "operational" ? "green" : ""}">
                  ${escapeHtml(uptime)}
                </div>

              </div>


              <div class="service-data-item">

                <div class="service-data-label">
                  Last check
                </div>

                <div class="service-data-value">
                  ${escapeHtml(checked)}
                </div>

              </div>

            </div>

          </article>

        `;

      }
    ).join("");


  container
    .querySelectorAll(
      ".service-row"
    )
    .forEach(
      row => {

        const open =
          () => {

            const service =
              latestData?.services?.find(
                item =>
                  String(item.id) ===
                  String(
                    row.dataset.serviceId
                  )
              );


            if (service) {
              openServiceModal(
                service
              );
            }

          };


        row.addEventListener(
          "click",
          open
        );


        row.addEventListener(
          "keydown",
          event => {

            if (
              event.key ===
              "Enter" ||
              event.key ===
              " "
            ) {

              event.preventDefault();

              open();

            }

          }
        );

      }
    );

}


/* =========================================================
   AVAILABILITY HISTORY
========================================================= */

function normalizeAvailabilityHistory(service) {

  const candidates = [

    service.availability,

    service.history,

    service.heartbeat?.history,

    service.heartbeat?.daily,

    service.heartbeat?.availability,

    service.heartbeat

  ];


  for (
    const candidate of candidates
  ) {

    if (
      Array.isArray(candidate) &&
      candidate.length
    ) {

      return candidate;

    }


    if (
      candidate &&
      typeof candidate === "object"
    ) {

      const values =
        Object.entries(
          candidate
        );


      if (values.length) {

        return values.map(
          ([date, value]) => ({
            date,
            value
          })
        );

      }

    }

  }


  return [];

}


function normalizeAvailabilityStatus(value) {

  if (
    value &&
    typeof value === "object"
  ) {

    return normalizeStatus(
      value.status ||
      value.state ||
      value.result
    );

  }


  return normalizeStatus(
    value
  );

}


function renderAvailability(services) {

  const container =
    $("availabilityMatrix");


  if (!container) {
    return;
  }


  if (!services.length) {

    container.innerHTML = `
      <div style="
        padding:18px 0;
        color:rgba(216,246,228,.45);
        font-family:var(--sans);
        font-size:8px;
        line-height:1.6;
      ">
        Availability history will appear when the monitoring engine provides historical probe data.
      </div>
    `;

    return;

  }


  container.innerHTML =
    services.map(
      service => {

        const history =
          normalizeAvailabilityHistory(
            service
          );


        const recent =
          history.slice(
            -AVAILABILITY_DAYS
          );


        const bars = [];


        for (
          let index = 0;
          index < AVAILABILITY_DAYS;
          index++
        ) {

          const item =
            recent[
              index -
              (
                AVAILABILITY_DAYS -
                recent.length
              )
            ];


          if (!item) {

            bars.push(`
              <span
                class="availability-bar unknown"
                title="No historical data"
              ></span>
            `);

            continue;

          }


          const status =
            normalizeAvailabilityStatus(
              item
            );


          const value =
            item &&
            typeof item === "object"
              ? item.value ??
                item.uptime ??
                item.status ??
                item.state
              : item;


          const strong =
            isNumber(value) &&
            Number(value) >= 99.5
              ? "strong"
              : "";


          const date =
            item &&
            typeof item === "object"
              ? item.date ||
                item.timestamp ||
                item.time
              : null;


          bars.push(`
            <span
              class="availability-bar ${escapeHtml(status)} ${strong}"
              data-date="${escapeHtml(date || "")}"
              data-service="${escapeHtml(service.name)}"
              data-status="${escapeHtml(status)}"
              title="${escapeHtml(
                date
                  ? `${formatDate(date)} · ${statusLabel(status)}`
                  : statusLabel(status)
              )}"
            ></span>
          `);

        }


        return `

          <div class="availability-row">

            <div class="availability-name">
              ${escapeHtml(
                service.shortName
              )}
            </div>


            <div class="availability-bars">
              ${bars.join("")}
            </div>


            <div class="availability-value">
              ${escapeHtml(
                formatPercentage(
                  service.uptime
                )
              )}
            </div>

          </div>

        `;

      }
    ).join("");

}


/* =========================================================
   EVENT STREAM
========================================================= */

function addEvent(
  type,
  target,
  result,
  tone = "",
  timestamp = new Date()
) {

  eventHistory.unshift({

    id:
      `${Date.now()}-${Math.random()}`,

    time:
      timestamp instanceof Date
        ? timestamp
        : new Date(timestamp),

    type,
    target,
    result,
    tone

  });


  if (
    eventHistory.length >
    MAX_EVENTS
  ) {

    eventHistory.length =
      MAX_EVENTS;

  }

}


function buildEventsFromData(data) {

  const now =
    new Date();


  addEvent(
    "SYNC",
    "STATUS ENGINE",
    "RECEIVED",
    "operational",
    now
  );


  data.services.forEach(
    service => {

      const status =
        normalizeStatus(
          service.status
        );


      addEvent(
        "PROBE",
        service.name,
        statusLabel(
          status
        ).toUpperCase(),
        status === "operational"
          ? "operational"
          : status === "degraded"
            ? "warning"
            : status === "major_outage"
              ? "danger"
              : ""
      );

    }
  );


  data.incidents
    .slice(0, 5)
    .forEach(
      incident => {

        addEvent(
          "INCIDENT",
          incident.title,
          "ACTIVE",
          "danger",
          incident.startedAt
            ? new Date(
                incident.startedAt
              )
            : now
        );

      }
    );

}


function renderEventStream() {

  const container =
    $("eventStream");


  if (!container) {
    return;
  }


  const events =
    eventHistory
      .slice(
        0,
        MAX_EVENTS
      );


  setText(
    "eventCount",
    padNumber(
      events.length
    )
  );


  if (!events.length) {

    container.innerHTML = `
      <div class="incident-empty">
        Waiting for live monitoring activity.
      </div>
    `;

    return;

  }


  container.innerHTML =
    events.map(
      event => {

        const time =
          event.time instanceof Date &&
          !Number.isNaN(
            event.time.getTime()
          )
            ? formatClock(
                event.time
              ).replace(
                " UTC",
                ""
              )
            : "--:--:--";


        return `

          <div class="event">

            <div class="event-time">
              ${escapeHtml(time)}
            </div>

            <div class="event-type">
              ${escapeHtml(event.type)}
            </div>

            <div class="event-target">
              ${escapeHtml(event.target)}
            </div>

            <div class="event-result ${escapeHtml(event.tone)}">
              ${escapeHtml(event.result)}
            </div>

          </div>

        `;

      }
    ).join("");

}


/* =========================================================
   INCIDENT LEDGER
========================================================= */

function renderIncidentLedger(incidents) {

  const container =
    $("incidentLedger");


  if (!container) {
    return;
  }


  if (!incidents.length) {

    container.innerHTML = `
      <div class="incident-empty">
        No incidents have been reported by the monitor.
      </div>
    `;

    return;

  }


  container.innerHTML =
    incidents.map(
      incident => {

        const status =
          normalizeStatus(
            incident.status
          );


        const tone =
          status === "major_outage"
            ? "danger"
            : status === "degraded"
              ? "warning"
              : "";


        return `

          <article class="incident">

            <span
              class="incident-marker ${tone}"
            ></span>


            <div class="incident-date">

              ${
                incident.startedAt
                  ? escapeHtml(
                      formatDate(
                        incident.startedAt
                      )
                    )
                  : "Date unavailable"
              }

            </div>


            <div>

              <div class="incident-description">

                ${escapeHtml(
                  incident.title
                )}

              </div>


              <div
                style="
                  color:var(--muted);
                  font-family:var(--sans);
                  font-size:7px;
                  line-height:1.45;
                  margin-top:4px;
                "
              >

                ${escapeHtml(
                  incident.details
                )}

              </div>

            </div>


            <div
              class="incident-state ${incident.resolvedAt ? "" : tone}"
            >

              ${
                incident.resolvedAt
                  ? "Resolved"
                  : "Active"
              }

            </div>

          </article>

        `;

      }
    ).join("");

}


/* =========================================================
   MONITOR TELEMETRY
========================================================= */

function renderMonitorTelemetry(data) {

  const services =
    data.services;


  const counts =
    getServiceCounts(
      services
    );


  const monitorStatus =
    normalizeStatus(
      data.overallStatus
    );


  if (!lastFetchDuration) {

    setText(
      "nodeLatency",
      "--ms"
    );

  }

  else {

    setText(
      "nodeLatency",
      `${Math.round(lastFetchDuration)}ms`
    );

  }


  setText(
    "nodeStatus",
    monitorStatus === "unknown"
      ? "REACHABLE"
      : "ONLINE"
  );


  setText(
    "cycleStatus",
    services.length
      ? "ACTIVE"
      : "WAITING"
  );


  setText(
    "cycleAge",
    data.monitoredAt
      ? `${formatDurationFromNow(data.monitoredAt)} ago`
      : "--"
  );


  setText(
    "monitorState",
    services.length
      ? "ONLINE"
      : "WAITING"
  );


  setText(
    "checksHour",
    "60s"
  );


  setText(
    "serviceCount",
    padNumber(
      counts.total
    )
  );


  const latest =
    [...services]
      .filter(
        service =>
          service.lastChecked
      )
      .sort(
        (a, b) =>
          new Date(
            b.lastChecked
          ) -
          new Date(
            a.lastChecked
          )
      )[0];


  if (!latest) {

    setText(
      "probeResult",
      "NO DATA"
    );


    setText(
      "latestCheck",
      "No verified service probe is currently available."
    );

    return;

  }


  const latestStatus =
    normalizeStatus(
      latest.status
    );


  setText(
    "probeResult",
    statusLabel(
      latestStatus
    ).toUpperCase()
  );


  setText(
    "latestCheck",
    `${latest.name} · ${formatLatency(latest.responseTime)} · checked ${formatDate(latest.lastChecked)}`
  );


  const probeResult =
    $("probeResult");


  if (probeResult) {

    probeResult.style.color =
      latestStatus === "major_outage"
        ? "var(--red)"
        : latestStatus === "degraded"
          ? "var(--amber)"
          : latestStatus === "operational"
            ? "var(--green-700)"
            : "var(--muted)";

  }

}


/* =========================================================
   SCAN STATUS
========================================================= */

function renderScanStatus(data) {

  const counts =
    getServiceCounts(
      data.services
    );


  if (!data.services.length) {

    setText(
      "scanText",
      "WAITING FOR SERVICE TELEMETRY"
    );

    return;

  }


  if (
    counts.unknown ===
    counts.total
  ) {

    setText(
      "scanText",
      "MONITOR REACHABLE · SERVICE TELEMETRY UNVERIFIED"
    );

    return;

  }


  setText(
    "scanText",
    `LIVE MONITORING · ${counts.operational}/${counts.total} SERVICES OPERATIONAL`
  );

}


/* =========================================================
   LAST CHECK TIMESTAMP
========================================================= */

function renderLastChecked(data) {

  const timestamp =
    data.monitoredAt;


  if (!timestamp) {
    return;
  }


  const clock =
    $("systemClock");


  if (clock) {

    clock.title =
      `Last monitor synchronization: ${formatDate(timestamp)}`;

  }

}


/* =========================================================
   SERVICE MODAL
========================================================= */

function openServiceModal(service) {

  const layer =
    $("modalLayer");


  if (!layer) {
    return;
  }


  const status =
    normalizeStatus(
      service.status
    );


  setText(
    "modalService",
    service.name
  );


  setText(
    "modalState",
    statusLabel(
      status
    ).toUpperCase()
  );


  setText(
    "modalLatency",
    formatLatency(
      service.responseTime
    )
  );


  setText(
    "modalUptime",
    formatPercentage(
      service.uptime
    )
  );


  setText(
    "modalChecks",
    service.httpStatus
      ? `HTTP ${service.httpStatus}`
      : "—"
  );


  setText(
    "modalRegion",
    service.id
  );


  setText(
    "modalLastCheck",
    formatDate(
      service.lastChecked
    )
  );


  setText(
    "modalDescription",
    service.description ||
      "Live service telemetry provided by the DYVE monitoring engine."
  );


  const dot =
    $("modalDot");


  if (dot) {

    dot.className =
      `health-dot ${status}`;

  }


  const state =
    $("modalState");


  if (state) {

    state.style.color =
      status === "major_outage"
        ? "var(--red)"
        : status === "degraded"
          ? "var(--amber)"
          : status === "operational"
            ? "var(--green-700)"
            : "var(--muted)";

  }


  layer.classList.add(
    "visible"
  );


  document.body.style.overflow =
    "hidden";

}


function closeModal(event) {

  if (
    event &&
    event.target &&
    event.target.id !==
      "modalLayer"
  ) {

    return;

  }


  const layer =
    $("modalLayer");


  if (layer) {

    layer.classList.remove(
      "visible"
    );

  }


  document.body.style.overflow =
    "";

}


window.closeModal =
  closeModal;


/* =========================================================
   TOOLTIP
========================================================= */

function initAvailabilityTooltip() {

  const container =
    $("availabilityMatrix");


  const tooltip =
    $("tooltip");


  if (
    !container ||
    !tooltip
  ) {
    return;
  }


  container.addEventListener(
    "pointerover",
    event => {

      const bar =
        event.target.closest(
          ".availability-bar"
        );


      if (!bar) {
        return;
      }


      setText(
        "tooltipDate",
        bar.dataset.date
          ? formatDate(
              bar.dataset.date
            )
          : "Historical data unavailable"
      );


      setText(
        "tooltipTitle",
        bar.dataset.service ||
          "Service"
      );


      const tooltipStatus =
        $("tooltipStatus");


      if (tooltipStatus) {

        tooltipStatus.textContent =
          statusLabel(
            bar.dataset.status
          );


        tooltipStatus.className =
          `tooltip-status ${bar.dataset.status}`;

      }


      tooltip.classList.add(
        "visible"
      );

    }
  );


  container.addEventListener(
    "pointermove",
    event => {

      if (
        !tooltip.classList.contains(
          "visible"
        )
      ) {
        return;
      }


      positionTooltip(
        event.clientX,
        event.clientY
      );

    }
  );


  container.addEventListener(
    "pointerout",
    event => {

      if (
        event.target.closest(
          ".availability-bar"
        )
      ) {

        tooltip.classList.remove(
          "visible"
        );

      }

    }
  );

}


function positionTooltip(
  x,
  y
) {

  const tooltip =
    $("tooltip");


  if (!tooltip) {
    return;
  }


  const padding =
    12;


  const rect =
    tooltip.getBoundingClientRect();


  let left =
    x + 14;


  let top =
    y + 14;


  if (
    left + rect.width >
    window.innerWidth - padding
  ) {

    left =
      x -
      rect.width -
      14;

  }


  if (
    top + rect.height >
    window.innerHeight - padding
  ) {

    top =
      y -
      rect.height -
      14;

  }


  tooltip.style.left =
    `${Math.max(padding, left)}px`;

  tooltip.style.top =
    `${Math.max(padding, top)}px`;

}


/* =========================================================
   CLOCK
========================================================= */

function updateClock() {

  setText(
    "systemClock",
    formatClock()
  );

}


/* =========================================================
   BOOT SEQUENCE
========================================================= */

function runBootSequence() {

  const boot =
    $("boot");


  const progress =
    $("bootProgress");


  if (!boot) {

    bootComplete =
      true;

    return;

  }


  const lines =
    Array.from(
      boot.querySelectorAll(
        ".boot-line"
      )
    );


  const total =
    lines.length;


  lines.forEach(
    line =>
      line.classList.remove(
        "visible"
      )
  );


  lines.forEach(
    (line, index) => {

      setTimeout(
        () => {

          line.classList.add(
            "visible"
          );


          if (progress) {

            const percent =
              ((index + 1) / total) *
              100;


            progress.style.width =
              `${percent}%`;

          }

        },
        260 +
        index * 330
      );

    }
  );


  const completionDelay =
    260 +
    total * 330 +
    700;


  setTimeout(
    () => {

      boot.classList.add(
        "complete"
      );


      bootComplete =
        true;


      setTimeout(
        () => {

          boot.remove();

        },
        800
      );

    },
    completionDelay
  );

}


/* =========================================================
   API REQUEST
========================================================= */

async function fetchStatus() {

  const started =
    performance.now();


  const response =
    await fetch(
      `${STATUS_API}?t=${Date.now()}`,
      {
        method: "GET",

        cache: "no-store",

        headers: {
          "Accept":
            "application/json",

          "Cache-Control":
            "no-cache"
        }
      }
    );


  lastFetchDuration =
    performance.now() -
    started;


  if (!response.ok) {

    throw new Error(
      `Status API returned HTTP ${response.status}`
    );

  }


  const contentType =
    response.headers.get(
      "content-type"
    ) || "";


  if (
    !contentType.includes(
      "application/json"
    )
  ) {

    throw new Error(
      "Status API did not return JSON."
    );

  }


  const raw =
    await response.json();


  return normalizePayload(
    raw
  );

}


/* =========================================================
   CONNECTION ERROR STATE
========================================================= */

function renderConnectionError(error) {

  console.error(
    "[DYVE STATUS]",
    error
  );


  latestData =
    null;


  setText(
    "globalState",
    "MONITOR UNAVAILABLE"
  );


  setText(
    "globalSub",
    "The public status monitor could not be reached. Service health cannot currently be verified."
  );


  const indicator =
    $("globalIndicator");


  if (indicator) {

    indicator.className =
      "overview-status-indicator unknown";

  }


  setText(
    "uptimeMetric",
    "—"
  );


  setText(
    "latencyMetric",
    "—"
  );


  setText(
    "errorMetric",
    "—"
  );


  setText(
    "nodeMetric",
    "— / —"
  );


  setText(
    "incidentMetric",
    "—"
  );


  setText(
    "serviceMeta",
    "MONITOR UNAVAILABLE"
  );


  setText(
    "nodeStatus",
    "UNREACHABLE"
  );


  setText(
    "nodeLatency",
    "—ms"
  );


  setText(
    "cycleStatus",
    "ERROR"
  );


  setText(
    "cycleAge",
    "—"
  );


  setText(
    "monitorState",
    "OFFLINE"
  );


  setText(
    "probeResult",
    "NO DATA"
  );


  setText(
    "latestCheck",
    "The monitoring engine could not be reached. No synthetic service state has been applied."
  );


  setText(
    "scanText",
    "STATUS ENGINE UNREACHABLE · TELEMETRY UNAVAILABLE"
  );


  setText(
    "serviceCount",
    "—"
  );


  setText(
    "checksPassed",
    "—"
  );


  setText(
    "requestsMinute",
    "—"
  );


  setText(
    "p95",
    "—"
  );


  setText(
    "p99",
    "—"
  );


  setText(
    "errorBudget",
    "—"
  );


  const matrix =
    $("serviceMatrix");


  if (matrix) {

    matrix.innerHTML = `
      <div class="incident-empty">
        The monitoring engine did not return service telemetry.
      </div>
    `;

  }


  const availability =
    $("availabilityMatrix");


  if (availability) {

    availability.innerHTML = `
      <div style="
        padding:18px 0;
        color:rgba(216,246,228,.45);
        font-family:var(--sans);
        font-size:8px;
        line-height:1.6;
      ">
        Historical availability cannot be verified while the status engine is unreachable.
      </div>
    `;

  }


  const incidents =
    $("incidentLedger");


  if (incidents) {

    incidents.innerHTML = `
      <div class="incident-empty">
        Incident data unavailable while monitor is offline.
      </div>
    `;

  }


  const events =
    $("eventStream");


  if (events) {

    events.innerHTML = `
      <div class="incident-empty">
        Unable to receive live monitoring events.
      </div>
    `;

  }


  setText(
    "eventCount",
    "00"
  );

}


/* =========================================================
   MAIN LOAD
========================================================= */

async function loadStatus() {

  if (refreshInProgress) {
    return null;
  }


  refreshInProgress =
    true;


  try {

    const data =
      await fetchStatus();


    latestData =
      data;


    renderGlobalState(
      data
    );


    renderMetrics(
      data
    );


    renderServiceMatrix(
      data.services
    );


    renderAvailability(
      data.services
    );


    renderIncidentLedger(
      data.incidents
    );


    renderMonitorTelemetry(
      data
    );


    renderScanStatus(
      data
    );


    renderLastChecked(
      data
    );


    buildEventsFromData(
      data
    );


    renderEventStream();


    /*
       Refresh service telemetry age on every cycle.
    */

    return data;

  }

  catch (error) {

    renderConnectionError(
      error
    );


    return null;

  }

  finally {

    refreshInProgress =
      false;

  }

}


/* =========================================================
   MANUAL REFRESH SUPPORT
========================================================= */

async function refresh() {

  if (refreshInProgress) {
    return;
  }


  const result =
    await loadStatus();


  if (result) {

    showToast(
      "Status synchronized"
    );

  }

  else {

    showToast(
      "Monitor connection failed"
    );

  }

}


window.refreshStatus =
  refresh;


/* =========================================================
   TOAST
========================================================= */

let toastTimer =
  null;


function showToast(message) {

  const toast =
    $("toast");


  if (!toast) {
    return;
  }


  toast.textContent =
    message;


  toast.classList.add(
    "visible"
  );


  clearTimeout(
    toastTimer
  );


  toastTimer =
    setTimeout(
      () => {

        toast.classList.remove(
          "visible"
        );

      },
      2200
    );

}


/* =========================================================
   KEYBOARD
========================================================= */

document.addEventListener(
  "keydown",
  event => {

    if (
      event.key ===
      "Escape"
    ) {

      closeModal();

    }

  }
);


/* =========================================================
   INITIALIZATION
========================================================= */

function initializeStatusPage() {

  updateClock();


  setInterval(
    updateClock,
    CLOCK_INTERVAL
  );


  runBootSequence();


  initAvailabilityTooltip();


  /*
     Start the first API synchronization immediately.
     It runs independently from the visual boot sequence.
  */

  loadStatus();


  /*
     Re-check every minute.
  */

  setInterval(
    loadStatus,
    REFRESH_INTERVAL
  );

}


/* =========================================================
   START
========================================================= */

if (
  document.readyState ===
  "loading"
) {

  document.addEventListener(
    "DOMContentLoaded",
    initializeStatusPage,
    {
      once: true
    }
  );

}

else {

  initializeStatusPage();

}
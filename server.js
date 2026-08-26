import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { URL } from "node:url";
import crypto from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ==========================================================
   CONFIGURATION
========================================================== */

function toPositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? Math.floor(number)
    : fallback;
}

const PORT = toPositiveInteger(process.env.PORT, 3000);
const CHECK_INTERVAL_MS = toPositiveInteger(process.env.CHECK_INTERVAL_MS, 5 * 60 * 1000);
const REQUEST_TIMEOUT_MS = toPositiveInteger(process.env.REQUEST_TIMEOUT_MS, 10 * 1000);
const FAILURE_THRESHOLD = toPositiveInteger(process.env.FAILURE_THRESHOLD, 3);
const RECOVERY_THRESHOLD = toPositiveInteger(process.env.RECOVERY_THRESHOLD, 3);
const UPTIME_WINDOW_DAYS = toPositiveInteger(process.env.UPTIME_WINDOW_DAYS, 30);
const MAX_CHECKS = toPositiveInteger(process.env.MAX_CHECKS, 100000);
const MAX_EVENTS = toPositiveInteger(process.env.MAX_EVENTS, 10000);
const MAX_INCIDENTS = toPositiveInteger(process.env.MAX_INCIDENTS, 1000);
const MAX_REQUEST_BODY_BYTES = toPositiveInteger(process.env.MAX_REQUEST_BODY_BYTES, 10000);
const PUBLIC_REFRESH_INTERVAL_MS = toPositiveInteger(process.env.PUBLIC_REFRESH_INTERVAL_MS, 30000);
const MONITOR_STALE_AFTER_MS = toPositiveInteger(
  process.env.MONITOR_STALE_AFTER_MS,
  Math.max(CHECK_INTERVAL_MS + 30000, 2 * 60 * 1000)
);
const MAX_REDIRECTS = toPositiveInteger(process.env.MAX_REDIRECTS, 5);

const MONITOR_ORIGIN = String(process.env.MONITOR_ORIGIN || "01").trim();
const MONITOR_VERSION = String(process.env.MONITOR_VERSION || "3.1.0").trim();
const USER_AGENT = String(
  process.env.STATUS_USER_AGENT || `Dyve-Status-Monitor/${MONITOR_VERSION}`
).trim();

const CHECK_TOKEN = String(process.env.CHECK_TOKEN || "").trim();

const DYVE_CORE_URL = String(
  process.env.DYVE_CORE_URL || "https://dyve.online/"
).trim();

const HACKAX_URL = String(
  process.env.HACKAX_URL || "https://dyve.online/hackax/"
).trim();

const DYVE_TECH_URL = String(
  process.env.DYVE_TECH_URL || "https://dyve.online/tech/"
).trim();

const ARTICLE_URL = String(
  process.env.ARTICLE_URL ||
    "https://dyve.online/article/dark-web/dark-web-how-it-works"
).trim();

const MEDIA_URL = String(
  process.env.MEDIA_URL ||
    "https://res.cloudinary.com/dxdbn6xwy/image/upload/v1787752375/hackax/hackax/iran-linked-hackers-reportedly-took-a-uk-power-generator-offline-for-four-days-heres-why-it-matters-featured-1787752371897.jpg"
).trim();

const DATA_DIR = path.join(__dirname, "data");
const STATE_FILE = path.join(DATA_DIR, "state.json");
const STATE_BACKUP_FILE = path.join(DATA_DIR, "state.backup.json");
const PUBLIC_DIR = path.join(__dirname, "public");

fs.mkdirSync(DATA_DIR, { recursive: true });

/* ==========================================================
   SERVICES
========================================================== */

const SERVICES = Object.freeze([
  {
    id: "dyve-core",
    name: "Dyve Core",
    shortName: "Dyve",
    description: "Main Dyve.online web platform and navigation.",
    kind: "http",
    url: DYVE_CORE_URL,
    expectedContentType: "text/html",
    timeoutMs: REQUEST_TIMEOUT_MS
  },
  {
    id: "hackax",
    name: "HackaX Intelligence",
    shortName: "HackaX",
    description: "Cybersecurity intelligence, breach and threat reporting.",
    kind: "http",
    url: HACKAX_URL,
    expectedContentType: "text/html",
    timeoutMs: REQUEST_TIMEOUT_MS
  },
  {
    id: "dyve-tech",
    name: "Dyve Tech",
    shortName: "Dyve Tech",
    description: "Technology news, analysis and editorial publishing.",
    kind: "http",
    url: DYVE_TECH_URL,
    expectedContentType: "text/html",
    timeoutMs: REQUEST_TIMEOUT_MS
  },
  {
    id: "article-delivery",
    name: "Article Delivery",
    shortName: "Articles",
    description: "Published article pages and editorial content delivery.",
    kind: "http",
    url: ARTICLE_URL,
    expectedContentType: "text/html",
    timeoutMs: REQUEST_TIMEOUT_MS
  },
  {
    id: "media-delivery",
    name: "Media Delivery",
    shortName: "Media",
    description: "Featured images and media assets used across Dyve.",
    kind: "media",
    url: MEDIA_URL,
    timeoutMs: REQUEST_TIMEOUT_MS
  },
  {
    id: "publishing",
    name: "Publishing System",
    shortName: "Publishing",
    description: "Editorial publishing and article feed generation.",
    kind: "publishing",
    url: DYVE_CORE_URL,
    timeoutMs: REQUEST_TIMEOUT_MS
  }
]);

/* ==========================================================
   RUNTIME STATE
========================================================== */

let state;
let activeHealthCycle = null;
let monitoringTimer = null;
let writeTimer = null;
let writeInProgress = false;
let shuttingDown = false;

/* ==========================================================
   HELPERS
========================================================== */

function now() {
  return new Date().toISOString();
}

function validTimestamp(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function timestampAge(timestamp) {
  const parsed = Date.parse(timestamp || "");
  return Number.isFinite(parsed)
    ? Math.max(0, Date.now() - parsed)
    : Infinity;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function round(value, decimals = 0) {
  if (!Number.isFinite(value)) return null;

  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function safeString(value, maximum = 1000) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .slice(0, maximum);
}

function toNonNegativeInteger(value) {
  const number = Number(value);

  return Number.isFinite(number) && number >= 0
    ? Math.floor(number)
    : 0;
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(5).toString("hex")}`;
}

function serviceById(id) {
  return SERVICES.find(service => service.id === id) || null;
}

function serviceByName(name) {
  const target = String(name || "").trim().toLowerCase();

  if (!target) return null;

  return (
    SERVICES.find(service => service.name.toLowerCase() === target) ||
    SERVICES.find(service => service.shortName.toLowerCase() === target) ||
    null
  );
}

/* ==========================================================
   STATE
========================================================== */

function emptyServiceState() {
  return {
    status: "unknown",
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    lastCheck: null,
    lastSuccess: null,
    lastFailure: null,
    lastResponseTime: null,
    lastHttpStatus: null,
    lastError: null,
    totalChecks: 0,
    successfulChecks: 0,
    checks: [],
    heartbeat: {
      count: 0,
      lastSeen: null,
      lastPath: null
    }
  };
}

function emptyState() {
  const services = {};

  for (const service of SERVICES) {
    services[service.id] = emptyServiceState();
  }

  return {
    schemaVersion: 4,
    engineVersion: MONITOR_VERSION,
    createdAt: now(),
    updatedAt: null,
    cycleStartedAt: null,
    cycleCompletedAt: null,
    services,
    incidents: [],
    events: []
  };
}

function normalizeServiceState(source) {
  const record =
    source && typeof source === "object"
      ? source
      : {};

  const normalized = emptyServiceState();

  normalized.status = [
    "operational",
    "degraded",
    "major_outage",
    "unknown"
  ].includes(record.status)
    ? record.status
    : "unknown";

  normalized.consecutiveFailures =
    toNonNegativeInteger(record.consecutiveFailures);

  normalized.consecutiveSuccesses =
    toNonNegativeInteger(record.consecutiveSuccesses);

  normalized.lastCheck = validTimestamp(record.lastCheck);
  normalized.lastSuccess = validTimestamp(record.lastSuccess);
  normalized.lastFailure = validTimestamp(record.lastFailure);

  normalized.lastResponseTime = isFiniteNumber(record.lastResponseTime)
    ? Math.max(0, Math.round(record.lastResponseTime))
    : null;

  normalized.lastHttpStatus = isFiniteNumber(record.lastHttpStatus)
    ? Math.round(record.lastHttpStatus)
    : null;

  normalized.lastError = record.lastError
    ? safeString(record.lastError, 2000)
    : null;

  normalized.totalChecks =
    toNonNegativeInteger(record.totalChecks);

  normalized.successfulChecks =
    toNonNegativeInteger(record.successfulChecks);

  normalized.checks = Array.isArray(record.checks)
    ? record.checks
        .filter(check => check && validTimestamp(check.checkedAt))
        .map(check => ({
          checkedAt: validTimestamp(check.checkedAt),
          ok: Boolean(check.ok),
          status: isFiniteNumber(check.status)
            ? Math.round(check.status)
            : null,
          responseTime: isFiniteNumber(check.responseTime)
            ? Math.max(0, Math.round(check.responseTime))
            : null
        }))
        .slice(-MAX_CHECKS)
    : [];

  if (record.heartbeat && typeof record.heartbeat === "object") {
    normalized.heartbeat.count =
      toNonNegativeInteger(record.heartbeat.count);

    normalized.heartbeat.lastSeen =
      validTimestamp(record.heartbeat.lastSeen);

    normalized.heartbeat.lastPath =
      record.heartbeat.lastPath
        ? safeString(record.heartbeat.lastPath, 500)
        : null;
  }

  return normalized;
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    return emptyState();
  }

  try {
    const parsed = JSON.parse(
      fs.readFileSync(STATE_FILE, "utf8")
    );

    if (!parsed || typeof parsed !== "object") {
      throw new Error("Invalid state object");
    }

    const base = emptyState();

    base.createdAt =
      validTimestamp(parsed.createdAt) || now();

    base.updatedAt =
      validTimestamp(parsed.updatedAt);

    base.cycleStartedAt =
      validTimestamp(parsed.cycleStartedAt);

    base.cycleCompletedAt =
      validTimestamp(parsed.cycleCompletedAt);

    for (const service of SERVICES) {
      base.services[service.id] =
        normalizeServiceState(
          parsed.services?.[service.id]
        );
    }

    if (Array.isArray(parsed.incidents)) {
      base.incidents = parsed.incidents
        .filter(
          incident =>
            incident &&
            typeof incident === "object"
        )
        .map(incident => ({
          id:
            safeString(incident.id, 200) ||
            createId("inc"),

          serviceId:
            safeString(incident.serviceId, 100),

          serviceName:
            safeString(incident.serviceName, 200),

          title:
            safeString(incident.title, 300),

          status:
            safeString(incident.status, 50) ||
            "investigating",

          startedAt:
            validTimestamp(incident.startedAt) ||
            now(),

          updatedAt:
            validTimestamp(incident.updatedAt) ||
            validTimestamp(incident.startedAt) ||
            now(),

          resolvedAt:
            validTimestamp(incident.resolvedAt),

          details:
            safeString(incident.details, 2000)
        }))
        .slice(-MAX_INCIDENTS);
    }

    if (Array.isArray(parsed.events)) {
      base.events = parsed.events
        .filter(
          event =>
            event &&
            typeof event === "object"
        )
        .map(event => ({
          id:
            safeString(event.id, 200) ||
            createId("evt"),

          timestamp:
            validTimestamp(event.timestamp) ||
            now(),

          type:
            safeString(event.type, 100) ||
            "monitor",

          serviceId:
            safeString(event.serviceId, 100),

          serviceName:
            safeString(event.serviceName, 200),

          target:
            safeString(event.target, 300),

          result:
            safeString(event.result, 100) ||
            "UNKNOWN",

          severity:
            safeString(event.severity, 50) ||
            "info",

          message:
            safeString(event.message, 1000)
        }))
        .slice(-MAX_EVENTS);
    }

    const hasRealCheck = SERVICES.some(service =>
      Boolean(
        base.services[service.id].lastCheck
      )
    );

    if (!hasRealCheck) {
      base.updatedAt = null;
      base.cycleCompletedAt = null;
    }

    return base;
  } catch (error) {
    console.error(
      "[Dyve Status] State load failed:",
      error?.message || error
    );

    try {
      fs.copyFileSync(
        STATE_FILE,
        path.join(
          DATA_DIR,
          `state.corrupt.${Date.now()}.json`
        )
      );
    } catch {
      /* Preserve availability if backup fails. */
    }

    return emptyState();
  }
}

state = loadState();

/* ==========================================================
   PERSISTENCE
========================================================== */

function persistState() {
  if (writeInProgress) return;

  writeInProgress = true;

  const tmpPath = `${STATE_FILE}.tmp`;

  try {
    fs.writeFileSync(
      tmpPath,
      JSON.stringify(state, null, 2),
      "utf8"
    );

    if (fs.existsSync(STATE_FILE)) {
      try {
        fs.copyFileSync(
          STATE_FILE,
          STATE_BACKUP_FILE
        );
      } catch {
        /* Backup failure must not block persistence. */
      }
    }

    fs.renameSync(
      tmpPath,
      STATE_FILE
    );
  } finally {
    writeInProgress = false;
  }
}

function schedulePersist() {
  clearTimeout(writeTimer);

  writeTimer = setTimeout(() => {
    try {
      persistState();
    } catch (error) {
      console.error(
        "[Dyve Status] Persist failed:",
        error
      );
    }
  }, 100);
}

/* ==========================================================
   HISTORY / UPTIME
========================================================== */

function pruneChecks(record) {
  const cutoff =
    Date.now() -
    UPTIME_WINDOW_DAYS *
      24 *
      60 *
      60 *
      1000;

  record.checks = record.checks
    .filter(check => {
      const timestamp =
        Date.parse(check.checkedAt);

      return (
        Number.isFinite(timestamp) &&
        timestamp >= cutoff
      );
    })
    .slice(-MAX_CHECKS);
}

function calculateUptime(record) {
  pruneChecks(record);

  if (!record.checks.length) {
    return null;
  }

  const successes =
    record.checks.filter(
      check => check.ok
    ).length;

  return round(
    (successes / record.checks.length) * 100,
    2
  );
}

function calculateErrorRate(record) {
  pruneChecks(record);

  if (!record.checks.length) {
    return null;
  }

  const failures =
    record.checks.filter(
      check => !check.ok
    ).length;

  return round(
    (failures / record.checks.length) * 100,
    2
  );
}

function dayKey(timestamp) {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return [
    date.getUTCFullYear(),
    String(
      date.getUTCMonth() + 1
    ).padStart(2, "0"),
    String(
      date.getUTCDate()
    ).padStart(2, "0")
  ].join("-");
}

function buildAvailability(record) {
  pruneChecks(record);

  const today = new Date();
  const days = [];

  for (
    let offset = UPTIME_WINDOW_DAYS - 1;
    offset >= 0;
    offset -= 1
  ) {
    const date = new Date(
      Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate() - offset
      )
    );

    days.push(
      date.toISOString().slice(0, 10)
    );
  }

  const grouped = new Map();

  for (const check of record.checks) {
    const key = dayKey(
      check.checkedAt
    );

    if (!key) continue;

    if (!grouped.has(key)) {
      grouped.set(key, []);
    }

    grouped.get(key).push(check);
  }

  return days.map(date => {
    const checks =
      grouped.get(date) || [];

    if (!checks.length) {
      return {
        date,
        status: "unknown",
        uptime: null,
        checks: 0
      };
    }

    const successful =
      checks.filter(
        check => check.ok
      ).length;

    const uptime = round(
      (successful / checks.length) * 100,
      2
    );

    return {
      date,
      status:
        uptime === 0
          ? "major_outage"
          : uptime < 100
            ? "degraded"
            : "operational",
      uptime,
      checks: checks.length
    };
  });
}

function calculateMedianLatency(records) {
  const values = records
    .map(
      record =>
        record.lastResponseTime
    )
    .filter(isFiniteNumber)
    .sort(
      (a, b) => a - b
    );

  if (!values.length) {
    return null;
  }

  const middle =
    Math.floor(values.length / 2);

  return values.length % 2
    ? Math.round(values[middle])
    : Math.round(
        (
          values[middle - 1] +
          values[middle]
        ) / 2
      );
}

function calculatePercentileLatency(
  records,
  percentile
) {
  const values = records
    .map(
      record =>
        record.lastResponseTime
    )
    .filter(isFiniteNumber)
    .sort(
      (a, b) => a - b
    );

  if (!values.length) {
    return null;
  }

  const index = Math.min(
    values.length - 1,
    Math.max(
      0,
      Math.ceil(
        percentile * values.length
      ) - 1
    )
  );

  return Math.round(values[index]);
}

/* ==========================================================
   STATUS MODEL
========================================================== */

function calculateCounts() {
  const counts = {
    total: SERVICES.length,
    operational: 0,
    degraded: 0,
    outage: 0,
    unknown: 0
  };

  for (const service of SERVICES) {
    const status =
      state.services[
        service.id
      ].status;

    if (status === "operational") {
      counts.operational += 1;
    } else if (status === "degraded") {
      counts.degraded += 1;
    } else if (
      status === "major_outage"
    ) {
      counts.outage += 1;
    } else {
      counts.unknown += 1;
    }
  }

  return counts;
}

function rawOverallStatus() {
  const statuses =
    SERVICES.map(
      service =>
        state.services[
          service.id
        ].status
    );

  if (
    statuses.some(
      status =>
        status === "major_outage"
    )
  ) {
    return "major_outage";
  }

  if (
    statuses.some(
      status =>
        status === "degraded"
    )
  ) {
    return "degraded";
  }

  if (
    statuses.length &&
    statuses.every(
      status =>
        status === "operational"
    )
  ) {
    return "operational";
  }

  if (
    statuses.some(
      status =>
        status === "operational"
    )
  ) {
    return "partial";
  }

  return "unknown";
}

function isMonitoringStale() {
  if (!state.updatedAt) {
    return true;
  }

  return (
    timestampAge(state.updatedAt) >
    MONITOR_STALE_AFTER_MS
  );
}

function monitoringAge() {
  return state.updatedAt
    ? timestampAge(state.updatedAt)
    : null;
}

function overallStatus() {
  return isMonitoringStale()
    ? "unknown"
    : rawOverallStatus();
}

function humanStatus(status) {
  switch (status) {
    case "operational":
      return "Operational";
    case "degraded":
      return "Degraded";
    case "major_outage":
      return "Major outage";
    case "partial":
      return "Partially operational";
    default:
      return "Unknown";
  }
}

/* ==========================================================
   INCIDENTS / EVENTS
========================================================== */

function addEvent(event) {
  state.events.push({
    id:
      event.id ||
      createId("evt"),

    timestamp:
      validTimestamp(
        event.timestamp
      ) || now(),

    type:
      safeString(
        event.type,
        100
      ),

    serviceId:
      safeString(
        event.serviceId,
        100
      ),

    serviceName:
      safeString(
        event.serviceName,
        200
      ),

    target:
      safeString(
        event.target,
        300
      ),

    result:
      safeString(
        event.result,
        100
      ) || "UNKNOWN",

    severity:
      safeString(
        event.severity,
        50
      ) || "info",

    message:
      safeString(
        event.message,
        1000
      )
  });

  if (
    state.events.length >
    MAX_EVENTS
  ) {
    state.events =
      state.events.slice(
        -MAX_EVENTS
      );
  }
}

function openIncident(
  service,
  startedAt,
  result
) {
  const existing =
    state.incidents.find(
      incident =>
        incident.serviceId ===
          service.id &&
        !incident.resolvedAt
    );

  if (existing) {
    existing.updatedAt =
      startedAt;

    existing.details =
      safeString(
        result.error ||
          existing.details ||
          "Health check failed.",
        2000
      );

    return existing;
  }

  const incident = {
    id: createId("inc"),
    serviceId: service.id,
    serviceName: service.name,
    title:
      `${service.name} availability issue`,
    status: "investigating",
    startedAt,
    updatedAt: startedAt,
    resolvedAt: null,
    details: safeString(
      result.error ||
        (
          result.status
            ? `HTTP ${result.status}`
            : "Health check failed."
        ),
      2000
    )
  };

  state.incidents.push(
    incident
  );

  state.incidents =
    state.incidents.slice(
      -MAX_INCIDENTS
    );

  addEvent({
    timestamp: startedAt,
    type: "incident",
    serviceId: service.id,
    serviceName: service.name,
    target: service.name,
    result: "OUTAGE",
    severity: "danger",
    message: incident.details
  });

  return incident;
}

function resolveIncident(
  serviceId,
  resolvedAt
) {
  let resolved = false;

  for (
    const incident of state.incidents
  ) {
    if (
      incident.serviceId ===
        serviceId &&
      !incident.resolvedAt
    ) {
      incident.resolvedAt =
        resolvedAt;

      incident.updatedAt =
        resolvedAt;

      incident.status =
        "resolved";

      resolved = true;
    }
  }

  if (resolved) {
    const service =
      serviceById(serviceId);

    addEvent({
      timestamp: resolvedAt,
      type: "recovery",
      serviceId,
      serviceName:
        service?.name ||
        serviceId,
      target:
        service?.name ||
        serviceId,
      result: "RECOVERED",
      severity: "info",
      message:
        "Service has recovered after successful health checks."
    });
  }
}

/* ==========================================================
   URL / HTTP ENGINE
========================================================== */

function resolveUrl(value) {
  try {
    const url =
      new URL(value);

    if (
      !["http:", "https:"].includes(
        url.protocol
      )
    ) {
      return null;
    }

    return url;
  } catch {
    return null;
  }
}

async function requestUrl(
  url,
  options = {}
) {
  const target =
    resolveUrl(url);

  if (!target) {
    throw new Error(
      "Invalid monitoring URL"
    );
  }

  const method =
    options.method || "GET";

  const timeoutMs =
    toPositiveInteger(
      options.timeoutMs,
      REQUEST_TIMEOUT_MS
    );

  const accept =
    options.accept || "*/*";

  const headers = {
    "User-Agent": USER_AGENT,
    "Accept": accept,
    "Cache-Control": "no-cache",
    "Pragma": "no-cache"
  };

  const started =
    performance.now();

  let currentUrl =
    target.toString();

  for (
    let redirectCount = 0;
    redirectCount <= MAX_REDIRECTS;
    redirectCount += 1
  ) {
    const controller =
      new AbortController();

    const timer =
      setTimeout(
        () =>
          controller.abort(),
        timeoutMs
      );

    try {
      const response =
        await fetch(
          currentUrl,
          {
            method,
            redirect: "manual",
            signal:
              controller.signal,
            headers
          }
        );

      const responseTime =
        Math.round(
          performance.now() -
            started
        );

      const location =
        response.headers.get(
          "location"
        );

      if (
        response.status >= 300 &&
        response.status < 400 &&
        location
      ) {
        if (
          redirectCount >=
          MAX_REDIRECTS
        ) {
          return {
            ok: false,
            status:
              response.status,
            responseTime,
            finalUrl:
              currentUrl,
            contentType:
              response.headers.get(
                "content-type"
              ),
            error:
              "Too many redirects"
          };
        }

        const nextUrl =
          new URL(
            location,
            currentUrl
          );

        if (
          ![
            "http:",
            "https:"
          ].includes(
            nextUrl.protocol
          )
        ) {
          return {
            ok: false,
            status:
              response.status,
            responseTime,
            finalUrl:
              currentUrl,
            contentType: null,
            error:
              "Redirected to unsupported protocol"
          };
        }

        try {
          await response.body?.cancel();
        } catch {
          /* Ignore redirect body cleanup errors. */
        }

        currentUrl =
          nextUrl.toString();

        continue;
      }

      let text = "";

      if (
        method !== "HEAD"
      ) {
        text =
          await response.text();
      }

      return {
        ok: response.ok,
        status:
          response.status,
        responseTime,
        finalUrl:
          currentUrl,
        contentType:
          response.headers.get(
            "content-type"
          ),
        contentLength:
          response.headers.get(
            "content-length"
          ),
        text
      };
    } catch (error) {
      const responseTime =
        Math.round(
          performance.now() -
            started
        );

      const aborted =
        error?.name ===
        "AbortError";

      return {
        ok: false,
        status: null,
        responseTime,
        finalUrl:
          currentUrl,
        contentType: null,
        error: aborted
          ? `Request timeout after ${timeoutMs}ms`
          : error instanceof Error
            ? error.message
            : "Network request failed"
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    ok: false,
    status: null,
    responseTime:
      Math.round(
        performance.now() -
          started
      ),
    finalUrl:
      currentUrl,
    contentType: null,
    error:
      "Request failed"
  };
}

/* ==========================================================
   SERVICE CHECKS
========================================================== */

async function checkHttp(
  service
) {
  let result =
    await requestUrl(
      service.url,
      {
        method: "HEAD",
        accept: "*/*",
        timeoutMs:
          service.timeoutMs
      }
    );

  if (
    result.status === 405 ||
    result.status === 501
  ) {
    result =
      await requestUrl(
        service.url,
        {
          method: "GET",
          accept:
            service.expectedContentType ||
            "*/*",
          timeoutMs:
            service.timeoutMs
        }
      );
  }

  return {
    ok: Boolean(
      result.ok
    ),
    status:
      result.status,
    responseTime:
      result.responseTime,
    error:
      result.ok
        ? null
        : result.error ||
          (
            result.status
              ? `HTTP ${result.status}`
              : "Network request failed"
          ),
    contentType:
      result.contentType ||
      null
  };
}

async function checkMedia(
  service
) {
  let result =
    await requestUrl(
      service.url,
      {
        method: "HEAD",
        accept: "image/*",
        timeoutMs:
          service.timeoutMs
      }
    );

  if (
    result.status === 405 ||
    result.status === 501
  ) {
    result =
      await requestUrl(
        service.url,
        {
          method: "GET",
          accept: "image/*",
          timeoutMs:
            service.timeoutMs
        }
      );
  }

  const contentType =
    result.contentType ||
    "";

  const contentLooksCorrect =
    !result.ok ||
    contentType
      .toLowerCase()
      .startsWith("image/");

  if (
    result.ok &&
    !contentLooksCorrect
  ) {
    return {
      ok: false,
      status:
        result.status,
      responseTime:
        result.responseTime,
      error:
        `Unexpected content type: ${contentType}`,
      contentType
    };
  }

  return {
    ok: Boolean(
      result.ok
    ),
    status:
      result.status,
    responseTime:
      result.responseTime,
    error:
      result.ok
        ? null
        : result.error ||
          (
            result.status
              ? `HTTP ${result.status}`
              : "Media request failed"
          ),
    contentType
  };
}

async function checkPublishing() {
  const feeds = [
    {
      name:
        "HackaX articles",
      url:
        "https://dyve.online/articles.json"
    },
    {
      name:
        "Dyve Tech articles",
      url:
        "https://dyve.online/tech-articles.json"
    }
  ];

  const results =
    await Promise.all(
      feeds.map(
        async feed => {
          try {
            const response =
              await requestUrl(
                feed.url,
                {
                  method: "GET",
                  accept:
                    "application/json,text/plain,*/*",
                  timeoutMs:
                    REQUEST_TIMEOUT_MS
                }
              );

            if (!response.ok) {
              return {
                name:
                  feed.name,
                ok: false,
                status:
                  response.status,
                responseTime:
                  response.responseTime,
                error:
                  response.error ||
                  (
                    response.status
                      ? `HTTP ${response.status}`
                      : "Request failed"
                  )
              };
            }

            let json;

            try {
              json =
                JSON.parse(
                  response.text
                );
            } catch {
              return {
                name:
                  feed.name,
                ok: false,
                status:
                  response.status,
                responseTime:
                  response.responseTime,
                error:
                  "Invalid JSON"
              };
            }

            const articleCollection =
              Array.isArray(json) ||
              Array.isArray(
                json?.articles
              ) ||
              Array.isArray(
                json?.data
              ) ||
              Array.isArray(
                json?.items
              );

            return {
              name:
                feed.name,
              ok:
                articleCollection,
              status:
                response.status,
              responseTime:
                response.responseTime,
              error:
                articleCollection
                  ? null
                  : "Unexpected JSON structure"
            };
          } catch (error) {
            return {
              name:
                feed.name,
              ok: false,
              status: null,
              responseTime: null,
              error:
                error instanceof Error
                  ? error.message
                  : "Unknown publishing error"
            };
          }
        }
      )
    );

  const failed =
    results.filter(
      result => !result.ok
    );

  const responseTimes =
    results
      .map(
        result =>
          result.responseTime
      )
      .filter(
        isFiniteNumber
      );

  return {
    ok:
      failed.length === 0,

    status:
      failed.length === 0
        ? 200
        : 503,

    responseTime:
      responseTimes.length
        ? Math.round(
            responseTimes.reduce(
              (sum, value) =>
                sum + value,
              0
            ) /
              responseTimes.length
          )
        : null,

    error:
      failed.length
        ? failed
            .map(
              result =>
                `${result.name}: ${result.error}`
            )
            .join("; ")
        : null,

    details:
      results
  };
}

async function runCheck(
  service,
  cycleTimestamp
) {
  const checkedAt =
    cycleTimestamp ||
    now();

  let result;

  try {
    if (
      service.kind ===
      "publishing"
    ) {
      result =
        await checkPublishing();
    } else if (
      service.kind ===
      "media"
    ) {
      result =
        await checkMedia(
          service
        );
    } else {
      result =
        await checkHttp(
          service
        );
    }
  } catch (error) {
    result = {
      ok: false,
      status: null,
      responseTime: null,
      error:
        error instanceof Error
          ? error.message
          : "Unknown health check error"
    };
  }

  const record =
    state.services[
      service.id
    ];

  const previousStatus =
    record.status;

  record.lastCheck =
    checkedAt;

  record.lastResponseTime =
    isFiniteNumber(
      result.responseTime
    )
      ? Math.max(
          0,
          Math.round(
            result.responseTime
          )
        )
      : null;

  record.lastHttpStatus =
    isFiniteNumber(
      result.status
    )
      ? Math.round(
          result.status
        )
      : null;

  record.lastError =
    result.error
      ? safeString(
          result.error,
          2000
        )
      : null;

  record.totalChecks += 1;

  if (result.ok) {
    record.successfulChecks += 1;
    record.consecutiveSuccesses += 1;
    record.consecutiveFailures = 0;
    record.lastSuccess =
      checkedAt;

    if (
      previousStatus ===
      "unknown"
    ) {
      record.status =
        "operational";

      addEvent({
        timestamp:
          checkedAt,
        type:
          "probe",
        serviceId:
          service.id,
        serviceName:
          service.name,
        target:
          service.name,
        result:
          "OPERATIONAL",
        severity:
          "info",
        message:
          "Initial successful health check."
      });
    } else if (
      previousStatus !==
        "operational" &&
      record.consecutiveSuccesses >=
        RECOVERY_THRESHOLD
    ) {
      record.status =
        "operational";

      resolveIncident(
        service.id,
        checkedAt
      );

      addEvent({
        timestamp:
          checkedAt,
        type:
          "probe",
        serviceId:
          service.id,
        serviceName:
          service.name,
        target:
          service.name,
        result:
          "OPERATIONAL",
        severity:
          "info",
        message:
          `${RECOVERY_THRESHOLD} consecutive successful checks.`
      });
    }
  } else {
    record.consecutiveFailures += 1;
    record.consecutiveSuccesses = 0;
    record.lastFailure =
      checkedAt;

    const temporaryFailure =
      result.status === 408 ||
      result.status === 425 ||
      result.status === 429;

    if (
      previousStatus ===
      "operational"
    ) {
      record.status =
        "degraded";

      addEvent({
        timestamp:
          checkedAt,
        type:
          "probe",
        serviceId:
          service.id,
        serviceName:
          service.name,
        target:
          service.name,
        result:
          "DEGRADED",
        severity:
          "warning",
        message:
          safeString(
            result.error ||
              "Health check failed.",
            1000
          )
      });
    } else if (
      previousStatus ===
        "unknown" &&
      record.consecutiveFailures <
        FAILURE_THRESHOLD
    ) {
      record.status =
        "degraded";

      addEvent({
        timestamp:
          checkedAt,
        type:
          "probe",
        serviceId:
          service.id,
        serviceName:
          service.name,
        target:
          service.name,
        result:
          "DEGRADED",
        severity:
          "warning",
        message:
          safeString(
            result.error ||
              "Initial health check failed.",
            1000
          )
      });
    }

    if (
      record.consecutiveFailures >=
      FAILURE_THRESHOLD
    ) {
      const nextStatus =
        temporaryFailure
          ? "degraded"
          : "major_outage";

      const statusChanged =
        record.status !==
        nextStatus;

      record.status =
        nextStatus;

      if (
        nextStatus ===
        "major_outage"
      ) {
        openIncident(
          service,
          checkedAt,
          result
        );
      }

      if (
        statusChanged
      ) {
        addEvent({
          timestamp:
            checkedAt,
          type:
            "probe",
          serviceId:
            service.id,
          serviceName:
            service.name,
          target:
            service.name,
          result:
            nextStatus ===
            "major_outage"
              ? "OUTAGE"
              : "DEGRADED",
          severity:
            nextStatus ===
            "major_outage"
              ? "danger"
              : "warning",
          message:
            safeString(
              result.error ||
                "Repeated health checks failed.",
              1000
            )
        });
      }
    }
  }

  record.checks.push({
    checkedAt,
    ok:
      Boolean(result.ok),
    status:
      isFiniteNumber(
        result.status
      )
        ? result.status
        : null,
    responseTime:
      isFiniteNumber(
        result.responseTime
      )
        ? result.responseTime
        : null
  });

  pruneChecks(
    record
  );

  if (
    previousStatus ===
    record.status
  ) {
    addEvent({
      timestamp:
        checkedAt,
      type:
        "probe",
      serviceId:
        service.id,
      serviceName:
        service.name,
      target:
        service.name,
      result:
        record.status ===
        "operational"
          ? "OPERATIONAL"
          : record.status ===
              "degraded"
            ? "DEGRADED"
            : record.status ===
                "major_outage"
              ? "OUTAGE"
              : "UNKNOWN",
      severity:
        record.status ===
        "major_outage"
          ? "danger"
          : record.status ===
              "degraded"
            ? "warning"
            : "info",
      message:
        result.ok
          ? "Health check completed successfully."
          : safeString(
              result.error ||
                "Health check failed.",
              1000
            )
    });
  }

  return {
    service:
      service.name,
    serviceId:
      service.id,
    ok:
      Boolean(result.ok),
    status:
      result.status ??
      null,
    responseTime:
      result.responseTime ??
      null,
    error:
      result.error ||
      null,
    state:
      record.status
  };
}

/* ==========================================================
   MONITORING
========================================================== */

async function runAllChecks() {
  if (shuttingDown) {
    return [];
  }

  if (activeHealthCycle) {
    return activeHealthCycle;
  }

  activeHealthCycle =
    (async () => {
      const cycleStartedAt =
        now();

      const started =
        performance.now();

      state.cycleStartedAt =
        cycleStartedAt;

      console.log(
        `[${cycleStartedAt}] [Dyve Status] Starting health cycle. ${SERVICES.length} services.`
      );

      const results =
        await Promise.all(
          SERVICES.map(
            service =>
              runCheck(
                service,
                cycleStartedAt
              )
          )
        );

      const cycleCompletedAt =
        now();

      state.updatedAt =
        cycleCompletedAt;

      state.cycleCompletedAt =
        cycleCompletedAt;

      state.engineVersion =
        MONITOR_VERSION;

      state.events =
        state.events.slice(
          -MAX_EVENTS
        );

      state.incidents =
        state.incidents.slice(
          -MAX_INCIDENTS
        );

      persistState();

      const elapsed =
        Math.round(
          performance.now() -
            started
        );

      const counts =
        calculateCounts();

      console.log(
        `[${cycleCompletedAt}] [Dyve Status] Health cycle complete in ${elapsed}ms. ` +
        `${counts.operational}/${counts.total} operational, ` +
        `${counts.degraded} degraded, ` +
        `${counts.outage} outage, ` +
        `${counts.unknown} unknown.`
      );

      return results;
    })()
      .catch(error => {
        console.error(
          "[Dyve Status] Health cycle failed:",
          error instanceof Error
            ? error.stack ||
              error.message
            : error
        );

        throw error;
      })
      .finally(() => {
        activeHealthCycle =
          null;
      });

  return activeHealthCycle;
}

/* ==========================================================
   HEARTBEATS
========================================================== */

function recordHeartbeat(body) {
  const service =
    serviceById(
      body?.serviceId
    ) ||
    serviceByName(
      body?.service
    );

  if (!service) {
    return {
      ok: false,
      error:
        "Unknown service"
    };
  }

  const record =
    state.services[
      service.id
    ];

  record.heartbeat.count += 1;

  record.heartbeat.lastSeen =
    now();

  record.heartbeat.lastPath =
    typeof body?.path ===
    "string"
      ? safeString(
          body.path,
          500
        )
      : null;

  schedulePersist();

  return {
    ok: true,
    service:
      service.name,
    heartbeat: {
      lastSeen:
        record.heartbeat.lastSeen
    }
  };
}

/* ==========================================================
   PUBLIC SERIALIZATION
   Exact API contract consumed by public/index.html + status-page.js
========================================================== */

function publicService(
  service
) {
  const record =
    state.services[
      service.id
    ];

  const uptime =
    calculateUptime(
      record
    );

  const errorRate =
    calculateErrorRate(
      record
    );

  return {
    id:
      service.id,

    name:
      service.name,

    shortName:
      service.shortName,

    description:
      service.description,

    kind:
      service.kind,

    status:
      record.status,

    state:
      record.status,

    responseTime:
      record.lastResponseTime,

    latency:
      record.lastResponseTime,

    httpStatus:
      record.lastHttpStatus,

    lastChecked:
      record.lastCheck,

    lastCheck:
      record.lastCheck,

    lastSuccess:
      record.lastSuccess,

    lastFailure:
      record.lastFailure,

    lastError:
      record.lastError,

    uptime,

    errorRate,

    checks:
      record.totalChecks,

    successfulChecks:
      record.successfulChecks,

    availability:
      buildAvailability(
        record
      ),

    heartbeat: {
      lastSeen:
        record.heartbeat.lastSeen
    }
  };
}

function publicStatus() {
  const services =
    SERVICES.map(
      publicService
    );

  const counts =
    calculateCounts();

  const records =
    SERVICES.map(
      service =>
        state.services[
          service.id
        ]
    );

  const validUptimes =
    records
      .map(
        calculateUptime
      )
      .filter(
        isFiniteNumber
      );

  const overallUptime =
    validUptimes.length
      ? round(
          validUptimes.reduce(
            (sum, value) =>
              sum + value,
            0
          ) /
            validUptimes.length,
          2
        )
      : null;

  const errorRates =
    records
      .map(
        calculateErrorRate
      )
      .filter(
        isFiniteNumber
      );

  const overallErrorRate =
    errorRates.length
      ? round(
          errorRates.reduce(
            (sum, value) =>
              sum + value,
            0
          ) /
            errorRates.length,
          2
        )
      : null;

  const activeIncidents =
    state.incidents.filter(
      incident =>
        !incident.resolvedAt
    );

  const recentEvents =
    state.events
      .slice()
      .sort(
        (a, b) =>
          Date.parse(
            b.timestamp
          ) -
          Date.parse(
            a.timestamp
          )
      )
      .slice(0, 100);

  const latestProbe =
    services
      .filter(
        service =>
          service.lastChecked
      )
      .sort(
        (a, b) =>
          Date.parse(
            b.lastChecked
          ) -
          Date.parse(
            a.lastChecked
          )
      )[0] || null;

  const p95 =
    calculatePercentileLatency(
      records,
      0.95
    );

  const p99 =
    calculatePercentileLatency(
      records,
      0.99
    );

  const observed =
    rawOverallStatus();

  const effective =
    overallStatus();

  const latestProbeMessage =
    latestProbe
      ? latestProbe.status ===
        "operational"
        ? "Latest service check completed successfully."
        : latestProbe.status ===
            "degraded"
          ? "Latest service check indicates degraded service."
          : latestProbe.status ===
              "major_outage"
            ? "Latest service check indicates an outage."
            : "Latest service state could not be verified."
      : "Monitor is initializing.";

  return {
    schemaVersion: 4,
    engineVersion:
      MONITOR_VERSION,

    generatedAt:
      now(),

    monitoredAt:
      state.updatedAt,

    cycle: {
      startedAt:
        state.cycleStartedAt,

      completedAt:
        state.cycleCompletedAt,

      ageMs:
        monitoringAge(),

      stale:
        isMonitoringStale(),

      intervalMs:
        CHECK_INTERVAL_MS,

      intervalSeconds:
        Math.round(
          CHECK_INTERVAL_MS / 1000
        ),

      staleAfterMs:
        MONITOR_STALE_AFTER_MS
    },

    monitor: {
      state:
        isMonitoringStale()
          ? "stale"
          : "online",

      origin:
        MONITOR_ORIGIN,

      version:
        MONITOR_VERSION,

      services:
        SERVICES.length,

      pollIntervalMs:
        CHECK_INTERVAL_MS,

      timeoutMs:
        REQUEST_TIMEOUT_MS,

      failureThreshold:
        FAILURE_THRESHOLD,

      recoveryThreshold:
        RECOVERY_THRESHOLD,

      uptimeWindowDays:
        UPTIME_WINDOW_DAYS
    },

    refresh: {
      intervalMs:
        PUBLIC_REFRESH_INTERVAL_MS,

      intervalSeconds:
        Math.round(
          PUBLIC_REFRESH_INTERVAL_MS /
            1000
        )
    },

    overallStatus:
      effective,

    overallState:
      effective,

    overallLabel:
      humanStatus(
        effective
      ),

    observedStatus:
      observed,

    observedLabel:
      humanStatus(
        observed
      ),

    metrics: {
      uptime:
        overallUptime,

      latency:
        calculateMedianLatency(
          records
        ),

      errorRate:
        overallErrorRate,

      services:
        counts.total,

      operational:
        counts.operational,

      degraded:
        counts.degraded,

      outage:
        counts.outage,

      unknown:
        counts.unknown,

      incidents:
        activeIncidents.length
    },

    services,

    availability:
      services.map(
        service => ({
          serviceId:
            service.id,

          name:
            service.name,

          shortName:
            service.shortName,

          uptime:
            service.uptime,

          status:
            service.status,

          days:
            service.availability
        })
      ),

    events:
      recentEvents,

    eventCount:
      recentEvents.length,

    incidents:
      state.incidents
        .slice()
        .sort(
          (a, b) =>
            Date.parse(
              b.startedAt
            ) -
            Date.parse(
              a.startedAt
            )
        )
        .slice(0, 25),

    activeIncidents,

    telemetry: {
      monitorState:
        isMonitoringStale()
          ? "STALE"
          : "ONLINE",

      monitorOrigin:
        MONITOR_ORIGIN,

      monitorVersion:
        MONITOR_VERSION,

      pollInterval:
        `${Math.round(CHECK_INTERVAL_MS / 1000)}s`,

      servicesMonitored:
        counts.total,

      operational:
        counts.operational,

      degraded:
        counts.degraded,

      outage:
        counts.outage,

      unknown:
        counts.unknown,

      p95,
      p99,

      errorBudget:
        overallUptime === null
          ? null
          : round(
              100 -
                overallUptime,
              2
            )
    },

    latestProbe:
      latestProbe
        ? {
            serviceId:
              latestProbe.id,

            service:
              latestProbe.name,

            status:
              latestProbe.status,

            responseTime:
              latestProbe.responseTime,

            httpStatus:
              latestProbe.httpStatus,

            checkedAt:
              latestProbe.lastChecked,

            message:
              latestProbeMessage
          }
        : null,

    /*
     * Flat aliases are intentionally retained because they make
     * the frontend contract resilient and allow status-page.js
     * to consume the API without knowing backend internals.
     */
    uptime:
      overallUptime,

    latency:
      calculateMedianLatency(
        records
      ),

    errorRate:
      overallErrorRate,

    serviceCount:
      counts.total,

    operationalCount:
      counts.operational,

    degradedCount:
      counts.degraded,

    outageCount:
      counts.outage,

    unknownCount:
      counts.unknown,

    incidentCount:
      activeIncidents.length,

    monitorState:
      isMonitoringStale()
        ? "STALE"
        : "ONLINE",

    probeResult:
      latestProbe
        ? latestProbe.status ===
          "operational"
          ? "OPERATIONAL"
          : latestProbe.status ===
              "degraded"
            ? "DEGRADED"
            : latestProbe.status ===
                "major_outage"
              ? "OUTAGE"
              : "UNKNOWN"
        : "WAITING",

    latestCheck:
      latestProbe
        ? latestProbeMessage
        : "Monitor is initializing.",

    checksHour:
      `${Math.round(
        CHECK_INTERVAL_MS / 1000
      )}s`,

    checksPassed:
      counts.total,

    requestsMinute:
      counts.operational,

    p95,
    p99,

    errorBudget:
      overallUptime === null
        ? null
        : round(
            100 -
              overallUptime,
            2
          )
  };
}

/* ==========================================================
   HTTP RESPONSE / SECURITY
========================================================== */

function applySecurityHeaders(
  response
) {
  response.setHeader(
    "X-Content-Type-Options",
    "nosniff"
  );

  response.setHeader(
    "X-Frame-Options",
    "SAMEORIGIN"
  );

  response.setHeader(
    "Referrer-Policy",
    "strict-origin-when-cross-origin"
  );

  response.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()"
  );

  response.setHeader(
    "Cross-Origin-Resource-Policy",
    "same-origin"
  );
}

function sendJson(
  response,
  statusCode,
  data,
  extraHeaders = {}
) {
  if (response.headersSent) {
    return;
  }

  response.writeHead(
    statusCode,
    {
      "Content-Type":
        "application/json; charset=utf-8",

      "Cache-Control":
        "no-store, no-cache, must-revalidate, proxy-revalidate",

      "Pragma":
        "no-cache",

      "Expires":
        "0",

      "Access-Control-Allow-Origin":
        "*",

      "Access-Control-Allow-Headers":
        "Content-Type, Authorization",

      "Access-Control-Allow-Methods":
        "GET, POST, OPTIONS",

      "X-Content-Type-Options":
        "nosniff",

      ...extraHeaders
    }
  );

  response.end(
    JSON.stringify(data)
  );
}

function readRequestBody(
  request
) {
  return new Promise(
    (resolve, reject) => {
      let body = "";
      let size = 0;
      let settled = false;

      function fail(error) {
        if (settled) return;

        settled = true;
        reject(error);
      }

      request.on(
        "data",
        chunk => {
          size +=
            Buffer.byteLength(
              chunk
            );

          if (
            size >
            MAX_REQUEST_BODY_BYTES
          ) {
            fail(
              new Error(
                "Request body too large"
              )
            );

            request.destroy();

            return;
          }

          body +=
            chunk.toString(
              "utf8"
            );
        }
      );

      request.on(
        "end",
        () => {
          if (settled) return;

          settled = true;
          resolve(body);
        }
      );

      request.on(
        "error",
        fail
      );
    }
  );
}

/* ==========================================================
   STATIC FILES
========================================================== */

function contentTypeFor(
  extension
) {
  const contentTypes = {
    ".html":
      "text/html; charset=utf-8",

    ".htm":
      "text/html; charset=utf-8",

    ".css":
      "text/css; charset=utf-8",

    ".js":
      "text/javascript; charset=utf-8",

    ".mjs":
      "text/javascript; charset=utf-8",

    ".json":
      "application/json; charset=utf-8",

    ".svg":
      "image/svg+xml",

    ".png":
      "image/png",

    ".jpg":
      "image/jpeg",

    ".jpeg":
      "image/jpeg",

    ".webp":
      "image/webp",

    ".ico":
      "image/x-icon",

    ".txt":
      "text/plain; charset=utf-8",

    ".xml":
      "application/xml; charset=utf-8",

    ".webmanifest":
      "application/manifest+json"
  };

  return (
    contentTypes[
      extension
    ] ||
    "application/octet-stream"
  );
}

function safePublicPath(
  pathname
) {
  let decoded;

  try {
    decoded =
      decodeURIComponent(
        pathname
      );
  } catch {
    return null;
  }

  if (
    decoded.includes("\0")
  ) {
    return null;
  }

  const relative =
    decoded
      .replace(/^\/+/, "")
      .replaceAll(
        "/",
        path.sep
      );

  const candidate =
    path.resolve(
      PUBLIC_DIR,
      relative
    );

  const publicRoot =
    path.resolve(
      PUBLIC_DIR
    );

  if (
    candidate !==
      publicRoot &&
    !candidate.startsWith(
      `${publicRoot}${path.sep}`
    )
  ) {
    return null;
  }

  return candidate;
}

function serveStatic(
  request,
  response,
  pathname
) {
  const filePath =
    pathname === "/"
      ? path.join(
          PUBLIC_DIR,
          "index.html"
        )
      : safePublicPath(
          pathname
        );

  if (!filePath) {
    response.writeHead(
      403,
      {
        "Content-Type":
          "text/plain; charset=utf-8"
      }
    );

    response.end(
      "Forbidden"
    );

    return;
  }

  let stats;

  try {
    stats =
      fs.statSync(
        filePath
      );
  } catch {
    response.writeHead(
      404,
      {
        "Content-Type":
          "text/plain; charset=utf-8",
        "Cache-Control":
          "no-store"
      }
    );

    response.end(
      "Not found"
    );

    return;
  }

  if (!stats.isFile()) {
    response.writeHead(
      404,
      {
        "Content-Type":
          "text/plain; charset=utf-8"
      }
    );

    response.end(
      "Not found"
    );

    return;
  }

  const extension =
    path.extname(
      filePath
    ).toLowerCase();

  const isImmutableAsset =
    [
      ".png",
      ".jpg",
      ".jpeg",
      ".webp",
      ".svg",
      ".ico"
    ].includes(
      extension
    );

  applySecurityHeaders(
    response
  );

  response.writeHead(
    200,
    {
      "Content-Type":
        contentTypeFor(
          extension
        ),

      "Cache-Control":
        extension === ".html" ||
        extension === ".js" ||
        extension === ".css"
          ? "no-cache"
          : isImmutableAsset
            ? "public, max-age=86400"
            : "public, max-age=300"
    }
  );

  if (
    request.method ===
    "HEAD"
  ) {
    response.end();
    return;
  }

  const stream =
    fs.createReadStream(
      filePath
    );

  stream.on(
    "error",
    error => {
      console.error(
        "[Dyve Status] Static file error:",
        error
      );

      if (
        !response.headersSent
      ) {
        response.writeHead(
          500
        );
      }

      response.end();
    }
  );

  stream.pipe(
    response
  );
}

/* ==========================================================
   AUTHORIZATION
========================================================== */

function authorizeManualCheck(
  request
) {
  if (!CHECK_TOKEN) {
    return {
      ok: false,
      status: 404,
      error:
        "Manual monitoring endpoint disabled"
    };
  }

  const authorization =
    String(
      request.headers
        .authorization || ""
    );

  const suppliedToken =
    authorization.startsWith(
      "Bearer "
    )
      ? authorization
          .slice(7)
          .trim()
      : "";

  const expected =
    Buffer.from(
      CHECK_TOKEN
    );

  const supplied =
    Buffer.from(
      suppliedToken
    );

  const matches =
    supplied.length ===
      expected.length &&
    crypto.timingSafeEqual(
      supplied,
      expected
    );

  if (!matches) {
    return {
      ok: false,
      status: 401,
      error:
        "Unauthorized"
    };
  }

  return {
    ok: true
  };
}

/* ==========================================================
   ROUTING
========================================================== */

async function handleRequest(
  request,
  response
) {
  applySecurityHeaders(
    response
  );

  if (
    request.method ===
    "OPTIONS"
  ) {
    response.writeHead(
      204,
      {
        "Access-Control-Allow-Origin":
          "*",

        "Access-Control-Allow-Headers":
          "Content-Type, Authorization",

        "Access-Control-Allow-Methods":
          "GET, POST, OPTIONS",

        "Access-Control-Max-Age":
          "86400"
      }
    );

    response.end();

    return;
  }

  const requestUrl =
    new URL(
      request.url || "/",
      `http://${request.headers.host || "localhost"}`
    );

  const pathname =
    requestUrl.pathname;

  if (
    pathname ===
      "/api/status" &&
    request.method ===
      "GET"
  ) {
    sendJson(
      response,
      200,
      publicStatus()
    );

    return;
  }

  if (
    pathname ===
      "/api/health" &&
    request.method ===
      "GET"
  ) {
    const counts =
      calculateCounts();

    sendJson(
      response,
      200,
      {
        status:
          "ok",

        service:
          "Dyve Status Engine",

        version:
          MONITOR_VERSION,

        timestamp:
          now(),

        monitoring: {
          state:
            isMonitoringStale()
              ? "stale"
              : "online",

          stale:
            isMonitoringStale(),

          monitoredAt:
            state.updatedAt,

          ageMs:
            monitoringAge(),

          intervalMs:
            CHECK_INTERVAL_MS,

          timeoutMs:
            REQUEST_TIMEOUT_MS,

          services:
            counts.total,

          operational:
            counts.operational,

          degraded:
            counts.degraded,

          outage:
            counts.outage,

          unknown:
            counts.unknown
        }
      }
    );

    return;
  }

  if (
    pathname ===
      "/api/check" &&
    request.method ===
      "POST"
  ) {
    const authorization =
      authorizeManualCheck(
        request
      );

    if (!authorization.ok) {
      sendJson(
        response,
        authorization.status,
        {
          error:
            authorization.error
        },
        authorization.status ===
          401
          ? {
              "WWW-Authenticate":
                "Bearer"
            }
          : {}
      );

      return;
    }

    const results =
      await runAllChecks();

    sendJson(
      response,
      200,
      {
        ok: true,
        monitoredAt:
          state.updatedAt,
        results
      }
    );

    return;
  }

  if (
    pathname ===
      "/api/heartbeat" &&
    request.method ===
      "POST"
  ) {
    let raw;

    try {
      raw =
        await readRequestBody(
          request
        );
    } catch (error) {
      sendJson(
        response,
        413,
        {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Request body too large"
        }
      );

      return;
    }

    let body = {};

    if (raw) {
      try {
        body =
          JSON.parse(raw);
      } catch {
        sendJson(
          response,
          400,
          {
            ok: false,
            error:
              "Invalid JSON"
          }
        );

        return;
      }
    }

    const result =
      recordHeartbeat(
        body
      );

    sendJson(
      response,
      result.ok
        ? 200
        : 404,
      result
    );

    return;
  }

  if (
    pathname ===
      "/api/services" &&
    request.method ===
      "GET"
  ) {
    sendJson(
      response,
      200,
      {
        services:
          SERVICES.map(
            service => ({
              id:
                service.id,

              name:
                service.name,

              shortName:
                service.shortName,

              description:
                service.description,

              kind:
                service.kind
            })
          )
      }
    );

    return;
  }

  if (
    pathname.startsWith(
      "/api/"
    )
  ) {
    sendJson(
      response,
      404,
      {
        error:
          "API endpoint not found"
      }
    );

    return;
  }

  if (
    request.method ===
      "GET" ||
    request.method ===
      "HEAD"
  ) {
    serveStatic(
      request,
      response,
      pathname
    );

    return;
  }

  sendJson(
    response,
    405,
    {
      error:
        "Method not allowed"
    },
    {
      Allow:
        "GET, HEAD, POST, OPTIONS"
    }
  );
}

/* ==========================================================
   SERVER
========================================================== */

const server =
  http.createServer(
    async (
      request,
      response
    ) => {
      try {
        await handleRequest(
          request,
          response
        );
      } catch (error) {
        console.error(
          "[Dyve Status] Request error:",
          error instanceof Error
            ? error.stack ||
              error.message
            : error
        );

        if (
          !response.headersSent
        ) {
          sendJson(
            response,
            500,
            {
              error:
                "Internal server error"
            }
          );
        } else {
          response.end();
        }
      }
    }
  );

server.on(
  "clientError",
  (
    error,
    socket
  ) => {
    console.error(
      "[Dyve Status] Client error:",
      error.message
    );

    if (
      socket.writable
    ) {
      socket.end(
        "HTTP/1.1 400 Bad Request\r\n\r\n"
      );
    }
  }
);

server.keepAliveTimeout =
  Math.max(
    5000,
    REQUEST_TIMEOUT_MS + 1000
  );

server.headersTimeout =
  Math.max(
    server.keepAliveTimeout +
      5000,
    REQUEST_TIMEOUT_MS +
      5000
  );

/* ==========================================================
   SHUTDOWN
========================================================== */

async function shutdown(
  signal
) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  console.log(
    `[Dyve Status] ${signal} received. Shutting down.`
  );

  if (monitoringTimer) {
    clearInterval(
      monitoringTimer
    );

    monitoringTimer =
      null;
  }

  clearTimeout(
    writeTimer
  );

  try {
    persistState();
  } catch (error) {
    console.error(
      "[Dyve Status] Final state persistence failed:",
      error
    );
  }

  await new Promise(
    resolve => {
      server.close(
        () => {
          console.log(
            "[Dyve Status] HTTP server closed."
          );

          resolve();
        }
      );
    }
  );

  process.exit(0);
}

process.on(
  "SIGTERM",
  () =>
    shutdown(
      "SIGTERM"
    )
);

process.on(
  "SIGINT",
  () =>
    shutdown(
      "SIGINT"
    )
);

process.on(
  "unhandledRejection",
  error => {
    console.error(
      "[Dyve Status] Unhandled promise rejection:",
      error
    );
  }
);

process.on(
  "uncaughtException",
  error => {
    console.error(
      "[Dyve Status] Uncaught exception:",
      error
    );
  }
);

/* ==========================================================
   START
========================================================== */

server.listen(
  PORT,
  async () => {
    console.log("");
    console.log(
      "=================================================="
    );
    console.log(
      " DYVE STATUS ENGINE"
    );
    console.log(
      "=================================================="
    );
    console.log(
      ` Version:             ${MONITOR_VERSION}`
    );
    console.log(
      ` Port:                ${PORT}`
    );
    console.log(
      ` Services:            ${SERVICES.length}`
    );
    console.log(
      ` Poll interval:       ${CHECK_INTERVAL_MS}ms`
    );
    console.log(
      ` Timeout:              ${REQUEST_TIMEOUT_MS}ms`
    );
    console.log(
      ` Failure threshold:   ${FAILURE_THRESHOLD}`
    );
    console.log(
      ` Recovery threshold:  ${RECOVERY_THRESHOLD}`
    );
    console.log(
      ` Uptime window:       ${UPTIME_WINDOW_DAYS} days`
    );
    console.log(
      ` Monitor origin:      ${MONITOR_ORIGIN}`
    );
    console.log(
      ` Manual check auth:   ${CHECK_TOKEN ? "enabled" : "disabled"}`
    );
    console.log(
      "=================================================="
    );
    console.log("");

    if (
      process.argv.includes(
        "--once"
      )
    ) {
      try {
        await runAllChecks();
      } catch (error) {
        console.error(
          "[Dyve Status] One-shot monitoring failed:",
          error
        );

        process.exitCode =
          1;
      } finally {
        server.close(
          () => {
            process.exit(
              process.exitCode ||
                0
            );
          }
        );
      }

      return;
    }

    try {
      await runAllChecks();
    } catch (error) {
      console.error(
        "[Dyve Status] Initial health cycle failed:",
        error
      );
    }

    monitoringTimer =
      setInterval(
        () => {
          runAllChecks().catch(
            error => {
              console.error(
                "[Dyve Status] Scheduled health cycle failed:",
                error
              );
            }
          );
        },
        CHECK_INTERVAL_MS
      );

    if (
      typeof monitoringTimer.unref ===
      "function"
    ) {
      monitoringTimer.unref();
    }
  }
);

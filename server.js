import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { URL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);

const CHECK_INTERVAL_MS = Number(
  process.env.CHECK_INTERVAL_MS || 5 * 60 * 1000
);

const REQUEST_TIMEOUT_MS = Number(
  process.env.REQUEST_TIMEOUT_MS || 10000
);

const FAILURE_THRESHOLD = Number(
  process.env.FAILURE_THRESHOLD || 3
);

const RECOVERY_THRESHOLD = Number(
  process.env.RECOVERY_THRESHOLD || 3
);

const UPTIME_WINDOW_DAYS = Number(
  process.env.UPTIME_WINDOW_DAYS || 30
);

const MAX_CHECKS = Number(
  process.env.MAX_CHECKS || 100000
);

const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL || "";

/*
 * If the last real monitoring cycle is older than this,
 * /api/status will automatically perform a fresh health cycle.
 *
 * This prevents the public API from remaining stuck on
 * "unknown" when a host pauses/restarts its background timer.
 */
const MONITOR_STALE_AFTER_MS = Number(
  process.env.MONITOR_STALE_AFTER_MS ||
  Math.max(
    CHECK_INTERVAL_MS + 30000,
    2 * 60 * 1000
  )
);

/*
 * Prevent multiple simultaneous health cycles.
 */
let activeHealthCycle = null;


const DATA_DIR =
  path.join(
    __dirname,
    "data"
  );

const STATE_FILE =
  path.join(
    DATA_DIR,
    "state.json"
  );

const PUBLIC_DIR =
  path.join(
    __dirname,
    "public"
  );


fs.mkdirSync(
  DATA_DIR,
  {
    recursive: true
  }
);


/* ==========================================================
   SERVICES
========================================================== */

const SERVICES = [

  {
    id:
      "dyve-core",

    name:
      "Dyve Core",

    shortName:
      "Dyve Core",

    description:
      "Main Dyve.online web platform and navigation.",

    kind:
      "http",

    url:
      "https://dyve.online/",

    heartbeatPath:
      "/"
  },


  {
    id:
      "hackax",

    name:
      "HackaX Intelligence",

    shortName:
      "HackaX",

    description:
      "Cybersecurity intelligence, breach and threat reporting.",

    kind:
      "http",

    url:
      "https://dyve.online/index.html",

    heartbeatPath:
      "/"
  },


  {
    id:
      "dyve-tech",

    name:
      "Dyve Tech",

    shortName:
      "Dyve Tech",

    description:
      "Technology news, analysis and editorial publishing.",

    kind:
      "http",

    url:
      "https://dyve.online/tech/index.html",

    heartbeatPath:
      "/tech/"
  },


  {
    id:
      "article-delivery",

    name:
      "Article Delivery",

    shortName:
      "Articles",

    description:
      "Published article pages and editorial content delivery.",

    kind:
      "http",

    url:
      "https://dyve.online/article/dark-web/dark-web-how-it-works",

    heartbeatPath:
      "/article/"
  },


  {
    id:
      "media-delivery",

    name:
      "Media Delivery",

    shortName:
      "Media",

    description:
      "Featured images and media assets used across Dyve.",

    kind:
      "http",

    url:
      "https://res.cloudinary.com/dxdbn6xwy/image/upload/v1787752375/hackax/hackax/iran-linked-hackers-reportedly-took-a-uk-power-generator-offline-for-four-days-heres-why-it-matters-featured-1787752371897.jpg",

    heartbeatPath:
      "/"
  },


  {
    id:
      "publishing",

    name:
      "Publishing System",

    shortName:
      "Publishing",

    description:
      "Editorial publishing and article feed generation.",

    kind:
      "publishing",

    heartbeatPath:
      "/"
  }

];


/* ==========================================================
   TIME
========================================================== */

function now() {

  return new Date().toISOString();

}


function timestampAge(timestamp) {

  if (!timestamp) {
    return Infinity;
  }

  const parsed =
    Date.parse(timestamp);

  if (!Number.isFinite(parsed)) {
    return Infinity;
  }

  return Math.max(
    0,
    Date.now() - parsed
  );

}


/* ==========================================================
   STATE
========================================================== */

function emptyState() {

  const services = {};

  for (
    const service of SERVICES
  ) {

    services[service.id] = {

      status:
        "unknown",

      consecutiveFailures:
        0,

      consecutiveSuccesses:
        0,

      lastCheck:
        null,

      lastSuccess:
        null,

      lastFailure:
        null,

      lastResponseTime:
        null,

      lastHttpStatus:
        null,

      lastError:
        null,

      totalChecks:
        0,

      successfulChecks:
        0,

      checks:
        [],

      heartbeat: {

        count:
          0,

        lastSeen:
          null,

        lastPath:
          null

      }

    };

  }


  return {

    schemaVersion:
      2,

    createdAt:
      now(),

    /*
     * IMPORTANT:
     *
     * updatedAt represents the last REAL
     * monitoring cycle.
     *
     * Heartbeats never modify this value.
     */
    updatedAt:
      null,

    services,

    incidents:
      []

  };

}


function loadState() {

  try {

    if (
      !fs.existsSync(
        STATE_FILE
      )
    ) {

      return emptyState();

    }


    const parsed =
      JSON.parse(
        fs.readFileSync(
          STATE_FILE,
          "utf8"
        )
      );


    const state =
      parsed &&
      typeof parsed === "object"
        ? parsed
        : emptyState();


    if (!state.services) {

      return emptyState();

    }


    for (
      const service of SERVICES
    ) {

      if (
        !state.services[
          service.id
        ]
      ) {

        state.services[
          service.id
        ] =
          emptyState()
            .services[
              service.id
            ];

      }

    }


    if (
      !Array.isArray(
        state.incidents
      )
    ) {

      state.incidents =
        [];

    }


    /*
     * Backward compatibility.
     *
     * Old state files may have used updatedAt
     * as a heartbeat timestamp.
     *
     * We do NOT trust that value as monitoring
     * freshness unless at least one service has
     * an actual lastCheck.
     */
    const hasRealCheck =
      SERVICES.some(
        service =>
          Boolean(
            state.services[
              service.id
            ]?.lastCheck
          )
      );


    if (!hasRealCheck) {

      state.updatedAt =
        null;

    }


    return state;

  }

  catch {

    return emptyState();

  }

}


let state =
  loadState();


/* ==========================================================
   PERSISTENCE
========================================================== */

let writeTimer =
  null;

let writeInProgress =
  false;


function schedulePersist() {

  clearTimeout(
    writeTimer
  );

  writeTimer =
    setTimeout(
      persistState,
      100
    );

}


function persistState() {

  if (
    writeInProgress
  ) {

    return;

  }


  writeInProgress =
    true;


  const tmp =
    `${STATE_FILE}.tmp`;


  try {

    fs.writeFileSync(
      tmp,
      JSON.stringify(
        state,
        null,
        2
      ),
      "utf8"
    );


    fs.renameSync(
      tmp,
      STATE_FILE
    );

  }

  finally {

    writeInProgress =
      false;

  }

}


/* ==========================================================
   SERVICE HELPERS
========================================================== */

function serviceById(
  id
) {

  return (
    SERVICES.find(
      service =>
        service.id === id
    ) ||
    null
  );

}


function serviceByName(
  name
) {

  return (
    SERVICES.find(
      service =>
        service.name === name
    ) ||
    null
  );

}


/* ==========================================================
   UPTIME
========================================================== */

function pruneChecks(
  record
) {

  const cutoff =
    Date.now() -
    UPTIME_WINDOW_DAYS *
      24 *
      60 *
      60 *
      1000;


  record.checks =
    record.checks
      .filter(
        check => {

          const timestamp =
            Date.parse(
              check.checkedAt
            );

          return (
            Number.isFinite(
              timestamp
            ) &&
            timestamp >= cutoff
          );

        }
      )
      .slice(
        -MAX_CHECKS
      );

}


function calculateUptime(
  record
) {

  pruneChecks(
    record
  );


  if (
    !record.checks.length
  ) {

    return null;

  }


  const successes =
    record.checks.filter(
      check =>
        check.ok
    ).length;


  return Number(
    (
      successes /
      record.checks.length *
      100
    ).toFixed(2)
  );

}


/* ==========================================================
   OVERALL STATUS
========================================================== */

function overallStatus() {

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
        status ===
        "major_outage"
    )
  ) {

    return "major_outage";

  }


  if (
    statuses.some(
      status =>
        status ===
        "degraded"
    )
  ) {

    return "degraded";

  }


  if (
    statuses.every(
      status =>
        status ===
        "operational"
    )
  ) {

    return "operational";

  }


  if (
    statuses.some(
      status =>
        status ===
        "operational"
    )
  ) {

    return "degraded";

  }


  return "unknown";

}


/* ==========================================================
   MONITOR FRESHNESS
========================================================== */

function isMonitoringStale() {

  if (
    !state.updatedAt
  ) {

    return true;

  }


  return (
    timestampAge(
      state.updatedAt
    ) >
    MONITOR_STALE_AFTER_MS
  );

}


function monitoringAge() {

  if (
    !state.updatedAt
  ) {

    return null;

  }


  return timestampAge(
    state.updatedAt
  );

}


/* ==========================================================
   PUBLIC STATUS
========================================================== */

function publicStatus() {

  const services =
    SERVICES.map(
      service => {

        const record =
          state.services[
            service.id
          ];


        return {

          id:
            service.id,

          name:
            service.name,

          shortName:
            service.shortName,

          description:
            service.description,

          status:
            record.status,

          responseTime:
            record.lastResponseTime,

          httpStatus:
            record.lastHttpStatus,

          lastChecked:
            record.lastCheck,

          lastSuccess:
            record.lastSuccess,

          uptime:
            calculateUptime(
              record
            ),

          heartbeat: {

            lastSeen:
              record.heartbeat.lastSeen

          }

        };

      }
    );


  return {

    schemaVersion:
      2,

    generatedAt:
      now(),

    monitoredAt:
      state.updatedAt,

    monitoring:

      {

        stale:
          isMonitoringStale(),

        ageMs:
          monitoringAge(),

        intervalMs:
          CHECK_INTERVAL_MS,

        staleAfterMs:
          MONITOR_STALE_AFTER_MS

      },

    overallStatus:
      overallStatus(),

    services,

    incidents:
      state.incidents
        .slice()
        .sort(
          (
            a,
            b
          ) =>
            Date.parse(
              b.startedAt
            ) -
            Date.parse(
              a.startedAt
            )
        )
        .slice(
          0,
          25
        )

  };

}


/* ==========================================================
   URL
========================================================== */

function resolveUrl(
  url
) {

  try {

    return new URL(
      url
    ).toString();

  }

  catch {

    return null;

  }

}


/* ==========================================================
   HTTP FETCH
========================================================== */

async function fetchText(
  url,
  options = {}
) {

  const target =
    resolveUrl(
      url
    );


  if (!target) {

    throw new Error(
      "Invalid URL"
    );

  }


  const controller =
    new AbortController();


  const timer =
    setTimeout(
      () =>
        controller.abort(),
      REQUEST_TIMEOUT_MS
    );


  const started =
    performance.now();


  try {

    const response =
      await fetch(
        target,
        {

          method:
            options.method ||
            "GET",

          redirect:
            "follow",

          signal:
            controller.signal,

          headers:
            {

              "User-Agent":
                "Dyve-Status-Monitor/1.0",

              "Accept":
                options.accept ||
                "*/*"

            }

        }
      );


    const responseTime =
      Math.round(
        performance.now() -
        started
      );


    const text =
      await response.text();


    return {

      ok:
        response.ok,

      status:
        response.status,

      responseTime,

      text

    };

  }

  finally {

    clearTimeout(
      timer
    );

  }

}


/* ==========================================================
   HTTP SERVICE CHECK
========================================================== */

async function checkHttp(
  service
) {

  const result =
    await fetchText(
      service.url
    );


  return {

    ok:
      result.ok,

    status:
      result.status,

    responseTime:
      result.responseTime,

    error:
      result.ok
        ? null
        : `HTTP ${result.status}`

  };

}


/* ==========================================================
   PUBLISHING CHECK
========================================================== */

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


  const results = [];


  await Promise.all(

    feeds.map(
      async feed => {

        try {

          const result =
            await fetchText(
              feed.url,
              {

                accept:
                  "application/json,text/plain,*/*"

              }
            );


          if (
            !result.ok
          ) {

            results.push({

              name:
                feed.name,

              ok:
                false,

              status:
                result.status,

              error:
                `HTTP ${result.status}`

            });

            return;

          }


          let json;


          try {

            json =
              JSON.parse(
                result.text
              );

          }

          catch {

            results.push({

              name:
                feed.name,

              ok:
                false,

              status:
                result.status,

              error:
                "Invalid JSON"

            });

            return;

          }


          const articleCollection =
            Array.isArray(
              json
            ) ||
            Array.isArray(
              json.articles
            ) ||
            Array.isArray(
              json.data
            ) ||
            Array.isArray(
              json.items
            );


          results.push({

            name:
              feed.name,

            ok:
              articleCollection,

            status:
              result.status,

            error:
              articleCollection
                ? null
                : "Unexpected JSON structure"

          });

        }

        catch (error) {

          results.push({

            name:
              feed.name,

            ok:
              false,

            status:
              null,

            error:
              error instanceof Error
                ? error.message
                : "Unknown error"

          });

        }

      }
    )

  );


  const ok =
    results.every(
      result =>
        result.ok
    );


  return {

    ok,

    status:
      ok
        ? 200
        : 503,

    responseTime:
      null,

    error:
      ok
        ? null
        : results
            .filter(
              result =>
                !result.ok
            )
            .map(
              result =>
                `${result.name}: ${result.error}`
            )
            .join("; "),

    details:
      results

  };

}


/* ==========================================================
   INDIVIDUAL HEALTH CHECK
========================================================== */

async function runCheck(
  service
) {

  const checkedAt =
    now();


  let result;


  try {

    if (
      service.kind ===
      "publishing"
    ) {

      result =
        await checkPublishing();

    }

    else {

      result =
        await checkHttp(
          service
        );

    }

  }

  catch (error) {

    result = {

      ok:
        false,

      status:
        null,

      responseTime:
        null,

      error:
        error instanceof Error
          ? error.message
          : "Unknown error"

    };

  }


  const record =
    state.services[
      service.id
    ];


  record.lastCheck =
    checkedAt;

  record.lastResponseTime =
    result.responseTime;

  record.lastHttpStatus =
    result.status ??
    null;

  record.lastError =
    result.error ||
    null;

  record.totalChecks +=
    1;


  /* ========================================================
     SUCCESS
  ======================================================== */

  if (
    result.ok
  ) {

    record.successfulChecks +=
      1;

    record.consecutiveSuccesses +=
      1;

    record.consecutiveFailures =
      0;

    record.lastSuccess =
      checkedAt;


    /*
     * UNKNOWN -> OPERATIONAL
     *
     * The first successful real check is enough
     * to establish that the service is alive.
     */
    if (
      record.status ===
      "unknown"
    ) {

      record.status =
        "operational";

    }


    /*
     * DEGRADED / OUTAGE -> OPERATIONAL
     *
     * Recovery threshold protects against
     * one successful request immediately closing
     * a genuine incident.
     */
    else if (

      record.status !==
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

    }

  }


  /* ========================================================
     FAILURE
  ======================================================== */

  else {

    record.consecutiveFailures +=
      1;

    record.consecutiveSuccesses =
      0;

    record.lastFailure =
      checkedAt;


    /*
     * A temporary 408 / 429 condition is treated
     * as degraded rather than immediately declaring
     * a major outage.
     */
    const isTemporaryFailure =
      result.status ===
        429 ||
      result.status ===
        408;


    if (
      record.consecutiveFailures >=
      FAILURE_THRESHOLD
    ) {

      const nextStatus =
        isTemporaryFailure
          ? "degraded"
          : "major_outage";


      if (
        record.status !==
        nextStatus
      ) {

        record.status =
          nextStatus;

      }


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

    }

    /*
     * Any failure after an operational
     * state immediately exposes degraded status.
     */
    else if (
      record.status ===
      "operational"
    ) {

      record.status =
        "degraded";

    }

  }


  /* ========================================================
     RECORD CHECK
  ======================================================== */

  record.checks.push({

    checkedAt,

    ok:
      Boolean(
        result.ok
      ),

    status:
      result.status ??
      null,

    responseTime:
      result.responseTime ??
      null

  });


  pruneChecks(
    record
  );


  /*
   * IMPORTANT:
   *
   * updatedAt is updated ONLY by an actual
   * health check.
   *
   * Heartbeats never touch this value.
   */
  state.updatedAt =
    checkedAt;


  schedulePersist();


  return {

    service:
      service.name,

    ...result,

    status:
      record.status

  };

}


/* ==========================================================
   INCIDENTS
========================================================== */

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


  if (
    existing
  ) {

    existing.updatedAt =
      startedAt;

    return;

  }


  state.incidents.push({

    id:
      `inc_${Date.now()}_${service.id}`,

    serviceId:
      service.id,

    serviceName:
      service.name,

    title:
      `${service.name} availability issue`,

    status:
      "investigating",

    startedAt,

    updatedAt:
      startedAt,

    resolvedAt:
      null,

    details:
      result.error ||
      (
        result.status
          ? `HTTP ${result.status}`
          : "Health check failed"
      )

  });

}


function resolveIncident(
  serviceId,
  resolvedAt
) {

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

    }

  }

}


/* ==========================================================
   HEALTH CYCLE
========================================================== */

async function runAllChecks() {

  /*
   * If another health cycle is already running,
   * return that same promise.
   */
  if (
    activeHealthCycle
  ) {

    return activeHealthCycle;

  }


  activeHealthCycle =
    (async () => {

      const started =
        Date.now();


      /*
       * Run all services concurrently.
       *
       * This dramatically reduces total cycle
       * duration when one endpoint is slow.
       */
      const results =
        await Promise.all(
          SERVICES.map(
            service =>
              runCheck(
                service
              )
          )
        );


      /*
       * The last actual check timestamp represents
       * the monitoring cycle.
       */
      state.updatedAt =
        now();


      persistState();


      console.log(
        `[${new Date().toISOString()}] ` +
        `health cycle complete in ` +
        `${Date.now() - started}ms`
      );


      return results;

    })()
      .catch(
        error => {

          console.error(
            "[Dyve Status] Health cycle failed:",
            error
          );

          throw error;

        }
      )
      .finally(
        () => {

          activeHealthCycle =
            null;

        }
      );


  return activeHealthCycle;

}


/* ==========================================================
   ENSURE FRESH MONITORING
========================================================== */

async function ensureFreshMonitoring() {

  /*
   * If the monitoring state is fresh,
   * there is nothing to do.
   */
  if (
    !isMonitoringStale()
  ) {

    return;

  }


  console.log(
    "[Dyve Status] Monitoring state is stale. " +
    "Running fresh health checks."
  );


  try {

    await runAllChecks();

  }

  catch (error) {

    /*
     * Do not fabricate a service outage merely
     * because the monitor itself encountered an error.
     *
     * Existing service state remains untouched.
     */
    console.error(
      "[Dyve Status] Unable to refresh monitoring state:",
      error
    );

  }

}


/* ==========================================================
   HEARTBEAT
========================================================== */

function recordHeartbeat(
  body,
  request
) {

  const service =
    serviceById(
      body?.serviceId
    ) ||
    serviceByName(
      body?.service
    );


  if (
    !service
  ) {

    return {

      ok:
        false,

      error:
        "Unknown service"

    };

  }


  const record =
    state.services[
      service.id
    ];


  /*
   * HEARTBEAT DATA IS COMPLETELY SEPARATE
   * FROM HEALTH CHECK DATA.
   */
  record.heartbeat.count +=
    1;

  record.heartbeat.lastSeen =
    now();

  record.heartbeat.lastPath =
    typeof body?.path ===
      "string"
      ? body.path.slice(
          0,
          500
        )
      : null;


  /*
   * IMPORTANT:
   *
   * Do NOT modify state.updatedAt here.
   *
   * updatedAt belongs exclusively to actual
   * monitoring checks.
   */
  schedulePersist();


  return {

    ok:
      true,

    service:
      service.name,

    heartbeat:
      {

        lastSeen:
          record.heartbeat.lastSeen

      }

  };

}


/* ==========================================================
   JSON RESPONSE
========================================================== */

function sendJson(
  response,
  status,
  data
) {

  const payload =
    JSON.stringify(
      data
    );


  response.writeHead(
    status,
    {

      "Content-Type":
        "application/json; charset=utf-8",

      "Cache-Control":
        "no-store",

      "Access-Control-Allow-Origin":
        "*",

      "Access-Control-Allow-Headers":
        "Content-Type",

      "Access-Control-Allow-Methods":
        "GET,POST,OPTIONS"

    }
  );


  response.end(
    payload
  );

}


/* ==========================================================
   STATIC FILE SERVER
========================================================== */

function serveStatic(
  response,
  pathname
) {

  let filePath =
    pathname === "/"
      ? path.join(
          PUBLIC_DIR,
          "index.html"
        )
      : path.join(
          PUBLIC_DIR,
          pathname.replace(
            /^\/+/,
            ""
          )
        );


  const normalized =
    path.normalize(
      filePath
    );


  if (
    !normalized.startsWith(
      PUBLIC_DIR
    )
  ) {

    response.writeHead(
      403
    );

    response.end(
      "Forbidden"
    );

    return;

  }


  if (
    !fs.existsSync(
      normalized
    ) ||
    !fs.statSync(
      normalized
    ).isFile()
  ) {

    response.writeHead(
      404
    );

    response.end(
      "Not found"
    );

    return;

  }


  const extension =
    path.extname(
      normalized
    ).toLowerCase();


  const contentTypes = {

    ".html":
      "text/html; charset=utf-8",

    ".css":
      "text/css; charset=utf-8",

    ".js":
      "text/javascript; charset=utf-8",

    ".json":
      "application/json; charset=utf-8",

    ".svg":
      "image/svg+xml"

  };


  response.writeHead(
    200,
    {

      "Content-Type":
        contentTypes[
          extension
        ] ||
        "application/octet-stream",

      "Cache-Control":
        extension === ".html"
          ? "no-cache"
          : "public, max-age=300"

    }
  );


  fs.createReadStream(
    normalized
  ).pipe(
    response
  );

}


/* ==========================================================
   HTTP SERVER
========================================================== */

const server =
  http.createServer(
    async (
      request,
      response
    ) => {

      try {

        /*
         * CORS preflight
         */
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
                "Content-Type",

              "Access-Control-Allow-Methods":
                "GET,POST,OPTIONS"

            }
          );

          response.end();

          return;

        }


        const url =
          new URL(
            request.url ||
              "/",
            `http://${
              request.headers.host ||
              "localhost"
            }`
          );


        /* ==================================================
           STATUS API
        ================================================== */

        if (
          url.pathname ===
            "/api/status" &&
          request.method ===
            "GET"
        ) {

          /*
           * THIS IS THE CRITICAL FIX.
           *
           * If the monitor has not performed a real
           * health check recently, perform one before
           * returning the public status.
           */
          await ensureFreshMonitoring();


          sendJson(
            response,
            200,
            publicStatus()
          );


          return;

        }


        /* ==================================================
           ENGINE HEALTH
        ================================================== */

        if (
          url.pathname ===
            "/api/health" &&
          request.method ===
            "GET"
        ) {

          sendJson(
            response,
            200,
            {

              status:
                "ok",

              service:
                "Dyve Status Engine",

              timestamp:
                now(),

              monitoring:
                {

                  stale:
                    isMonitoringStale(),

                  monitoredAt:
                    state.updatedAt,

                  ageMs:
                    monitoringAge()

                }

            }
          );


          return;

        }


        /* ==================================================
           HEARTBEAT API
        ================================================== */

        if (
          url.pathname ===
            "/api/heartbeat" &&
          request.method ===
            "POST"
        ) {

          let raw =
            "";


          request.on(
            "data",
            chunk => {

              raw +=
                chunk.toString();


              if (
                raw.length >
                10000
              ) {

                request.destroy();

              }

            }
          );


          request.on(
            "end",
            () => {

              let body =
                {};


              try {

                body =
                  raw
                    ? JSON.parse(
                        raw
                      )
                    : {};

              }

              catch {

                sendJson(
                  response,
                  400,
                  {

                    ok:
                      false,

                    error:
                      "Invalid JSON"

                  }
                );


                return;

              }


              sendJson(
                response,
                200,
                recordHeartbeat(
                  body,
                  request
                )
              );

            }
          );


          return;

        }


        /* ==================================================
           STATIC FILES
        ================================================== */

        if (
          request.method ===
          "GET"
        ) {

          serveStatic(
            response,
            url.pathname
          );


          return;

        }


        /* ==================================================
           METHOD NOT ALLOWED
        ================================================== */

        sendJson(
          response,
          405,
          {

            error:
              "Method not allowed"

          }
        );

      }

      catch (error) {

        console.error(
          error
        );


        sendJson(
          response,
          500,
          {

            error:
              "Internal server error"

          }
        );

      }

    }
  );


/* ==========================================================
   START
========================================================== */

server.listen(
  PORT,
  async () => {

    console.log(
      `Dyve Status Engine listening on port ${PORT}`
    );


    /*
     * --once is useful for manual health checks,
     * deployments and cron-style execution.
     */
    if (
      process.argv.includes(
        "--once"
      )
    ) {

      try {

        await runAllChecks();

      }

      finally {

        server.close();

      }


      return;

    }


    /*
     * Perform a real health check immediately
     * when the server starts.
     */
    try {

      await runAllChecks();

    }

    catch (error) {

      console.error(
        "[Dyve Status] Initial health cycle failed:",
        error
      );

    }


    /*
     * Continue automatic monitoring.
     */
    setInterval(
      () => {

        runAllChecks()
          .catch(
            error => {

              console.error(
                "Health cycle failed:",
                error
              );

            }
          );

      },
      CHECK_INTERVAL_MS
    );

  }
);
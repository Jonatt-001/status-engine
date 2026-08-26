/* =========================================================
   DYVE STATUS PAGE
   Public Monitoring Client
   Matches the supplied DYVE // System Status index.html
========================================================= */

(() => {
  "use strict";

  /* =======================================================
     CONFIG
  ======================================================= */

  const CONFIG = {
    statusEndpoint: "/api/status",

    pollInterval: 30000,

    requestTimeout: 12000,

    maxEvents: 30,

    maxIncidents: 20,

    availabilityDays: 30,

    heartbeatEnabled: true,

    heartbeatInterval: 30000,

    heartbeatEndpoint: "/api/heartbeat",

    staleAfterMs: 10 * 60 * 1000,

    bootLineDelay: 260,

    bootCompleteDelay: 500,

    locale: "en-NG",

    timeZone: "UTC"
  };


  /* =======================================================
     DOM
  ======================================================= */

  const DOM = {
    boot: document.getElementById("boot"),
    bootProgress: document.getElementById("bootProgress"),

    bootLines: Array.from(
      document.querySelectorAll(".boot-line")
    ),

    systemClock: document.getElementById("systemClock"),

    globalState: document.getElementById("globalState"),
    globalSub: document.getElementById("globalSub"),
    globalIndicator: document.getElementById("globalIndicator"),

    uptimeMetric: document.getElementById("uptimeMetric"),
    latencyMetric: document.getElementById("latencyMetric"),
    errorMetric: document.getElementById("errorMetric"),
    nodeMetric: document.getElementById("nodeMetric"),
    incidentMetric: document.getElementById("incidentMetric"),

    serviceMeta: document.getElementById("serviceMeta"),
    serviceMatrix: document.getElementById("serviceMatrix"),

    availabilityMatrix:
      document.getElementById("availabilityMatrix"),

    scanText:
      document.getElementById("scanText"),

    eventCount:
      document.getElementById("eventCount"),

    eventStream:
      document.getElementById("eventStream"),

    incidentLedger:
      document.getElementById("incidentLedger"),

    nodeStatus:
      document.getElementById("nodeStatus"),

    nodeLatency:
      document.getElementById("nodeLatency"),

    cycleStatus:
      document.getElementById("cycleStatus"),

    cycleAge:
      document.getElementById("cycleAge"),

    checksHour:
      document.getElementById("checksHour"),

    checksPassed:
      document.getElementById("checksPassed"),

    requestsMinute:
      document.getElementById("requestsMinute"),

    p95:
      document.getElementById("p95"),

    p99:
      document.getElementById("p99"),

    errorBudget:
      document.getElementById("errorBudget"),

    serviceCount:
      document.getElementById("serviceCount"),

    monitorState:
      document.getElementById("monitorState"),

    probeResult:
      document.getElementById("probeResult"),

    latestCheck:
      document.getElementById("latestCheck"),

    tooltip:
      document.getElementById("tooltip"),

    tooltipDate:
      document.getElementById("tooltipDate"),

    tooltipTitle:
      document.getElementById("tooltipTitle"),

    tooltipStatus:
      document.getElementById("tooltipStatus"),

    modalLayer:
      document.getElementById("modalLayer"),

    modalDot:
      document.getElementById("modalDot"),

    modalService:
      document.getElementById("modalService"),

    modalState:
      document.getElementById("modalState"),

    modalLatency:
      document.getElementById("modalLatency"),

    modalUptime:
      document.getElementById("modalUptime"),

    modalChecks:
      document.getElementById("modalChecks"),

    modalRegion:
      document.getElementById("modalRegion"),

    modalLastCheck:
      document.getElementById("modalLastCheck"),

    modalDescription:
      document.getElementById("modalDescription"),

    toast:
      document.getElementById("toast")
  };


  /* =======================================================
     STATE
  ======================================================= */

  const STATE = {
    initialized: false,

    loading: false,

    online: navigator.onLine,

    lastPayload: null,

    lastSuccessfulFetch: null,

    lastCycle: null,

    selectedService: null,

    events: [],

    incidents: [],

    services: [],

    availability: [],

    pollTimer: null,

    heartbeatTimer: null,

    clockTimer: null,

    staleTimer: null,

    toastTimer: null,

    visibility: !document.hidden,

    requestSequence: 0
  };


  /* =======================================================
     SAFE HELPERS
  ======================================================= */

  function byId(id) {
    return document.getElementById(id);
  }


  function safeNumber(value, fallback = null) {
    if (
      value === null ||
      value === undefined ||
      value === ""
    ) {
      return fallback;
    }

    const number = Number(value);

    return Number.isFinite(number)
      ? number
      : fallback;
  }


  function safeString(value, fallback = "") {
    if (
      value === null ||
      value === undefined
    ) {
      return fallback;
    }

    return String(value);
  }


  function escapeHTML(value) {
    return safeString(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }


  function clamp(value, min, max) {
    return Math.min(
      max,
      Math.max(min, value)
    );
  }


  function formatNumber(value, decimals = 0) {
    const number = safeNumber(value);

    if (number === null) {
      return "--";
    }

    return number.toLocaleString(
      CONFIG.locale,
      {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      }
    );
  }


  function formatPercent(value, decimals = 3) {
    const number = safeNumber(value);

    if (number === null) {
      return "--.---%";
    }

    return (
      number.toFixed(decimals) +
      "%"
    );
  }


  function formatLatency(value) {
    const number = safeNumber(value);

    if (number === null) {
      return "--ms";
    }

    return (
      Math.round(number) +
      "ms"
    );
  }


  function formatDateTime(value) {
    if (!value) {
      return "--";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return safeString(value);
    }

    return new Intl.DateTimeFormat(
      CONFIG.locale,
      {
        timeZone: CONFIG.timeZone,
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
      }
    ).format(date);
  }


  function formatShortTime(value) {
    if (!value) {
      return "--";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "--";
    }

    return new Intl.DateTimeFormat(
      CONFIG.locale,
      {
        timeZone: CONFIG.timeZone,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
      }
    ).format(date);
  }


  function relativeAge(value) {
    if (!value) {
      return "--";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "--";
    }

    const diff =
      Math.max(
        0,
        Date.now() - date.getTime()
      );

    const seconds =
      Math.floor(diff / 1000);

    if (seconds < 5) {
      return "just now";
    }

    if (seconds < 60) {
      return seconds + "s ago";
    }

    const minutes =
      Math.floor(seconds / 60);

    if (minutes < 60) {
      return minutes + "m ago";
    }

    const hours =
      Math.floor(minutes / 60);

    if (hours < 24) {
      return hours + "h ago";
    }

    const days =
      Math.floor(hours / 24);

    return days + "d ago";
  }


  function normalizeState(value) {
    const state =
      safeString(value, "unknown")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/-/g, "_");

    if (
      state === "up" ||
      state === "healthy" ||
      state === "online" ||
      state === "ok" ||
      state === "operational"
    ) {
      return "operational";
    }

    if (
      state === "degraded" ||
      state === "warning" ||
      state === "partial"
    ) {
      return "degraded";
    }

    if (
      state === "down" ||
      state === "offline" ||
      state === "outage" ||
      state === "major_outage" ||
      state === "critical"
    ) {
      return "major_outage";
    }

    return "unknown";
  }


  function stateLabel(state) {
    const normalized =
      normalizeState(state);

    switch (normalized) {
      case "operational":
        return "Operational";

      case "degraded":
        return "Degraded";

      case "major_outage":
        return "Major outage";

      default:
        return "Unknown";
    }
  }


  function stateUpper(state) {
    return stateLabel(state)
      .toUpperCase();
  }


  function stateClass(state) {
    return normalizeState(state);
  }


  function stateIsHealthy(state) {
    return (
      normalizeState(state) ===
      "operational"
    );
  }


  function stateIsKnown(state) {
    return (
      normalizeState(state) !==
      "unknown"
    );
  }


  /* =======================================================
     SVG ICONS
  ======================================================= */

  function serviceIcon(type = "default") {
    const icons = {
      globe: `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="8.5"></circle>
          <path d="M3.5 12h17"></path>
          <path d="M12 3.5c2.2 2.3 3.3 5.1 3.3 8.5s-1.1 6.2-3.3 8.5c-2.2-2.3-3.3-5.1-3.3-8.5S9.8 5.8 12 3.5Z"></path>
        </svg>
      `,

      shield: `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M12 3.5 19 6v5.3c0 4.3-2.7 7.5-7 9.2-4.3-1.7-7-4.9-7-9.2V6l7-2.5Z"></path>
          <path d="m8.7 12 2.1 2.1 4.6-4.6"></path>
        </svg>
      `,

      database: `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <ellipse cx="12" cy="5.5" rx="7" ry="3"></ellipse>
          <path d="M5 5.5v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"></path>
          <path d="M5 11.5v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"></path>
        </svg>
      `,

      api: `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M7 7 3.5 12 7 17"></path>
          <path d="m17 7 3.5 5-3.5 5"></path>
          <path d="m14 4-4 16"></path>
        </svg>
      `,

      cloud: `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M7.5 18.5h9a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.7-1.2A4.6 4.6 0 0 0 7.5 18.5Z"></path>
        </svg>
      `,

      lock: `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="5" y="10" width="14" height="10" rx="1.5"></rect>
          <path d="M8 10V7a4 4 0 0 1 8 0v3"></path>
          <circle cx="12" cy="15" r="1"></circle>
        </svg>
      `,

      default: `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="4" y="4" width="16" height="16" rx="2"></rect>
          <path d="M8 12h8M12 8v8"></path>
        </svg>
      `
    };

    return (
      icons[type] ||
      icons.default
    );
  }


  function detectIcon(service) {
    const value =
      (
        safeString(service.id) +
        " " +
        safeString(service.name) +
        " " +
        safeString(service.type)
      ).toLowerCase();

    if (
      value.includes("api")
    ) {
      return "api";
    }

    if (
      value.includes("security") ||
      value.includes("hack") ||
      value.includes("auth") ||
      value.includes("shield")
    ) {
      return "shield";
    }

    if (
      value.includes("db") ||
      value.includes("database") ||
      value.includes("data")
    ) {
      return "database";
    }

    if (
      value.includes("cloud") ||
      value.includes("cdn") ||
      value.includes("media")
    ) {
      return "cloud";
    }

    if (
      value.includes("auth") ||
      value.includes("login")
    ) {
      return "lock";
    }

    if (
      value.includes("web") ||
      value.includes("site") ||
      value.includes("dyve")
    ) {
      return "globe";
    }

    return "default";
  }


  /* =======================================================
     PAYLOAD NORMALIZATION
  ======================================================= */

  function extractPayloadRoot(payload) {
    if (
      payload &&
      payload.data &&
      typeof payload.data === "object"
    ) {
      return payload.data;
    }

    if (
      payload &&
      payload.status &&
      typeof payload.status === "object"
    ) {
      return payload.status;
    }

    return payload || {};
  }


  function extractServices(root) {
    let services =
      root.services;

    if (
      services &&
      !Array.isArray(services) &&
      typeof services === "object"
    ) {
      services =
        Object.entries(services)
          .map(([id, value]) => ({
            ...(value || {}),
            id:
              value?.id ||
              id
          }));
    }

    if (!Array.isArray(services)) {
      return [];
    }

    return services.map(
      normalizeService
    );
  }


  function normalizeService(service, index = 0) {
    const raw =
      service || {};

    const id =
      raw.id ||
      raw.key ||
      raw.slug ||
      raw.identifier ||
      `service-${index + 1}`;

    const name =
      raw.name ||
      raw.title ||
      raw.label ||
      id;

    const state =
      normalizeState(
        raw.state ||
        raw.status ||
        raw.health ||
        raw.overallStatus
      );

    const latency =
      safeNumber(
        raw.latency ??
        raw.latencyMs ??
        raw.responseTime ??
        raw.responseTimeMs
      );

    const uptime =
      safeNumber(
        raw.uptime ??
        raw.uptime30d ??
        raw.uptimePercentage ??
        raw.availability
      );

    const lastCheck =
      raw.lastCheck ||
      raw.lastCheckedAt ||
      raw.checkedAt ||
      raw.timestamp ||
      raw.updatedAt ||
      null;

    const httpStatus =
      raw.httpStatus ??
      raw.statusCode ??
      raw.http ??
      raw.code ??
      null;

    const identifier =
      raw.identifier ||
      raw.region ||
      raw.id ||
      id;

    const description =
      raw.description ||
      raw.summary ||
      `Live health telemetry for ${name}.`;

    return {
      ...raw,

      id,

      name,

      state,

      latency,

      uptime,

      lastCheck,

      httpStatus,

      identifier,

      description
    };
  }


  function extractEvents(root) {
    const source =
      root.events ||
      root.eventStream ||
      root.activity ||
      [];

    if (!Array.isArray(source)) {
      return [];
    }

    return source
      .slice(0, CONFIG.maxEvents)
      .map(normalizeEvent);
  }


  function normalizeEvent(event, index) {
    const raw =
      event || {};

    const state =
      normalizeState(
        raw.state ||
        raw.status ||
        raw.result
      );

    return {
      id:
        raw.id ||
        raw.eventId ||
        `event-${index}-${Date.now()}`,

      timestamp:
        raw.timestamp ||
        raw.createdAt ||
        raw.time ||
        raw.date ||
        null,

      type:
        raw.type ||
        raw.eventType ||
        raw.action ||
        "CHECK",

      target:
        raw.target ||
        raw.service ||
        raw.serviceName ||
        raw.name ||
        "STATUS ENGINE",

      result:
        raw.result ||
        raw.status ||
        stateLabel(state),

      state,

      message:
        raw.message ||
        raw.description ||
        ""
    };
  }


  function extractIncidents(root) {
    const source =
      root.incidents ||
      root.incidentLedger ||
      root.activeIncidents ||
      [];

    if (!Array.isArray(source)) {
      return [];
    }

    return source
      .slice(0, CONFIG.maxIncidents)
      .map(normalizeIncident);
  }


  function normalizeIncident(incident, index) {
    const raw =
      incident || {};

    const state =
      normalizeState(
        raw.state ||
        raw.status ||
        raw.severity
      );

    return {
      id:
        raw.id ||
        raw.incidentId ||
        `incident-${index}`,

      date:
        raw.date ||
        raw.createdAt ||
        raw.startedAt ||
        raw.timestamp ||
        null,

      title:
        raw.title ||
        raw.name ||
        raw.description ||
        "Service incident",

      description:
        raw.description ||
        raw.message ||
        raw.title ||
        "Service interruption detected.",

      state:
        raw.status ||
        raw.state ||
        "resolved",

      severity:
        raw.severity ||
        state,

      resolvedAt:
        raw.resolvedAt ||
        raw.closedAt ||
        null
    };
  }


  function extractAvailability(root, services) {
    let source =
      root.availability ||
      root.availabilityMatrix ||
      root.history ||
      [];

    if (
      source &&
      !Array.isArray(source) &&
      typeof source === "object"
    ) {
      source =
        Object.entries(source)
          .map(([serviceId, days]) => ({
            serviceId,
            days
          }));
    }

    if (Array.isArray(source)) {
      return normalizeAvailability(
        source,
        services
      );
    }

    return buildAvailabilityFromServices(
      services
    );
  }


  function normalizeAvailability(
    source,
    services
  ) {
    const result = [];

    source.forEach(
      (entry, index) => {
        const raw =
          entry || {};

        const serviceId =
          raw.serviceId ||
          raw.id ||
          raw.key ||
          services[index]?.id ||
          `service-${index + 1}`;

        let days =
          raw.days ||
          raw.history ||
          raw.data ||
          [];

        if (
          !Array.isArray(days) &&
          days &&
          typeof days === "object"
        ) {
          days =
            Object.entries(days)
              .map(([date, value]) => ({
                date,
                state:
                  typeof value === "object"
                    ? value.state
                    : value
              }));
        }

        if (!Array.isArray(days)) {
          days = [];
        }

        result.push({
          serviceId,
          name:
            raw.name ||
            services.find(
              service =>
                service.id === serviceId
            )?.name ||
            serviceId,

          days:
            days
              .slice(-CONFIG.availabilityDays)
              .map(
                normalizeAvailabilityDay
              )
        });
      }
    );

    if (!result.length) {
      return buildAvailabilityFromServices(
        services
      );
    }

    return result;
  }


  function normalizeAvailabilityDay(day) {
    if (
      typeof day === "string"
    ) {
      return {
        date: null,
        state: normalizeState(day)
      };
    }

    const raw =
      day || {};

    return {
      date:
        raw.date ||
        raw.day ||
        raw.timestamp ||
        null,

      state:
        normalizeState(
          raw.state ||
          raw.status ||
          raw.result
        ),

      uptime:
        safeNumber(
          raw.uptime ??
          raw.availability
        )
    };
  }


  function buildAvailabilityFromServices(
    services
  ) {
    return services.map(
      service => ({
        serviceId:
          service.id,

        name:
          service.name,

        days: Array.from(
          {
            length:
              CONFIG.availabilityDays
          },
          (_, index) => ({
            date:
              new Date(
                Date.now() -
                (
                  CONFIG.availabilityDays -
                  index -
                  1
                ) *
                86400000
              ).toISOString(),

            state:
              service.state,

            uptime:
              service.uptime
          })
        )
      })
    );
  }


  function normalizePayload(payload) {
    const root =
      extractPayloadRoot(
        payload
      );

    const services =
      extractServices(root);

    const events =
      extractEvents(root);

    const incidents =
      extractIncidents(root);

    const availability =
      extractAvailability(
        root,
        services
      );

    const monitor =
      root.monitor ||
      root.monitoring ||
      {};

    const cycle =
      root.cycle ||
      monitor.cycle ||
      {};

    const metrics =
      root.metrics ||
      root.overview ||
      {};

    const globalState =
      normalizeState(
        root.overallStatus ||
        root.globalStatus ||
        root.globalState ||
        metrics.overallStatus ||
        calculateGlobalState(
          services
        )
      );

    const lastCheck =
      root.lastCheck ||
      root.lastCheckedAt ||
      root.updatedAt ||
      cycle.completedAt ||
      cycle.timestamp ||
      null;

    const generatedAt =
      root.generatedAt ||
      root.generated_at ||
      root.timestamp ||
      lastCheck ||
      null;

    return {
      raw: payload,

      root,

      globalState,

      globalSub:
        root.globalSub ||
        root.message ||
        root.summary ||
        null,

      services,

      events,

      incidents,

      availability,

      monitor,

      cycle,

      metrics,

      lastCheck,

      generatedAt,

      stale:
        Boolean(
          root.stale ||
          monitor.stale ||
          cycle.stale
        )
    };
  }


  function calculateGlobalState(
    services
  ) {
    if (!services.length) {
      return "unknown";
    }

    const states =
      services.map(
        service =>
          normalizeState(
            service.state
          )
      );

    if (
      states.some(
        state =>
          state ===
          "major_outage"
      )
    ) {
      return "major_outage";
    }

    if (
      states.some(
        state =>
          state ===
          "degraded"
      )
    ) {
      return "degraded";
    }

    if (
      states.every(
        state =>
          state ===
          "operational"
      )
    ) {
      return "operational";
    }

    return "unknown";
  }


  /* =======================================================
     BOOT
  ======================================================= */

  async function runBootSequence() {
    if (!DOM.boot) {
      return;
    }

    const lines =
      DOM.bootLines || [];

    const total =
      lines.length || 1;

    for (
      let index = 0;
      index < lines.length;
      index++
    ) {
      await wait(
        CONFIG.bootLineDelay
      );

      lines[index]
        .classList
        .add("visible");

      if (
        DOM.bootProgress
      ) {
        DOM.bootProgress.style.width =
          (
            (
              index + 1
            ) /
            total *
            100
          ) +
          "%";
      }
    }

    await wait(
      CONFIG.bootCompleteDelay
    );

    DOM.boot.classList.add(
      "complete"
    );
  }


  function wait(ms) {
    return new Promise(
      resolve =>
        setTimeout(
          resolve,
          ms
        )
    );
  }


  /* =======================================================
     CLOCK
  ======================================================= */

  function updateClock() {
    if (!DOM.systemClock) {
      return;
    }

    const now =
      new Date();

    const text =
      new Intl.DateTimeFormat(
        CONFIG.locale,
        {
          timeZone:
            CONFIG.timeZone,

          hour:
            "2-digit",

          minute:
            "2-digit",

          second:
            "2-digit",

          hour12:
            false,

          timeZoneName:
            "short"
        }
      ).format(now);

    DOM.systemClock.textContent =
      text;
  }


  function startClock() {
    updateClock();

    if (
      STATE.clockTimer
    ) {
      clearInterval(
        STATE.clockTimer
      );
    }

    STATE.clockTimer =
      setInterval(
        updateClock,
        1000
      );
  }


  /* =======================================================
     FETCH STATUS
  ======================================================= */

  async function fetchStatus() {
    if (
      STATE.loading
    ) {
      return;
    }

    if (
      !navigator.onLine
    ) {
      STATE.online = false;

      renderUnavailable(
        "OFFLINE",
        "Your browser is offline. Waiting for network connectivity."
      );

      return;
    }

    STATE.loading = true;

    const requestId =
      ++STATE.requestSequence;

    updateScan(
      "SYNCHRONIZING LIVE STATUS"
    );

    try {
      const controller =
        new AbortController();

      const timeout =
        setTimeout(
          () =>
            controller.abort(),
          CONFIG.requestTimeout
        );

      const response =
        await fetch(
          CONFIG.statusEndpoint +
          (
            CONFIG.statusEndpoint.includes("?")
              ? "&"
              : "?"
          ) +
          "_=" +
          Date.now(),
          {
            method: "GET",

            headers: {
              "Accept":
                "application/json",

              "Cache-Control":
                "no-cache"
            },

            cache:
              "no-store",

            credentials:
              "same-origin",

            signal:
              controller.signal
          }
        );

      clearTimeout(
        timeout
      );

      if (
        requestId !==
        STATE.requestSequence
      ) {
        return;
      }

      if (
        !response.ok
      ) {
        throw new Error(
          "Status engine returned HTTP " +
          response.status
        );
      }

      const payload =
        await response.json();

      const normalized =
        normalizePayload(
          payload
        );

      STATE.online = true;

      STATE.lastPayload =
        normalized;

      STATE.lastSuccessfulFetch =
        Date.now();

      STATE.lastCycle =
        normalized.cycle;

      STATE.services =
        normalized.services;

      STATE.events =
        normalized.events;

      STATE.incidents =
        normalized.incidents;

      STATE.availability =
        normalized.availability;

      render(normalized);

      updateScan(
        "LIVE STATUS SYNCHRONIZED"
      );

    } catch (error) {
      console.error(
        "[DYVE STATUS]",
        error
      );

      renderUnavailable(
        "STATUS UNAVAILABLE",
        "The public status engine could not be reached. Existing data is not being treated as current."
      );

      updateScan(
        "STATUS ENGINE UNAVAILABLE"
      );

    } finally {
      STATE.loading = false;
    }
  }


  /* =======================================================
     MAIN RENDER
  ======================================================= */

  function render(data) {
    renderOverview(data);

    renderServices(
      data.services
    );

    renderAvailability(
      data.availability,
      data.services
    );

    renderEvents(
      data.events
    );

    renderIncidents(
      data.incidents
    );

    renderTelemetry(
      data
    );

    updateStaleState(
      data
    );
  }


  /* =======================================================
     OVERVIEW
  ======================================================= */

  function renderOverview(data) {
    let globalState =
      normalizeState(
        data.globalState
      );

    const stale =
      isPayloadStale(
        data
      );

    if (stale) {
      globalState =
        "unknown";
    }

    const stateText =
      stale
        ? "STATUS UNKNOWN"
        : stateUpper(
            globalState
          );

    const stateSub =
      stale
        ? "The monitoring data is stale. DYVE is not claiming current service health until a fresh monitoring cycle is received."
        : (
            data.globalSub ||
            getGlobalDescription(
              globalState
            )
          );

    if (
      DOM.globalState
    ) {
      DOM.globalState.textContent =
        stateText;
    }

    if (
      DOM.globalSub
    ) {
      DOM.globalSub.textContent =
        stateSub;
    }

    if (
      DOM.globalIndicator
    ) {
      DOM.globalIndicator.className =
        "overview-status-indicator";

      if (
        globalState ===
        "degraded"
      ) {
        DOM.globalIndicator.style.background =
          "var(--amber)";
      } else if (
        globalState ===
        "major_outage"
      ) {
        DOM.globalIndicator.style.background =
          "var(--red)";
      } else if (
        globalState ===
        "unknown"
      ) {
        DOM.globalIndicator.style.background =
          "var(--muted-2)";
      } else {
        DOM.globalIndicator.style.background =
          "var(--green-bright)";
      }
    }

    const metrics =
      calculateMetrics(
        data
      );

    if (
      DOM.uptimeMetric
    ) {
      DOM.uptimeMetric.textContent =
        formatPercent(
          metrics.uptime
        );
    }

    if (
      DOM.latencyMetric
    ) {
      DOM.latencyMetric.textContent =
        formatLatency(
          metrics.latency
        );
    }

    if (
      DOM.errorMetric
    ) {
      DOM.errorMetric.textContent =
        formatPercent(
          metrics.errorRate
        );
    }

    if (
      DOM.nodeMetric
    ) {
      DOM.nodeMetric.textContent =
        String(
          metrics.operational
            .toString()
            .padStart(2, "0")
        ) +
        " / " +
        String(
          metrics.total
            .toString()
            .padStart(2, "0")
        );
    }

    if (
      DOM.incidentMetric
    ) {
      DOM.incidentMetric.textContent =
        String(
          metrics.activeIncidents
            .toString()
            .padStart(2, "0")
        );
    }
  }


  function calculateMetrics(data) {
    const services =
      data.services || [];

    const knownServices =
      services.filter(
        service =>
          stateIsKnown(
            service.state
          )
      );

    const operational =
      services.filter(
        service =>
          stateIsHealthy(
            service.state
          )
      ).length;

    const degraded =
      services.filter(
        service =>
          normalizeState(
            service.state
          ) ===
          "degraded"
      ).length;

    const outage =
      services.filter(
        service =>
          normalizeState(
            service.state
          ) ===
          "major_outage"
      ).length;

    const unknown =
      services.filter(
        service =>
          normalizeState(
            service.state
          ) ===
          "unknown"
      ).length;

    const latencies =
      services
        .map(
          service =>
            safeNumber(
              service.latency
            )
        )
        .filter(
          value =>
            value !== null
        )
        .sort(
          (a, b) =>
            a - b
        );

    const uptimeValues =
      services
        .map(
          service =>
            safeNumber(
              service.uptime
            )
        )
        .filter(
          value =>
            value !== null
        );

    const uptime =
      uptimeValues.length
        ? (
            uptimeValues.reduce(
              (sum, value) =>
                sum + value,
              0
            ) /
            uptimeValues.length
          )
        : null;

    const latency =
      latencies.length
        ? median(
            latencies
          )
        : null;

    const errorRate =
      uptime === null
        ? null
        : clamp(
            100 - uptime,
            0,
            100
          );

    const activeIncidents =
      (data.incidents || [])
        .filter(
          incident =>
            !isIncidentResolved(
              incident
            )
        ).length;

    return {
      total:
        services.length,

      operational,

      degraded,

      outage,

      unknown,

      known:
        knownServices.length,

      uptime,

      latency,

      errorRate,

      activeIncidents
    };
  }


  function median(values) {
    if (!values.length) {
      return null;
    }

    const middle =
      Math.floor(
        values.length / 2
      );

    if (
      values.length % 2
    ) {
      return values[middle];
    }

    return (
      values[middle - 1] +
      values[middle]
    ) / 2;
  }


  function getGlobalDescription(
    state
  ) {
    switch (
      normalizeState(state)
    ) {
      case "operational":
        return "All monitored DYVE services are responding normally.";

      case "degraded":
        return "One or more monitored DYVE services are experiencing degraded performance.";

      case "major_outage":
        return "One or more monitored DYVE services are experiencing a major outage.";

      default:
        return "The monitoring system does not currently have enough fresh information to determine global health.";
    }
  }


  /* =======================================================
     SERVICE MATRIX
  ======================================================= */

  function renderServices(
    services
  ) {
    if (
      !DOM.serviceMatrix
    ) {
      return;
    }

    if (
      !services.length
    ) {
      DOM.serviceMatrix.innerHTML =
        `
          <div class="incident-empty">
            No service telemetry available.
          </div>
        `;

      if (
        DOM.serviceMeta
      ) {
        DOM.serviceMeta.textContent =
          "NO DATA";
      }

      return;
    }

    const stale =
      STATE.lastPayload &&
      isPayloadStale(
        STATE.lastPayload
      );

    DOM.serviceMatrix.innerHTML =
      services
        .map(
          service =>
            renderServiceRow(
              service,
              stale
            )
        )
        .join("");

    if (
      DOM.serviceMeta
    ) {
      const operational =
        services.filter(
          service =>
            !stale &&
            stateIsHealthy(
              service.state
            )
        ).length;

      DOM.serviceMeta.textContent =
        stale
          ? "STALE DATA"
          : (
              operational +
              " / " +
              services.length +
              " OPERATIONAL"
            );
    }

    DOM.serviceMatrix
      .querySelectorAll(
        ".service-row"
      )
      .forEach(
        row => {
          row.addEventListener(
            "click",
            () => {
              const serviceId =
                row.dataset.serviceId;

              const service =
                services.find(
                  item =>
                    String(
                      item.id
                    ) ===
                    String(
                      serviceId
                    )
                );

              if (service) {
                openServiceModal(
                  service
                );
              }
            }
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

                const serviceId =
                  row.dataset.serviceId;

                const service =
                  services.find(
                    item =>
                      String(
                        item.id
                      ) ===
                      String(
                        serviceId
                      )
                  );

                if (service) {
                  openServiceModal(
                    service
                  );
                }
              }
            }
          );
        }
      );
  }


  function renderServiceRow(
    service,
    stale
  ) {
    const actualState =
      normalizeState(
        service.state
      );

    const state =
      stale
        ? "unknown"
        : actualState;

    const stateText =
      stateUpper(state);

    const latency =
      stale
        ? "--"
        : formatLatency(
            service.latency
          );

    const uptime =
      stale
        ? "--"
        : formatPercent(
            service.uptime
          );

    const lastCheck =
      stale
        ? "STALE"
        : (
            service.lastCheck
              ? relativeAge(
                  service.lastCheck
                )
              : "--"
          );

    const icon =
      detectIcon(
        service
      );

    const description =
      service.description ||
      `Live health telemetry for ${service.name}.`;

    const http =
      service.httpStatus === null ||
      service.httpStatus === undefined
        ? "--"
        : safeString(
            service.httpStatus
          );

    return `
      <div
        class="service-row"
        data-service-id="${escapeHTML(service.id)}"
        tabindex="0"
        role="button"
        aria-label="View telemetry for ${escapeHTML(service.name)}"
      >

        <div class="service-name-cell">

          <div class="service-symbol">
            ${serviceIcon(icon)}
          </div>

          <div>

            <div class="service-name">
              ${escapeHTML(service.name)}
            </div>

            <div class="service-id">
              ${escapeHTML(service.id)}
            </div>

          </div>

        </div>


        <div class="service-state">

          <span
            class="health-dot ${stateClass(state)}"
          ></span>

          ${escapeHTML(stateText)}

        </div>


        <div class="service-data">

          <div class="service-data-item">

            <div class="service-data-label">
              Latency
            </div>

            <div class="service-data-value">
              ${escapeHTML(latency)}
            </div>

          </div>


          <div class="service-data-item">

            <div class="service-data-label">
              Uptime
            </div>

            <div
              class="service-data-value ${
                state === "operational"
                  ? "green"
                  : ""
              }"
            >
              ${escapeHTML(uptime)}
            </div>

          </div>


          <div class="service-data-item">

            <div class="service-data-label">
              Last check
            </div>

            <div class="service-data-value">
              ${escapeHTML(lastCheck)}
            </div>

          </div>

        </div>

      </div>
    `;
  }


  /* =======================================================
     AVAILABILITY MATRIX
  ======================================================= */

  function renderAvailability(
    availability,
    services
  ) {
    if (
      !DOM.availabilityMatrix
    ) {
      return;
    }

    if (
      !availability.length
    ) {
      DOM.availabilityMatrix.innerHTML =
        `
          <div
            style="
              padding:20px 0;
              color:rgba(216,246,228,.45);
              font-size:8px;
            "
          >
            NO AVAILABILITY HISTORY
          </div>
        `;

      return;
    }

    DOM.availabilityMatrix.innerHTML =
      availability
        .map(
          row =>
            renderAvailabilityRow(
              row,
              services
            )
        )
        .join("");

    DOM.availabilityMatrix
      .querySelectorAll(
        ".availability-bar"
      )
      .forEach(
        bar => {
          bar.addEventListener(
            "mouseenter",
            event =>
              showAvailabilityTooltip(
                event,
                bar
              )
          );

          bar.addEventListener(
            "mouseleave",
            hideTooltip
          );

          bar.addEventListener(
            "touchstart",
            event =>
              showAvailabilityTooltip(
                event,
                bar
              ),
            {
              passive: true
            }
          );
        }
      );
  }


  function renderAvailabilityRow(
    row,
    services
  ) {
    const service =
      services.find(
        item =>
          String(
            item.id
          ) ===
          String(
            row.serviceId
          )
      );

    const name =
      row.name ||
      service?.name ||
      row.serviceId;

    const days =
      Array.isArray(row.days)
        ? row.days.slice(
            -CONFIG.availabilityDays
          )
        : [];

    while (
      days.length <
      CONFIG.availabilityDays
    ) {
      days.unshift({
        date: null,
        state: "unknown"
      });
    }

    const bars =
      days.map(
        (day, index) =>
          renderAvailabilityBar(
            day,
            index
          )
      ).join("");

    const uptime =
      calculateAvailabilityPercent(
        days
      );

    return `
      <div class="availability-row">

        <div class="availability-name">
          ${escapeHTML(name)}
        </div>

        <div class="availability-bars">
          ${bars}
        </div>

        <div class="availability-value">
          ${uptime === null
            ? "--"
            : uptime.toFixed(2) + "%"
          }
        </div>

      </div>
    `;
  }


  function renderAvailabilityBar(
    day,
    index
  ) {
    const state =
      normalizeState(
        day.state
      );

    const title =
      day.date
        ? formatDateTime(
            day.date
          )
        : `Day ${index + 1}`;

    return `
      <div
        class="availability-bar ${state}"
        data-date="${escapeHTML(title)}"
        data-state="${escapeHTML(state)}"
        data-uptime="${
          day.uptime === null ||
          day.uptime === undefined
            ? ""
            : escapeHTML(
                day.uptime
              )
        }"
        title=""
      ></div>
    `;
  }


  function calculateAvailabilityPercent(
    days
  ) {
    const known =
      days.filter(
        day =>
          stateIsKnown(
            day.state
          )
      );

    if (!known.length) {
      return null;
    }

    const operational =
      known.filter(
        day =>
          stateIsHealthy(
            day.state
          )
      ).length;

    return (
      operational /
      known.length *
      100
    );
  }


  /* =======================================================
     TOOLTIP
  ======================================================= */

  function showAvailabilityTooltip(
    event,
    element
  ) {
    if (
      !DOM.tooltip ||
      !element
    ) {
      return;
    }

    const date =
      element.dataset.date ||
      "--";

    const state =
      normalizeState(
        element.dataset.state
      );

    const uptime =
      element.dataset.uptime;

    DOM.tooltipDate.textContent =
      date;

    DOM.tooltipTitle.textContent =
      uptime
        ? `Availability: ${uptime}%`
        : "Daily monitoring result";

    DOM.tooltipStatus.textContent =
      stateUpper(
        state
      );

    DOM.tooltipStatus.className =
      "tooltip-status " +
      stateClass(
        state
      );

    const source =
      event.touches?.[0] ||
      event;

    let x =
      source.clientX ||
      20;

    let y =
      source.clientY ||
      20;

    const width =
      190;

    const height =
      100;

    if (
      x + width >
      window.innerWidth - 10
    ) {
      x =
        window.innerWidth -
        width -
        10;
    }

    if (
      y + height >
      window.innerHeight - 10
    ) {
      y =
        window.innerHeight -
        height -
        10;
    }

    DOM.tooltip.style.left =
      Math.max(
        10,
        x
      ) + "px";

    DOM.tooltip.style.top =
      Math.max(
        10,
        y
      ) + "px";

    DOM.tooltip.classList.add(
      "visible"
    );
  }


  function hideTooltip() {
    if (
      DOM.tooltip
    ) {
      DOM.tooltip.classList.remove(
        "visible"
      );
    }
  }


  /* =======================================================
     EVENT STREAM
  ======================================================= */

  function renderEvents(
    events
  ) {
    if (
      !DOM.eventStream
    ) {
      return;
    }

    if (
      DOM.eventCount
    ) {
      DOM.eventCount.textContent =
        String(
          events.length
        ).padStart(
          2,
          "0"
        );
    }

    if (
      !events.length
    ) {
      DOM.eventStream.innerHTML =
        `
          <div class="event">
            <div class="event-time">--</div>
            <div class="event-type">SYSTEM</div>
            <div class="event-target">No recent events</div>
            <div class="event-result">WAITING</div>
          </div>
        `;

      return;
    }

    DOM.eventStream.innerHTML =
      events
        .map(
          (
            event,
            index
          ) =>
            renderEvent(
              event,
              index
            )
        )
        .join("");
  }


  function renderEvent(
    event,
    index
  ) {
    const state =
      normalizeState(
        event.state
      );

    let resultClass =
      "";

    if (
      state ===
      "degraded"
    ) {
      resultClass =
        "warning";
    }

    if (
      state ===
      "major_outage"
    ) {
      resultClass =
        "danger";
    }

    const result =
      event.result ||
      stateUpper(
        state
      );

    return `
      <div
        class="event"
        style="animation-delay:${Math.min(
          index * 35,
          500
        )}ms"
      >

        <div class="event-time">
          ${escapeHTML(
            formatShortTime(
              event.timestamp
            )
          )}
        </div>

        <div class="event-type">
          ${escapeHTML(
            event.type
          )}
        </div>

        <div class="event-target">
          ${escapeHTML(
            event.target
          )}
        </div>

        <div
          class="event-result ${resultClass}"
        >
          ${escapeHTML(
            result
          )}
        </div>

      </div>
    `;
  }


  /* =======================================================
     INCIDENT LEDGER
  ======================================================= */

  function renderIncidents(
    incidents
  ) {
    if (
      !DOM.incidentLedger
    ) {
      return;
    }

    if (
      !incidents.length
    ) {
      DOM.incidentLedger.innerHTML =
        `
          <div class="incident-empty">
            No incidents have been recorded.
          </div>
        `;

      return;
    }

    DOM.incidentLedger.innerHTML =
      incidents
        .map(
          incident =>
            renderIncident(
              incident
            )
        )
        .join("");
  }


  function renderIncident(
    incident
  ) {
    const resolved =
      isIncidentResolved(
        incident
      );

    const severity =
      normalizeIncidentSeverity(
        incident
      );

    const stateClassName =
      resolved
        ? ""
        : severity;

    const stateText =
      resolved
        ? "Resolved"
        : (
            incident.state ||
            severity ||
            "Active"
          );

    return `
      <div class="incident">

        <div
          class="incident-marker ${stateClassName}"
        ></div>

        <div class="incident-date">
          ${escapeHTML(
            formatDateTime(
              incident.date
            )
          )}
        </div>

        <div class="incident-description">
          ${escapeHTML(
            incident.description ||
            incident.title
          )}
        </div>

        <div
          class="incident-state ${
            resolved
              ? ""
              : "maintenance" ===
                severity
                ? "maintenance"
                : ""
          }"
        >
          ${escapeHTML(
            stateText
          )}
        </div>

      </div>
    `;
  }


  function normalizeIncidentSeverity(
    incident
  ) {
    const value =
      safeString(
        incident.severity ||
        incident.state
      ).toLowerCase();

    if (
      value.includes(
        "critical"
      ) ||
      value.includes(
        "outage"
      ) ||
      value.includes(
        "danger"
      )
    ) {
      return "danger";
    }

    if (
      value.includes(
        "warning"
      ) ||
      value.includes(
        "degraded"
      ) ||
      value.includes(
        "maintenance"
      )
    ) {
      return "warning";
    }

    return "";
  }


  function isIncidentResolved(
    incident
  ) {
    const state =
      safeString(
        incident.state
      ).toLowerCase();

    return Boolean(
      incident.resolvedAt
    ) ||
    state === "resolved" ||
    state === "closed" ||
    state === "recovered" ||
    state === "complete";
  }


  /* =======================================================
     TELEMETRY
  ======================================================= */

  function renderTelemetry(
    data
  ) {
    const metrics =
      calculateMetrics(
        data
      );

    const stale =
      isPayloadStale(
        data
      );

    if (
      DOM.nodeStatus
    ) {
      DOM.nodeStatus.textContent =
        stale
          ? "STALE"
          : "ONLINE";
    }

    if (
      DOM.nodeLatency
    ) {
      DOM.nodeLatency.textContent =
        stale
          ? "--ms"
          : formatLatency(
              metrics.latency
            );
    }

    if (
      DOM.cycleStatus
    ) {
      DOM.cycleStatus.textContent =
        stale
          ? "STALE"
          : (
              data.cycle?.status ||
              "ACTIVE"
            ).toString()
              .toUpperCase();
    }

    if (
      DOM.cycleAge
    ) {
      const cycleTimestamp =
        data.cycle?.completedAt ||
        data.cycle?.timestamp ||
        data.lastCheck;

      DOM.cycleAge.textContent =
        cycleTimestamp
          ? relativeAge(
              cycleTimestamp
            )
          : "--";
    }

    if (
      DOM.checksHour
    ) {
      DOM.checksHour.textContent =
        formatPollInterval(
          data
        );
    }

    if (
      DOM.checksPassed
    ) {
      DOM.checksPassed.textContent =
        String(
          metrics.total
        ).padStart(
          2,
          "0"
        );
    }

    if (
      DOM.requestsMinute
    ) {
      DOM.requestsMinute.textContent =
        String(
          metrics.operational
        ).padStart(
          2,
          "0"
        );
    }

    if (
      DOM.p95
    ) {
      DOM.p95.textContent =
        String(
          metrics.degraded
        ).padStart(
          2,
          "0"
        );
    }

    if (
      DOM.p99
    ) {
      DOM.p99.textContent =
        String(
          metrics.outage
        ).padStart(
          2,
          "0"
        );
    }

    if (
      DOM.errorBudget
    ) {
      DOM.errorBudget.textContent =
        String(
          metrics.unknown
        ).padStart(
          2,
          "0"
        );
    }

    if (
      DOM.serviceCount
    ) {
      DOM.serviceCount.textContent =
        String(
          metrics.total
        ).padStart(
          2,
          "0"
        );
    }

    if (
      DOM.monitorState
    ) {
      DOM.monitorState.textContent =
        stale
          ? "STALE"
          : "ONLINE";
    }

    if (
      DOM.probeResult
    ) {
      DOM.probeResult.textContent =
        stale
          ? "STALE"
          : (
              data.globalState
                ? stateUpper(
                    data.globalState
                  )
                : "ONLINE"
            );
    }

    if (
      DOM.latestCheck
    ) {
      DOM.latestCheck.textContent =
        buildLatestCheckText(
          data
        );
    }
  }


  function formatPollInterval(
    data
  ) {
    const seconds =
      safeNumber(
        data.monitor?.pollInterval ??
        data.monitor?.interval ??
        data.root?.pollInterval ??
        CONFIG.pollInterval / 1000
      );

    if (
      seconds === null
    ) {
      return "30s";
    }

    if (
      seconds >= 60 &&
      seconds % 60 === 0
    ) {
      return (
        seconds / 60 +
        "m"
      );
    }

    return (
      seconds +
      "s"
    );
  }


  function buildLatestCheckText(
    data
  ) {
    if (
      !data.lastCheck
    ) {
      return "No completed monitoring cycle has been received.";
    }

    const stale =
      isPayloadStale(
        data
      );

    const lines = [
      "Last check: " +
        formatDateTime(
          data.lastCheck
        ),

      "Age: " +
        relativeAge(
          data.lastCheck
        ),

      "State: " +
        (
          stale
            ? "STALE"
            : stateUpper(
                data.globalState
              )
        )
    ];

    if (
      data.cycle?.id
    ) {
      lines.push(
        "Cycle: " +
          safeString(
            data.cycle.id
          )
      );
    }

    return lines.join(
      "\n"
    );
  }


  /* =======================================================
     STALENESS
  ======================================================= */

  function isPayloadStale(
    data
  ) {
    if (!data) {
      return true;
    }

    if (
      data.stale === true
    ) {
      return true;
    }

    const timestamp =
      data.generatedAt ||
      data.lastCheck;

    if (!timestamp) {
      return true;
    }

    const date =
      new Date(
        timestamp
      );

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return true;
    }

    return (
      Date.now() -
      date.getTime()
    ) >
    CONFIG.staleAfterMs;
  }


  function updateStaleState(
    data
  ) {
    const stale =
      isPayloadStale(
        data
      );

    if (
      DOM.scanText
    ) {
      DOM.scanText.textContent =
        stale
          ? "MONITORING DATA STALE"
          : "LIVE MONITORING ACTIVE";
    }

    if (
      DOM.serviceMeta
    ) {
      DOM.serviceMeta.textContent =
        stale
          ? "STALE DATA"
          : DOM.serviceMeta.textContent;
    }
  }


  function startStaleTimer() {
    if (
      STATE.staleTimer
    ) {
      clearInterval(
        STATE.staleTimer
      );
    }

    STATE.staleTimer =
      setInterval(
        () => {
          if (
            !STATE.lastPayload
          ) {
            return;
          }

          if (
            isPayloadStale(
              STATE.lastPayload
            )
          ) {
            renderOverview(
              STATE.lastPayload
            );

            renderServices(
              STATE.services
            );

            renderTelemetry(
              STATE.lastPayload
            );

            updateScan(
              "MONITORING DATA STALE"
            );
          }
        },
        5000
      );
  }


  /* =======================================================
     UNAVAILABLE STATE
  ======================================================= */

  function renderUnavailable(
    title,
    message
  ) {
    if (
      DOM.globalState
    ) {
      DOM.globalState.textContent =
        title;
    }

    if (
      DOM.globalSub
    ) {
      DOM.globalSub.textContent =
        message;
    }

    if (
      DOM.globalIndicator
    ) {
      DOM.globalIndicator.style.background =
        "var(--muted-2)";
    }

    if (
      DOM.serviceMeta
    ) {
      DOM.serviceMeta.textContent =
        "UNAVAILABLE";
    }

    if (
      DOM.nodeStatus
    ) {
      DOM.nodeStatus.textContent =
        "OFFLINE";
    }

    if (
      DOM.cycleStatus
    ) {
      DOM.cycleStatus.textContent =
        "WAITING";
    }

    if (
      DOM.monitorState
    ) {
      DOM.monitorState.textContent =
        "OFFLINE";
    }

    if (
      DOM.probeResult
    ) {
      DOM.probeResult.textContent =
        "UNKNOWN";
    }

    if (
      DOM.latestCheck
    ) {
      DOM.latestCheck.textContent =
        message;
    }

    if (
      DOM.scanText
    ) {
      DOM.scanText.textContent =
        "WAITING FOR STATUS ENGINE";
    }

    if (
      DOM.uptimeMetric
    ) {
      DOM.uptimeMetric.textContent =
        "--.---%";
    }

    if (
      DOM.latencyMetric
    ) {
      DOM.latencyMetric.textContent =
        "--ms";
    }

    if (
      DOM.errorMetric
    ) {
      DOM.errorMetric.textContent =
        "--.---%";
    }

    if (
      DOM.nodeMetric
    ) {
      DOM.nodeMetric.textContent =
        "-- / --";
    }

    if (
      DOM.incidentMetric
    ) {
      DOM.incidentMetric.textContent =
        "--";
    }
  }


  /* =======================================================
     SCAN
  ======================================================= */

  function updateScan(
    text
  ) {
    if (
      DOM.scanText
    ) {
      DOM.scanText.textContent =
        text;
    }
  }


  /* =======================================================
     SERVICE MODAL
  ======================================================= */

  function openServiceModal(
    service
  ) {
    if (
      !DOM.modalLayer
    ) {
      return;
    }

    STATE.selectedService =
      service;

    const stale =
      STATE.lastPayload &&
      isPayloadStale(
        STATE.lastPayload
      );

    const state =
      stale
        ? "unknown"
        : normalizeState(
            service.state
          );

    if (
      DOM.modalDot
    ) {
      DOM.modalDot.className =
        "health-dot " +
        stateClass(
          state
        );
    }

    if (
      DOM.modalService
    ) {
      DOM.modalService.textContent =
        service.name;
    }

    if (
      DOM.modalState
    ) {
      DOM.modalState.textContent =
        stateUpper(
          state
        );
    }

    if (
      DOM.modalLatency
    ) {
      DOM.modalLatency.textContent =
        stale
          ? "--"
          : formatLatency(
              service.latency
            );
    }

    if (
      DOM.modalUptime
    ) {
      DOM.modalUptime.textContent =
        stale
          ? "--"
          : formatPercent(
              service.uptime
            );
    }

    if (
      DOM.modalChecks
    ) {
      DOM.modalChecks.textContent =
        service.httpStatus === null ||
        service.httpStatus === undefined
          ? "--"
          : safeString(
              service.httpStatus
            );
    }

    if (
      DOM.modalRegion
    ) {
      DOM.modalRegion.textContent =
        service.identifier ||
        service.id ||
        "--";
    }

    if (
      DOM.modalLastCheck
    ) {
      DOM.modalLastCheck.textContent =
        stale
          ? "STALE"
          : formatDateTime(
              service.lastCheck
            );
    }

    if (
      DOM.modalDescription
    ) {
      DOM.modalDescription.textContent =
        stale
          ? "The monitoring record for this service is stale. The status engine is intentionally withholding a current health claim until fresh telemetry is received."
          : (
              service.description ||
              `Live health telemetry for ${service.name}.`
            );
    }

    DOM.modalLayer.classList.add(
      "visible"
    );

    document.body.style.overflow =
      "hidden";
  }


  function closeModal(
    event
  ) {
    if (
      event &&
      event.target !==
        DOM.modalLayer
    ) {
      return;
    }

    if (
      DOM.modalLayer
    ) {
      DOM.modalLayer.classList.remove(
        "visible"
      );
    }

    document.body.style.overflow =
      "";
  }


  window.closeModal =
    closeModal;


  /* =======================================================
     TOAST
  ======================================================= */

  function showToast(
    message
  ) {
    if (
      !DOM.toast
    ) {
      return;
    }

    DOM.toast.textContent =
      message;

    DOM.toast.classList.add(
      "visible"
    );

    if (
      STATE.toastTimer
    ) {
      clearTimeout(
        STATE.toastTimer
      );
    }

    STATE.toastTimer =
      setTimeout(
        () => {
          DOM.toast.classList.remove(
            "visible"
          );
        },
        2600
      );
  }


  /* =======================================================
     HEARTBEAT
  ======================================================= */

  function sendHeartbeat() {
    if (
      !CONFIG.heartbeatEnabled ||
      !navigator.onLine
    ) {
      return;
    }

    /*
      Heartbeats are intentionally non-authoritative.
      They must never determine public service health.
    */

    fetch(
      CONFIG.heartbeatEndpoint,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          "Accept":
            "application/json"
        },

        credentials:
          "same-origin",

        keepalive:
          true,

        body:
          JSON.stringify({
            timestamp:
              new Date().toISOString(),

            visibility:
              document.visibilityState,

            online:
              navigator.onLine,

            page:
              location.pathname
          })
      }
    ).catch(
      () => {}
    );
  }


  function startHeartbeat() {
    if (
      !CONFIG.heartbeatEnabled
    ) {
      return;
    }

    if (
      STATE.heartbeatTimer
    ) {
      clearInterval(
        STATE.heartbeatTimer
      );
    }

    sendHeartbeat();

    STATE.heartbeatTimer =
      setInterval(
        sendHeartbeat,
        CONFIG.heartbeatInterval
      );
  }


  /* =======================================================
     POLLING
  ======================================================= */

  function startPolling() {
    if (
      STATE.pollTimer
    ) {
      clearInterval(
        STATE.pollTimer
      );
    }

    STATE.pollTimer =
      setInterval(
        () => {
          if (
            document.hidden
          ) {
            return;
          }

          fetchStatus();
        },
        CONFIG.pollInterval
      );
  }


  /* =======================================================
     VISIBILITY
  ======================================================= */

  function handleVisibilityChange() {
    STATE.visibility =
      !document.hidden;

    if (
      !document.hidden
    ) {
      fetchStatus();
    }
  }


  /* =======================================================
     NETWORK
  ======================================================= */

  function handleOnline() {
    STATE.online = true;

    showToast(
      "Network restored. Refreshing status."
    );

    fetchStatus();
  }


  function handleOffline() {
    STATE.online = false;

    showToast(
      "Network connection lost."
    );

    renderUnavailable(
      "OFFLINE",
      "Your browser is offline. Waiting for network connectivity."
    );
  }


  /* =======================================================
     KEYBOARD
  ======================================================= */

  function handleKeyboard(
    event
  ) {
    if (
      event.key ===
      "Escape"
    ) {
      closeModal();
      hideTooltip();
    }
  }


  /* =======================================================
     ERROR BOUNDARY
  ======================================================= */

  window.addEventListener(
    "error",
    event => {
      console.error(
        "[DYVE STATUS ERROR]",
        event.error ||
          event.message
      );
    }
  );


  window.addEventListener(
    "unhandledrejection",
    event => {
      console.error(
        "[DYVE STATUS PROMISE ERROR]",
        event.reason
      );
    }
  );


  /* =======================================================
     INITIALIZE
  ======================================================= */

  async function init() {
    if (
      STATE.initialized
    ) {
      return;
    }

    STATE.initialized =
      true;

    startClock();

    startStaleTimer();

    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange
    );

    window.addEventListener(
      "online",
      handleOnline
    );

    window.addEventListener(
      "offline",
      handleOffline
    );

    document.addEventListener(
      "keydown",
      handleKeyboard
    );

    window.addEventListener(
      "scroll",
      hideTooltip,
      {
        passive: true
      }
    );

    /*
      Start the boot sequence without blocking
      the status engine.
    */

    runBootSequence()
      .catch(
        error =>
          console.error(
            "[DYVE BOOT]",
            error
          )
      );

    /*
      Fetch immediately rather than waiting for
      the first polling interval.
    */

    await fetchStatus();

    startPolling();

    startHeartbeat();
  }


  /* =======================================================
     DOM READY
  ======================================================= */

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      init,
      {
        once: true
      }
    );
  } else {
    init();
  }


})();
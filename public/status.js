(() => {
  "use strict";

  /*
   * ==========================================================
   * DYVE STATUS CLIENT
   * ==========================================================
   *
   * This browser client is telemetry + presentation only.
   *
   * The independent Dyve Status Engine at
   * https://status.dyve.online is authoritative.
   *
   * Browser heartbeats never establish service health.
   * ==========================================================
   */

  const GLOBAL_KEY = "__DYVE_STATUS_CLIENT__";

  if (window[GLOBAL_KEY]) {
    return;
  }

  window[GLOBAL_KEY] = true;

  const DEFAULT_API = "https://status.dyve.online/api";

  const API = String(
    window.DYVE_STATUS_API || DEFAULT_API
  ).replace(/\/+$/, "");

  const DEFAULT_REFRESH_INTERVAL = 60 * 1000;
  const MIN_REFRESH_INTERVAL = 15 * 1000;
  const MAX_REFRESH_INTERVAL = 5 * 60 * 1000;
  const HEARTBEAT_INTERVAL = 5 * 60 * 1000;
  const API_TIMEOUT = 15 * 1000;
  const INITIAL_RETRY_DELAY = 5 * 1000;
  const MAX_RETRY_DELAY = 60 * 1000;

  const SERVICES = Object.freeze({
    "dyve-core": "Dyve Core",
    "hackax": "HackaX Intelligence",
    "dyve-tech": "Dyve Tech",
    "article-delivery": "Article Delivery",
    "media-delivery": "Media Delivery",
    publishing: "Publishing System"
  });

  const SERVICE_NAME_TO_ID = Object.freeze({
    "Dyve Core": "dyve-core",
    HackaX: "hackax",
    "HackaX Intelligence": "hackax",
    "Dyve Tech": "dyve-tech",
    "Article Delivery": "article-delivery",
    Articles: "article-delivery",
    "Media Delivery": "media-delivery",
    Media: "media-delivery",
    "Publishing System": "publishing",
    Publishing: "publishing"
  });

  function normalizeServiceId(value) {
    if (!value) return null;

    const normalized = String(value).trim();

    if (SERVICES[normalized]) {
      return normalized;
    }

    if (SERVICE_NAME_TO_ID[normalized]) {
      return SERVICE_NAME_TO_ID[normalized];
    }

    const lowercase = normalized.toLowerCase();

    const idMatch = Object.keys(SERVICES).find(
      id => id.toLowerCase() === lowercase
    );

    if (idMatch) {
      return idMatch;
    }

    const nameMatch = Object.entries(SERVICE_NAME_TO_ID).find(
      ([name]) => name.toLowerCase() === lowercase
    );

    return nameMatch?.[1] || null;
  }

  function inferServiceId(pathname) {
    const path =
      String(pathname || "/")
        .replace(/\/+/g, "/")
        .replace(/\/+$/, "") || "/";

    if (path === "/hackax" || path.startsWith("/hackax/")) {
      return "hackax";
    }

    if (path === "/tech" || path.startsWith("/tech/")) {
      return "dyve-tech";
    }

    if (path === "/article" || path.startsWith("/article/")) {
      return "article-delivery";
    }

    /*
     * The root Dyve property is Dyve Core.
     * HackaX must be explicitly routed or explicitly configured.
     */
    if (path === "/" || path === "/index.html") {
      return "dyve-core";
    }

    return "dyve-core";
  }

  const configuredService = normalizeServiceId(
    window.DYVE_STATUS_SERVICE
  );

  const serviceId =
    configuredService ||
    inferServiceId(window.location.pathname);

  const serviceName =
    SERVICES[serviceId] ||
    "Dyve Core";

  let currentStatus = "unknown";
  let currentData = null;
  let refreshTimer = null;
  let heartbeatTimer = null;
  let retryTimer = null;
  let retryAttempt = 0;
  let requestController = null;
  let initialized = false;
  let heartbeatInFlight = false;
  let statusRequestInFlight = false;
  let lastSuccessfulStatusFetch = 0;
  let dynamicRefreshInterval = DEFAULT_REFRESH_INTERVAL;

  function clamp(value, minimum, maximum) {
    return Math.min(
      maximum,
      Math.max(minimum, value)
    );
  }

  function normalizeRefreshInterval(value) {
    const number = Number(value);

    if (!Number.isFinite(number) || number <= 0) {
      return DEFAULT_REFRESH_INTERVAL;
    }

    return clamp(
      number,
      MIN_REFRESH_INTERVAL,
      MAX_REFRESH_INTERVAL
    );
  }

  function isPageVisible() {
    return document.visibilityState === "visible";
  }

  function getStatusContainers() {
    return document.querySelectorAll(
      ".dyve-system-status"
    );
  }

  function getStatusLabel(status, monitorState) {
    if (monitorState === "stale") {
      return {
        text: "Status verification delayed",
        className: "checking"
      };
    }

    switch (status) {
      case "operational":
        return {
          text: "All systems operational",
          className: "operational"
        };

      case "degraded":
      case "partial":
        return {
          text:
            status === "partial"
              ? "Some systems are still checking"
              : "Systems partially degraded",
          className:
            status === "partial"
              ? "partial"
              : "degraded"
        };

      case "major_outage":
        return {
          text: "Service disruption detected",
          className: "major-outage"
        };

      default:
        return {
          text: "Status checking",
          className: "checking"
        };
    }
  }

  function formatRelativeTime(timestamp) {
    if (!timestamp) return "Unknown";

    const parsed = Date.parse(timestamp);

    if (!Number.isFinite(parsed)) {
      return "Unknown";
    }

    const difference = Math.max(
      0,
      Date.now() - parsed
    );

    const seconds = Math.floor(
      difference / 1000
    );

    if (seconds < 5) return "Just now";
    if (seconds < 60) return `${seconds}s ago`;

    const minutes = Math.floor(
      seconds / 60
    );

    if (minutes < 60) {
      return `${minutes}m ago`;
    }

    const hours = Math.floor(
      minutes / 60
    );

    if (hours < 24) {
      return `${hours}h ago`;
    }

    return `${Math.floor(hours / 24)}d ago`;
  }

  function formatServiceStatus(status) {
    switch (status) {
      case "operational":
        return "Operational";
      case "degraded":
        return "Degraded";
      case "major_outage":
        return "Major outage";
      case "unknown":
        return "Unknown";
      default:
        return "Checking";
    }
  }

  function updateStatusUI(data) {
    const containers = getStatusContainers();

    if (!containers.length) {
      return;
    }

    const status = data?.overallStatus || "unknown";
    const monitorState =
      data?.monitor?.state || "unknown";

    const presentation = getStatusLabel(
      status,
      monitorState
    );

    containers.forEach(container => {
      container.classList.remove(
        "operational",
        "degraded",
        "major-outage",
        "checking",
        "partial",
        "unknown"
      );

      container.classList.add(
        presentation.className
      );

      container.dataset.dyveStatus =
        status;

      container.dataset.dyveMonitor =
        monitorState;

      const textElement =
        container.querySelector(
          "[data-dyve-status-text]"
        );

      if (textElement) {
        textElement.textContent =
          presentation.text;
      }

      const uptimeElement =
        container.querySelector(
          "[data-dyve-status-uptime]"
        );

      if (uptimeElement) {
        const uptime =
          data?.metrics?.uptime;

        uptimeElement.textContent =
          Number.isFinite(uptime)
            ? `${uptime.toFixed(2)}%`
            : "—";
      }

      const latencyElement =
        container.querySelector(
          "[data-dyve-status-latency]"
        );

      if (latencyElement) {
        const latency =
          data?.metrics?.latency;

        latencyElement.textContent =
          Number.isFinite(latency)
            ? `${Math.round(latency)}ms`
            : "—";
      }

      const incidentElement =
        container.querySelector(
          "[data-dyve-status-incidents]"
        );

      if (incidentElement) {
        incidentElement.textContent =
          String(
            Number(data?.metrics?.incidents || 0)
          );
      }

      const checkedElement =
        container.querySelector(
          "[data-dyve-status-checked]"
        );

      if (checkedElement) {
        checkedElement.textContent =
          data?.monitoredAt
            ? formatRelativeTime(
                data.monitoredAt
              )
            : "Checking";
      }
    });
  }

  function findServiceData(data) {
    if (!Array.isArray(data?.services)) {
      return null;
    }

    return (
      data.services.find(
        service => service.id === serviceId
      ) ||
      data.services.find(
        service =>
          normalizeServiceId(
            service.name
          ) === serviceId
      ) ||
      null
    );
  }

  function updateServiceUI(data) {
    const currentService =
      findServiceData(data);

    const containers =
      document.querySelectorAll(
        "[data-dyve-service-status]"
      );

    if (!containers.length) {
      return;
    }

    containers.forEach(container => {
      const targetId =
        normalizeServiceId(
          container.dataset
            .dyveServiceStatus
        );

      if (targetId !== serviceId) {
        return;
      }

      const status =
        currentService?.status ||
        "unknown";

      container.classList.remove(
        "operational",
        "degraded",
        "major-outage",
        "checking",
        "unknown"
      );

      container.classList.add(
        status === "major_outage"
          ? "major-outage"
          : status
      );

      container.dataset.dyveService =
        serviceId;

      container.dataset.dyveStatus =
        status;

      const textElement =
        container.querySelector(
          "[data-dyve-service-status-text]"
        );

      if (textElement) {
        textElement.textContent =
          formatServiceStatus(status);
      }

      const uptimeElement =
        container.querySelector(
          "[data-dyve-service-uptime]"
        );

      if (uptimeElement) {
        uptimeElement.textContent =
          Number.isFinite(
            currentService?.uptime
          )
            ? `${currentService.uptime.toFixed(2)}%`
            : "—";
      }

      const latencyElement =
        container.querySelector(
          "[data-dyve-service-latency]"
        );

      if (latencyElement) {
        latencyElement.textContent =
          Number.isFinite(
            currentService?.responseTime
          )
            ? `${Math.round(
                currentService.responseTime
              )}ms`
            : "—";
      }

      const checkedElement =
        container.querySelector(
          "[data-dyve-service-checked]"
        );

      if (checkedElement) {
        checkedElement.textContent =
          currentService?.lastChecked
            ? formatRelativeTime(
                currentService.lastChecked
              )
            : "Checking";
      }
    });
  }

  function updateDocumentMetadata(data) {
    document.documentElement.dataset.dyveStatus =
      data?.overallStatus || "unknown";

    document.documentElement.dataset.dyveObservedStatus =
      data?.observedStatus || "unknown";

    document.documentElement.dataset.dyveService =
      serviceId;

    document.documentElement.dataset.dyveMonitor =
      data?.monitor?.state || "unknown";

    document.documentElement.dataset.dyveMonitorStale =
      data?.cycle?.stale
        ? "true"
        : "false";
  }

  function emitStatusEvent(data) {
    currentData = data;
    currentStatus =
      data?.overallStatus || "unknown";

    try {
      window.dispatchEvent(
        new CustomEvent(
          "dyve:status",
          {
            detail: {
              data,
              overallStatus: currentStatus,
              serviceId,
              serviceName,
              service:
                findServiceData(data),
              timestamp: Date.now()
            }
          }
        )
      );
    } catch {
      /* Ignore unsupported CustomEvent environments. */
    }
  }

  function updateTemporaryUnavailableUI() {
    getStatusContainers().forEach(
      container => {
        container.classList.remove(
          "operational",
          "degraded",
          "major-outage",
          "partial",
          "unknown"
        );

        container.classList.add(
          "checking"
        );

        container.dataset.dyveStatus =
          "checking";

        const textElement =
          container.querySelector(
            "[data-dyve-status-text]"
          );

        if (textElement) {
          textElement.textContent =
            "Status temporarily unavailable";
        }
      }
    );
  }

  async function fetchStatus() {
    if (statusRequestInFlight) {
      return null;
    }

    statusRequestInFlight = true;

    if (requestController) {
      try {
        requestController.abort();
      } catch {
        /* Ignore abort errors. */
      }
    }

    requestController =
      new AbortController();

    const timeout =
      setTimeout(() => {
        try {
          requestController.abort();
        } catch {
          /* Ignore abort errors. */
        }
      }, API_TIMEOUT);

    try {
      const response =
        await fetch(
          `${API}/status?t=${Date.now()}`,
          {
            method: "GET",
            cache: "no-store",
            credentials: "omit",
            headers: {
              Accept:
                "application/json",
              "Cache-Control":
                "no-cache",
              Pragma:
                "no-cache"
            },
            signal:
              requestController.signal
          }
        );

      if (!response.ok) {
        throw new Error(
          `Status API returned ${response.status}`
        );
      }

      const data =
        await response.json();

      if (
        !data ||
        typeof data !== "object"
      ) {
        throw new Error(
          "Status API returned invalid data"
        );
      }

      const serverRefresh =
        data?.refresh?.intervalMs;

      if (
        Number.isFinite(
          Number(serverRefresh)
        )
      ) {
        dynamicRefreshInterval =
          normalizeRefreshInterval(
            Number(serverRefresh)
          );
      }

      retryAttempt = 0;
      lastSuccessfulStatusFetch =
        Date.now();

      updateStatusUI(data);
      updateServiceUI(data);
      updateDocumentMetadata(data);
      emitStatusEvent(data);

      return data;
    } catch (error) {
      if (
        error?.name !==
        "AbortError"
      ) {
        console.error(
          "Dyve Status:",
          error
        );
      }

      updateTemporaryUnavailableUI();
      scheduleRetry();

      return null;
    } finally {
      clearTimeout(timeout);
      statusRequestInFlight = false;
      requestController = null;
    }
  }

  function scheduleRetry() {
    if (
      retryTimer ||
      !isPageVisible()
    ) {
      return;
    }

    retryAttempt += 1;

    const exponentialDelay =
      INITIAL_RETRY_DELAY *
      Math.pow(
        2,
        Math.min(
          retryAttempt - 1,
          5
        )
      );

    const delay =
      clamp(
        exponentialDelay,
        INITIAL_RETRY_DELAY,
        MAX_RETRY_DELAY
      );

    retryTimer =
      setTimeout(
        async () => {
          retryTimer = null;

          await loadStatus();

          if (
            lastSuccessfulStatusFetch
          ) {
            scheduleRefresh();
          }
        },
        delay
      );
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = null;

    if (!isPageVisible()) {
      return;
    }

    refreshTimer =
      setTimeout(
        async () => {
          refreshTimer = null;

          await loadStatus();

          if (!retryTimer) {
            scheduleRefresh();
          }
        },
        dynamicRefreshInterval
      );
  }

  async function loadStatus() {
    if (!isPageVisible()) {
      return null;
    }

    if (navigator.onLine === false) {
      updateTemporaryUnavailableUI();
      return null;
    }

    const data =
      await fetchStatus();

    if (data) {
      scheduleRefresh();
    }

    return data;
  }

  async function sendHeartbeat(options = {}) {
    if (heartbeatInFlight) {
      return;
    }

    if (
      !options.force &&
      !isPageVisible()
    ) {
      return;
    }

    if (
      navigator.onLine === false
    ) {
      return;
    }

    heartbeatInFlight = true;

    const payload = {
      serviceId,
      service: serviceName,
      path: window.location.pathname,
      timestamp:
        new Date().toISOString(),
      visibility:
        document.visibilityState,
      online:
        navigator.onLine !== false,
      userAgent:
        navigator.userAgent.slice(
          0,
          300
        )
    };

    try {
      const response =
        await fetch(
          `${API}/heartbeat`,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
              Accept:
                "application/json"
            },
            body:
              JSON.stringify(payload),
            keepalive: true,
            credentials: "omit",
            cache: "no-store"
          }
        );

      if (response.ok) {
        window.dispatchEvent(
          new CustomEvent(
            "dyve:heartbeat",
            {
              detail: {
                serviceId,
                serviceName,
                timestamp: Date.now()
              }
            }
          )
        );
      }
    } catch {
      /* Heartbeats are deliberately best-effort. */
    } finally {
      heartbeatInFlight = false;
    }
  }

  function scheduleHeartbeat() {
    clearTimeout(heartbeatTimer);

    heartbeatTimer =
      setTimeout(
        async () => {
          heartbeatTimer = null;

          await sendHeartbeat();

          scheduleHeartbeat();
        },
        HEARTBEAT_INTERVAL
      );
  }

  function handleVisibilityChange() {
    if (
      document.visibilityState ===
      "hidden"
    ) {
      clearTimeout(refreshTimer);
      clearTimeout(retryTimer);

      refreshTimer = null;
      retryTimer = null;

      return;
    }

    loadStatus();
    sendHeartbeat();
    scheduleRefresh();
  }

  function handleOnline() {
    retryAttempt = 0;
    loadStatus();
    sendHeartbeat();
    scheduleRefresh();
  }

  function handleOffline() {
    updateTemporaryUnavailableUI();

    clearTimeout(refreshTimer);
    clearTimeout(retryTimer);

    refreshTimer = null;
    retryTimer = null;
  }

  function handlePageHide() {
    sendHeartbeat({
      force: true
    });
  }

  function exposeClientAPI() {
    window.DyveStatus = {
      serviceId,
      serviceName,

      getStatus: () =>
        currentStatus,

      getData: () =>
        currentData,

      refresh: () =>
        loadStatus(),

      heartbeat: () =>
        sendHeartbeat(),

      isMonitoringFresh: () =>
        Boolean(
          currentData?.cycle &&
          currentData.cycle.stale === false
        )
    };
  }

  async function init() {
    if (initialized) {
      return;
    }

    initialized = true;

    exposeClientAPI();

    document.documentElement.dataset.dyveService =
      serviceId;

    document.documentElement.dataset.dyveServiceName =
      serviceName;

    sendHeartbeat();
    await loadStatus();
    scheduleHeartbeat();
  }

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

  window.addEventListener(
    "pagehide",
    handlePageHide
  );

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      init,
      { once: true }
    );
  } else {
    init();
  }
})();

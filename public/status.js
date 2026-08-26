(() => {

  "use strict";


  /*
   * ==========================================================
   * DYVE STATUS CLIENT
   * ==========================================================
   *
   * This script is intentionally lightweight.
   *
   * IMPORTANT:
   *
   * This client is NOT the monitoring authority.
   *
   * The independent Dyve Status Engine at
   * https://status.dyve.online is authoritative.
   *
   * This script:
   *
   * 1. Identifies the current Dyve service.
   * 2. Sends application heartbeats.
   * 3. Reads authoritative status from the monitor.
   * 4. Updates status UI elements.
   * 5. Exposes live status data to the page.
   *
   * ==========================================================
   */


  /* ==========================================================
     CONFIGURATION
  ========================================================== */

  const DEFAULT_API =
    "https://status.dyve.online/api";


  const API =
    String(
      window.DYVE_STATUS_API ||
      DEFAULT_API
    )
      .replace(
        /\/+$/,
        ""
      );


  const DEFAULT_REFRESH_INTERVAL =
    60 * 1000;


  const MIN_REFRESH_INTERVAL =
    15 * 1000;


  const MAX_REFRESH_INTERVAL =
    5 * 60 * 1000;


  const HEARTBEAT_INTERVAL =
    5 * 60 * 1000;


  const API_TIMEOUT =
    15 * 1000;


  const INITIAL_RETRY_DELAY =
    5 * 1000;


  const MAX_RETRY_DELAY =
    60 * 1000;


  /*
   * Prevent multiple instances of this script from creating
   * duplicate polling timers.
   */
  const GLOBAL_KEY =
    "__DYVE_STATUS_CLIENT__";


  if (
    window[GLOBAL_KEY]
  ) {

    return;

  }


  window[GLOBAL_KEY] =
    true;


  /* ==========================================================
     SERVICE DEFINITIONS
  ========================================================== */

  const SERVICES = Object.freeze({

    "dyve-core":
      "Dyve Core",

    "hackax":
      "HackaX Intelligence",

    "dyve-tech":
      "Dyve Tech",

    "article-delivery":
      "Article Delivery",

    "media-delivery":
      "Media Delivery",

    "publishing":
      "Publishing System"

  });


  /*
   * Legacy names are retained because older pages may explicitly
   * define DYVE_STATUS_SERVICE using the display name.
   */
  const SERVICE_NAME_TO_ID = Object.freeze({

    "Dyve Core":
      "dyve-core",

    "HackaX":
      "hackax",

    "HackaX Intelligence":
      "hackax",

    "Dyve Tech":
      "dyve-tech",

    "Article Delivery":
      "article-delivery",

    "Articles":
      "article-delivery",

    "Media Delivery":
      "media-delivery",

    "Media":
      "media-delivery",

    "Publishing System":
      "publishing",

    "Publishing":
      "publishing"

  });


  /* ==========================================================
     SERVICE IDENTIFICATION
  ========================================================== */

  function normalizeServiceId(
    value
  ) {

    if (
      !value
    ) {

      return null;

    }


    const normalized =
      String(
        value
      )
        .trim();


    if (
      SERVICES[
        normalized
      ]
    ) {

      return normalized;

    }


    if (
      SERVICE_NAME_TO_ID[
        normalized
      ]
    ) {

      return SERVICE_NAME_TO_ID[
        normalized
      ];

    }


    const lowercase =
      normalized.toLowerCase();


    const match =
      Object.keys(
        SERVICES
      ).find(
        id =>
          id.toLowerCase() ===
          lowercase
      );


    if (
      match
    ) {

      return match;

    }


    const nameMatch =
      Object.entries(
        SERVICE_NAME_TO_ID
      ).find(
        (
          [
            name
          ]
        ) =>
          name.toLowerCase() ===
          lowercase
      );


    return (
      nameMatch?.[1] ||
      null
    );

  }


  function inferServiceId(
    pathname
  ) {

    const path =
      String(
        pathname ||
        "/"
      )
        .replace(
          /\/+/g,
          "/"
        )
        .replace(
          /\/+$/,
          ""
        ) ||
        "/";


    /*
     * Explicit HackaX routes.
     */
    if (
      path === "/hackax" ||
      path.startsWith(
        "/hackax/"
      )
    ) {

      return "hackax";

    }


    /*
     * Technology editorial property.
     */
    if (
      path === "/tech" ||
      path.startsWith(
        "/tech/"
      )
    ) {

      return "dyve-tech";

    }


    /*
     * Article delivery.
     */
    if (
      path === "/article" ||
      path.startsWith(
        "/article/"
      )
    ) {

      return "article-delivery";

    }


    /*
     * Media/CDN is normally identified explicitly on pages
     * that need it. Do not infer media delivery from ordinary
     * image URLs because images are frequently embedded by
     * other services.
     */


    /*
     * Publishing pages can explicitly set:
     *
     * window.DYVE_STATUS_SERVICE = "publishing"
     *
     * rather than relying on URL inference.
     */


    /*
     * Preserve the existing behaviour of the current system:
     *
     * Root Dyve pages are treated as HackaX unless explicitly
     * overridden.
     */
    if (
      path === "/" ||
      path === "/index.html"
    ) {

      return "hackax";

    }


    return "dyve-core";

  }


  const configuredService =
    normalizeServiceId(
      window.DYVE_STATUS_SERVICE
    );


  const serviceId =
    configuredService ||
    inferServiceId(
      window.location.pathname
    );


  const serviceName =
    SERVICES[
      serviceId
    ] ||
    "Dyve Core";


  /* ==========================================================
     CLIENT STATE
  ========================================================== */

  let currentStatus =
    "unknown";


  let currentData =
    null;


  let refreshTimer =
    null;


  let heartbeatTimer =
    null;


  let retryTimer =
    null;


  let retryAttempt =
    0;


  let requestController =
    null;


  let initialized =
    false;


  let heartbeatInFlight =
    false;


  let statusRequestInFlight =
    false;


  let lastSuccessfulStatusFetch =
    0;


  let lastHeartbeat =
    0;


  let dynamicRefreshInterval =
    DEFAULT_REFRESH_INTERVAL;


  /* ==========================================================
     UTILITY
  ========================================================== */

  function clamp(
    value,
    minimum,
    maximum
  ) {

    return Math.min(
      maximum,
      Math.max(
        minimum,
        value
      )
    );

  }


  function normalizeRefreshInterval(
    value
  ) {

    const number =
      Number(
        value
      );


    if (
      !Number.isFinite(
        number
      ) ||
      number <= 0
    ) {

      return DEFAULT_REFRESH_INTERVAL;

    }


    return clamp(
      number,
      MIN_REFRESH_INTERVAL,
      MAX_REFRESH_INTERVAL
    );

  }


  function isPageVisible() {

    return (
      document.visibilityState ===
      "visible"
    );

  }


  function clearTimer(
    timer
  ) {

    if (
      timer
    ) {

      clearTimeout(
        timer
      );

    }

  }


  function clearTimers() {

    clearTimeout(
      refreshTimer
    );

    clearTimeout(
      heartbeatTimer
    );

    clearTimeout(
      retryTimer
    );


    refreshTimer =
      null;

    heartbeatTimer =
      null;

    retryTimer =
      null;

  }


  /* ==========================================================
     STATUS ELEMENT HELPERS
  ========================================================== */

  function getStatusContainers() {

    return document.querySelectorAll(
      ".dyve-system-status"
    );

  }


  function getStatusLabel(
    status
  ) {

    switch (
      status
    ) {

      case "operational":

        return {
          text:
            "All systems operational",

          className:
            "operational"
        };


      case "degraded":

        return {
          text:
            "Systems partially degraded",

          className:
            "degraded"
        };


      case "major_outage":

        return {
          text:
            "Service disruption detected",

          className:
            "major-outage"
        };


      case "partial":

        return {
          text:
            "Some systems are still checking",

          className:
            "checking"
        };


      case "unknown":

        return {
          text:
            "Status checking",

          className:
            "checking"
        };


      default:

        return {
          text:
            "Status checking",

          className:
            "checking"
        };

    }

  }


  /* ==========================================================
     OVERALL STATUS UI
  ========================================================== */

  function updateStatusUI(
    data
  ) {

    const containers =
      getStatusContainers();


    if (
      !containers.length
    ) {

      return;

    }


    const status =
      data?.overallStatus ||
      "unknown";


    const presentation =
      getStatusLabel(
        status
      );


    containers.forEach(
      container => {

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


        const textElement =
          container.querySelector(
            "[data-dyve-status-text]"
          );


        if (
          textElement
        ) {

          textElement.textContent =
            presentation.text;

        }


        /*
         * Optional metadata elements.
         */

        const uptimeElement =
          container.querySelector(
            "[data-dyve-status-uptime]"
          );


        if (
          uptimeElement
        ) {

          const uptime =
            data?.metrics?.uptime;


          uptimeElement.textContent =
            Number.isFinite(
              uptime
            )
              ? `${uptime.toFixed(2)}%`
              : "—";

        }


        const latencyElement =
          container.querySelector(
            "[data-dyve-status-latency]"
          );


        if (
          latencyElement
        ) {

          const latency =
            data?.metrics?.latency;


          latencyElement.textContent =
            Number.isFinite(
              latency
            )
              ? `${Math.round(
                  latency
                )}ms`
              : "—";

        }


        const incidentElement =
          container.querySelector(
            "[data-dyve-status-incidents]"
          );


        if (
          incidentElement
        ) {

          const incidents =
            Number(
              data?.metrics?.incidents ||
              0
            );


          incidentElement.textContent =
            String(
              incidents
            );

        }


        const checkedElement =
          container.querySelector(
            "[data-dyve-status-checked]"
          );


        if (
          checkedElement
        ) {

          const monitoredAt =
            data?.monitoredAt ||
            data?.cycle?.completedAt;


          checkedElement.textContent =
            monitoredAt
              ? formatRelativeTime(
                  monitoredAt
                )
              : "Checking";

        }

      }
    );

  }


  /* ==========================================================
     SERVICE-SPECIFIC UI
  ========================================================== */

  function findServiceData(
    data
  ) {

    if (
      !Array.isArray(
        data?.services
      )
    ) {

      return null;

    }


    return (
      data.services.find(
        service =>
          service.id ===
          serviceId
      ) ||
      data.services.find(
        service =>
          normalizeServiceId(
            service.name
          ) ===
          serviceId
      ) ||
      null
    );

  }


  function updateServiceUI(
    data
  ) {

    const currentService =
      findServiceData(
        data
      );


    /*
     * If the page does not expose service-specific elements,
     * there is nothing to update.
     */
    const serviceContainers =
      document.querySelectorAll(
        "[data-dyve-service-status]"
      );


    if (
      !serviceContainers.length
    ) {

      return;

    }


    serviceContainers.forEach(
      container => {

        const targetId =
          normalizeServiceId(
            container.dataset
              .dyveServiceStatus
          );


        if (
          targetId !==
          serviceId
        ) {

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
          status ===
          "major_outage"
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


        if (
          textElement
        ) {

          textElement.textContent =
            formatServiceStatus(
              status
            );

        }


        const uptimeElement =
          container.querySelector(
            "[data-dyve-service-uptime]"
          );


        if (
          uptimeElement
        ) {

          uptimeElement.textContent =
            Number.isFinite(
              currentService?.uptime
            )
              ? `${currentService.uptime.toFixed(
                  2
                )}%`
              : "—";

        }


        const latencyElement =
          container.querySelector(
            "[data-dyve-service-latency]"
          );


        if (
          latencyElement
        ) {

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


        if (
          checkedElement
        ) {

          checkedElement.textContent =
            currentService?.lastChecked
              ? formatRelativeTime(
                  currentService.lastChecked
                )
              : "Checking";

        }

      }
    );

  }


  function formatServiceStatus(
    status
  ) {

    switch (
      status
    ) {

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


  /* ==========================================================
     RELATIVE TIME
  ========================================================== */

  function formatRelativeTime(
    timestamp
  ) {

    if (
      !timestamp
    ) {

      return "Unknown";

    }


    const parsed =
      Date.parse(
        timestamp
      );


    if (
      !Number.isFinite(
        parsed
      )
    ) {

      return "Unknown";

    }


    const difference =
      Math.max(
        0,
        Date.now() -
        parsed
      );


    const seconds =
      Math.floor(
        difference /
        1000
      );


    if (
      seconds < 5
    ) {

      return "Just now";

    }


    if (
      seconds < 60
    ) {

      return `${seconds}s ago`;

    }


    const minutes =
      Math.floor(
        seconds /
        60
      );


    if (
      minutes < 60
    ) {

      return `${minutes}m ago`;

    }


    const hours =
      Math.floor(
        minutes /
        60
      );


    if (
      hours < 24
    ) {

      return `${hours}h ago`;

    }


    const days =
      Math.floor(
        hours /
        24
      );


    return `${days}d ago`;

  }


  /* ==========================================================
     DATA ATTRIBUTES
  ========================================================== */

  function updateDocumentMetadata(
    data
  ) {

    const overallStatus =
      data?.overallStatus ||
      "unknown";


    document.documentElement.dataset.dyveStatus =
      overallStatus;


    document.documentElement.dataset.dyveService =
      serviceId;


    document.documentElement.dataset.dyveMonitor =
      data?.monitor?.state ||
      "unknown";


    document.documentElement.dataset.dyveMonitorStale =
      data?.cycle?.stale
        ? "true"
        : "false";


    const currentService =
      findServiceData(
        data
      );


    if (
      currentService
    ) {

      document.documentElement.dataset.dyveServiceStatus =
        currentService.status ||
        "unknown";


      if (
        Number.isFinite(
          currentService.uptime
        )
      ) {

        document.documentElement.dataset.dyveServiceUptime =
          String(
            currentService.uptime
          );

      }

    }

  }


  /* ==========================================================
     STATUS EVENT
  ========================================================== */

  function emitStatusEvent(
    data
  ) {

    currentData =
      data;


    currentStatus =
      data?.overallStatus ||
      "unknown";


    const detail = {

      data,

      overallStatus:
        currentStatus,

      serviceId,

      serviceName,

      service:
        findServiceData(
          data
        ),

      timestamp:
        Date.now()

    };


    try {

      window.dispatchEvent(
        new CustomEvent(
          "dyve:status",
          {
            detail
          }
        )
      );

    }

    catch {
      /*
       * Older browser environments may not support
       * CustomEvent construction in unusual contexts.
       */
    }

  }


  /* ==========================================================
     STATUS UI ERROR STATE
  ========================================================== */

  function updateTemporaryUnavailableUI() {

    getStatusContainers()
      .forEach(
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


          if (
            textElement
          ) {

            textElement.textContent =
              "Status temporarily unavailable";

          }

        }
      );

  }


  /* ==========================================================
     STATUS API REQUEST
  ========================================================== */

  async function fetchStatus() {

    /*
     * Prevent multiple simultaneous status requests.
     */
    if (
      statusRequestInFlight
    ) {

      return null;

    }


    statusRequestInFlight =
      true;


    /*
     * Cancel an older request if one somehow remains active.
     */
    if (
      requestController
    ) {

      try {

        requestController.abort();

      }

      catch {
        /* Ignore abort errors. */

      }

    }


    requestController =
      new AbortController();


    const timeout =
      setTimeout(
        () => {

          try {

            requestController.abort();

          }

          catch {
            /* Ignore abort errors. */

          }

        },
        API_TIMEOUT
      );


    try {

      const response =
        await fetch(
          `${API}/status?t=${Date.now()}`,
          {

            method:
              "GET",

            cache:
              "no-store",

            credentials:
              "omit",

            headers:
              {

                "Accept":
                  "application/json",

                "Cache-Control":
                  "no-cache",

                "Pragma":
                  "no-cache"

              },

            signal:
              requestController.signal

          }
        );


      if (
        !response.ok
      ) {

        throw new Error(
          `Status API returned ${response.status}`
        );

      }


      const data =
        await response.json();


      if (
        !data ||
        typeof data !==
          "object"
      ) {

        throw new Error(
          "Status API returned invalid data"
        );

      }


      /*
       * The server tells the client how frequently the public
       * status document should be refreshed.
       */
      const serverRefresh =
        data?.refresh?.intervalMs;


      if (
        Number.isFinite(
          Number(
            serverRefresh
          )
        )
      ) {

        dynamicRefreshInterval =
          normalizeRefreshInterval(
            Number(
              serverRefresh
            )
          );

      }


      retryAttempt =
        0;


      lastSuccessfulStatusFetch =
        Date.now();


      updateStatusUI(
        data
      );


      updateServiceUI(
        data
      );


      updateDocumentMetadata(
        data
      );


      emitStatusEvent(
        data
      );


      return data;

    }

    catch (error) {

      /*
       * Abort errors are expected when the page changes state
       * or a request times out. They are not platform outages.
       */
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

    }

    finally {

      clearTimeout(
        timeout
      );


      statusRequestInFlight =
        false;

      requestController =
        null;

    }

  }


  /* ==========================================================
     RETRY STRATEGY
  ========================================================== */

  function scheduleRetry() {

    if (
      retryTimer ||
      !isPageVisible()
    ) {

      return;

    }


    retryAttempt +=
      1;


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

          retryTimer =
            null;


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


  /* ==========================================================
     REFRESH SCHEDULING
  ========================================================== */

  function scheduleRefresh() {

    clearTimeout(
      refreshTimer
    );


    refreshTimer =
      null;


    if (
      !isPageVisible()
    ) {

      return;

    }


    refreshTimer =
      setTimeout(
        async () => {

          refreshTimer =
            null;


          await loadStatus();


          /*
           * Continue polling regardless of the result.
           *
           * If the request failed, loadStatus() has already
           * established its own retry path.
           */
          if (
            !retryTimer
          ) {

            scheduleRefresh();

          }

        },
        dynamicRefreshInterval
      );

  }


  /* ==========================================================
     LOAD STATUS
  ========================================================== */

  async function loadStatus() {

    if (
      !isPageVisible()
    ) {

      return null;

    }


    /*
     * Browser offline state is not evidence that Dyve itself
     * is down.
     */
    if (
      navigator.onLine ===
      false
    ) {

      updateTemporaryUnavailableUI();

      return null;

    }


    const data =
      await fetchStatus();


    if (
      data
    ) {

      scheduleRefresh();

    }


    return data;

  }


  /* ==========================================================
     HEARTBEAT
  ========================================================== */

  async function sendHeartbeat(
    options = {}
  ) {

    if (
      heartbeatInFlight
    ) {

      return;

    }


    /*
     * Heartbeats are useful only when the page is actually
     * visible, except for the explicit pagehide/final case.
     */
    if (
      !options.force &&
      !isPageVisible()
    ) {

      return;

    }


    if (
      navigator.onLine ===
      false
    ) {

      return;

    }


    heartbeatInFlight =
      true;


    const payload = {

      serviceId:
        serviceId,

      service:
        serviceName,

      path:
        window.location.pathname,

      timestamp:
        new Date().toISOString(),

      visibility:
        document.visibilityState,

      online:
        navigator.onLine !==
        false,

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

            method:
              "POST",

            headers:
              {

                "Content-Type":
                  "application/json",

                "Accept":
                  "application/json"

              },

            body:
              JSON.stringify(
                payload
              ),

            keepalive:
              true,

            credentials:
              "omit",

            cache:
              "no-store"

          }
        );


      if (
        response.ok
      ) {

        lastHeartbeat =
          Date.now();

      }

    }

    catch {
      /*
       * Heartbeats are deliberately best-effort.
       *
       * Failure to send a heartbeat must never make the
       * website claim that its service is down.
       */
    }

    finally {

      heartbeatInFlight =
        false;

    }

  }


  /* ==========================================================
     HEARTBEAT SCHEDULER
  ========================================================== */

  function scheduleHeartbeat() {

    clearTimeout(
      heartbeatTimer
    );


    heartbeatTimer =
      setTimeout(
        async () => {

          heartbeatTimer =
            null;


          await sendHeartbeat();


          scheduleHeartbeat();

        },
        HEARTBEAT_INTERVAL
      );

  }


  /* ==========================================================
     PAGE VISIBILITY
  ========================================================== */

  function handleVisibilityChange() {

    if (
      document.visibilityState ===
      "hidden"
    ) {

      /*
       * Do not keep making public API requests while the user
       * is not looking at the page.
       */
      clearTimeout(
        refreshTimer
      );


      clearTimeout(
        retryTimer
      );


      refreshTimer =
        null;

      retryTimer =
        null;


      return;

    }


    /*
     * Immediately refresh when the user returns.
     */
    loadStatus();


    /*
     * Also send a fresh application heartbeat.
     */
    sendHeartbeat();


    scheduleRefresh();

  }


  /* ==========================================================
     ONLINE / OFFLINE
  ========================================================== */

  function handleOnline() {

    retryAttempt =
      0;


    loadStatus();


    sendHeartbeat();


    scheduleRefresh();

  }


  function handleOffline() {

    /*
     * Do not tell users "Dyve is down".
     *
     * Their browser/network being offline is not evidence
     * about the platform.
     */
    updateTemporaryUnavailableUI();


    clearTimeout(
      refreshTimer
    );


    clearTimeout(
      retryTimer
    );


    refreshTimer =
      null;

    retryTimer =
      null;

  }


  /* ==========================================================
     PAGE EXIT
  ========================================================== */

  function handlePageHide() {

    /*
     * This is intentionally best-effort.
     *
     * The server does not use this heartbeat as authoritative
     * health information.
     */
    sendHeartbeat({
      force:
        true
    });

  }


  /* ==========================================================
     PUBLIC CLIENT API
  ========================================================== */

  function exposeClientAPI() {

    window.DyveStatus =
      {

        serviceId,

        serviceName,

        getStatus:
          () =>
            currentStatus,

        getData:
          () =>
            currentData,

        refresh:
          () =>
            loadStatus(),

        heartbeat:
          () =>
            sendHeartbeat(),

        isMonitoringFresh:
          () =>
            Boolean(
              currentData &&
              currentData.cycle &&
              currentData.cycle.stale ===
                false
            )

      };

  }


  /* ==========================================================
     INITIALIZATION
  ========================================================== */

  async function init() {

    if (
      initialized
    ) {

      return;

    }


    initialized =
      true;


    /*
     * Expose the resolved service information immediately.
     */
    exposeClientAPI();


    /*
     * Mark the document with service information even before
     * the first API response arrives.
     */
    document.documentElement.dataset.dyveService =
      serviceId;


    document.documentElement.dataset.dyveServiceName =
      serviceName;


    /*
     * Start application heartbeat.
     */
    sendHeartbeat();


    /*
     * Start authoritative status retrieval.
     */
    await loadStatus();


    /*
     * Continue application heartbeats independently from
     * public status polling.
     */
    scheduleHeartbeat();

  }


  /* ==========================================================
     EVENT LISTENERS
  ========================================================== */

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


  /*
   * beforeunload is intentionally not used as the primary
   * mechanism because modern browsers may terminate async
   * work aggressively during unload.
   */


  /* ==========================================================
     START
  ========================================================== */

  if (
    document.readyState ===
    "loading"
  ) {

    document.addEventListener(
      "DOMContentLoaded",
      init,
      {
        once:
          true
      }
    );

  }

  else {

    init();

  }

})();
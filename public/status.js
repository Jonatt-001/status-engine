(() => {

  const API =
    "https://status.dyve.online/api";


  /*
   * ----------------------------------------------------------
   * SERVICE IDENTIFICATION
   * ----------------------------------------------------------
   */

  const service =
    window.DYVE_STATUS_SERVICE ||
    inferService(
      window.location.pathname
    );


  function inferService(pathname) {

    const path =
      pathname.replace(/\/+$/, "") || "/";


    if (
      path === "/tech" ||
      path.startsWith("/tech/")
    ) {

      return "Dyve Tech";

    }


    if (
      path.startsWith("/article/")
    ) {

      return "Article Delivery";

    }


    if (
      path.startsWith("/hackax/")
    ) {

      return "HackaX Intelligence";

    }


    if (
      path === "/" ||
      path === "/index.html"
    ) {

      return "HackaX Intelligence";

    }


    return "Dyve Core";

  }


  /*
   * ----------------------------------------------------------
   * HEARTBEAT
   *
   * This is NOT authoritative for service health.
   * The independent monitor remains authoritative.
   * ----------------------------------------------------------
   */

  function heartbeat() {

    const payload = {

      service,

      path:
        window.location.pathname,

      timestamp:
        new Date().toISOString()

    };


    fetch(
      `${API}/heartbeat`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify(payload),

        keepalive: true,

        credentials: "omit"

      }
    )
    .catch(() => {});

  }


  /*
   * ----------------------------------------------------------
   * STATUS UI
   * ----------------------------------------------------------
   */

  function updateStatusUI(data) {

    const containers =
      document.querySelectorAll(
        ".dyve-system-status"
      );


    if (!containers.length) {
      return;
    }


    const status =
      data?.overallStatus ||
      "unknown";


    let text =
      "Status checking";


    let className =
      "checking";


    /*
     * OPERATIONAL
     */

    if (
      status === "operational"
    ) {

      text =
        "All systems operational";

      className =
        "operational";

    }


    /*
     * DEGRADED
     */

    else if (
      status === "degraded"
    ) {

      text =
        "Systems partially degraded";

      className =
        "degraded";

    }


    /*
     * MAJOR OUTAGE
     */

    else if (
      status === "major_outage"
    ) {

      text =
        "Service disruption detected";

      className =
        "major-outage";

    }


    /*
     * UNKNOWN
     */

    else {

      text =
        "Status checking";

      className =
        "checking";

    }


    containers.forEach(
      container => {

        container.classList.remove(
          "operational",
          "degraded",
          "major-outage",
          "checking"
        );


        container.classList.add(
          className
        );


        const textElement =
          container.querySelector(
            "[data-dyve-status-text]"
          );


        if (textElement) {

          textElement.textContent =
            text;

        }

      }
    );

  }


  /*
   * ----------------------------------------------------------
   * STATUS API
   * ----------------------------------------------------------
   */

  async function loadStatus() {

    try {

      const response =
        await fetch(
          `${API}/status?t=${Date.now()}`,
          {
            cache: "no-store",
            credentials: "omit"
          }
        );


      if (!response.ok) {
        throw new Error(
          `Status API returned ${response.status}`
        );
      }


      const data =
        await response.json();


      updateStatusUI(data);


    }

    catch (error) {

      /*
       * Never claim the platform is down
       * merely because the status UI cannot
       * reach its own API.
       */

      document
        .querySelectorAll(
          ".dyve-system-status"
        )
        .forEach(
          container => {

            container.classList.remove(
              "operational",
              "degraded",
              "major-outage"
            );

            container.classList.add(
              "checking"
            );


            const text =
              container.querySelector(
                "[data-dyve-status-text]"
              );


            if (text) {

              text.textContent =
                "Status temporarily unavailable";

            }

          }
        );


      console.error(
        "Dyve Status:",
        error
      );

    }

  }


  /*
   * ----------------------------------------------------------
   * INITIALIZE
   * ----------------------------------------------------------
   */

  function init() {

    heartbeat();

    loadStatus();


    /*
     * Refresh the displayed status periodically.
     *
     * This does NOT create a monitoring check.
     * The server-side engine remains responsible
     * for actual monitoring.
     */

    setInterval(
      loadStatus,
      60 * 1000
    );

  }


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

  }

  else {

    init();

  }

})();
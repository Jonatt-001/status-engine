(() => {
  "use strict";

  const STATUS_API = "/api/status";

  const statusCopy = {
    operational: {
      title: "All systems operational",
      description: "Dyve services are operating normally.",
      className: "operational"
    },
    degraded: {
      title: "Some systems are degraded",
      description:
        "One or more services are experiencing reduced availability.",
      className: "warning"
    },
    partial: {
      title: "Some systems are still checking",
      description:
        "The monitor has verified part of the platform while other services remain unverified.",
      className: "warning"
    },
    major_outage: {
      title: "A service disruption is active",
      description:
        "One or more Dyve services are currently unavailable.",
      className: "danger"
    },
    unknown: {
      title: "Status verification delayed",
      description:
        "The independent monitoring engine has not completed a fresh monitoring cycle recently enough to verify current health.",
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

    if (Number.isNaN(date.getTime())) {
      return "—";
    }

    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(date);
  }

  function formatRelative(value) {
    if (!value) return "never";

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
      operational: "Operational",
      degraded: "Degraded",
      partial: "Partially verified",
      major_outage: "Major outage",
      unknown: "Verification delayed"
    }[status] || "Unknown";
  }

  function uptimeLabel(value) {
    if (
      value === null ||
      value === undefined
    ) {
      return "—";
    }

    return `${Number(value).toFixed(2)}%`;
  }

  function renderServices(services) {
    const container =
      document.getElementById(
        "services"
      );

    if (!container) return;

    container.innerHTML =
      services
        .map(
          service => `
            <article class="service">
              <span class="service-dot ${escapeHtml(
                service.status
              )}"></span>

              <div>
                <div class="service-name">${escapeHtml(
                  service.name
                )}</div>

                <div class="service-description">${escapeHtml(
                  service.description
                )}</div>
              </div>

              <div class="service-right">
                <div class="service-status ${escapeHtml(
                  service.status
                )}">
                  ${escapeHtml(
                    statusLabel(service.status)
                  )}
                </div>

                <div class="service-metrics">
                  ${
                    service.responseTime !==
                    null
                      ? `${escapeHtml(
                          service.responseTime
                        )}ms`
                      : "Response —"
                  }
                  · checked
                  ${escapeHtml(
                    formatRelative(
                      service.lastChecked
                    )
                  )}
                </div>
              </div>
            </article>
          `
        )
        .join("");
  }

  function renderUptime(services) {
    const container =
      document.getElementById(
        "uptimeGrid"
      );

    if (!container) return;

    container.innerHTML =
      services
        .map(
          service => `
            <article class="uptime-card">
              <div class="uptime-label">
                ${escapeHtml(
                  service.shortName
                )}
              </div>

              <div class="uptime-value">
                ${escapeHtml(
                  uptimeLabel(
                    service.uptime
                  )
                )}
              </div>

              <div class="uptime-note">
                Measured from real checks
              </div>
            </article>
          `
        )
        .join("");
  }

  function renderIncidents(incidents) {
    const panel =
      document.getElementById(
        "incidentPanel"
      );

    const list =
      document.getElementById(
        "incidents"
      );

    const count =
      document.getElementById(
        "incidentCount"
      );

    if (!panel || !list || !count) {
      return;
    }

    count.textContent =
      String(incidents.length);

    if (!incidents.length) {
      panel.classList.add("hidden");
      list.innerHTML = "";
      return;
    }

    panel.classList.remove("hidden");

    list.innerHTML =
      incidents
        .map(
          incident => `
            <article class="incident-card">
              <div class="incident-title">
                ${escapeHtml(
                  incident.title
                )}
              </div>

              <div class="incident-detail">
                ${escapeHtml(
                  incident.details ||
                    "Health checks are failing."
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
        )
        .join("");
  }

  function renderHistory(incidents) {
    const container =
      document.getElementById(
        "incidentHistory"
      );

    if (!container) return;

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
        .slice(0, 10);

    if (!history.length) {
      container.innerHTML = `
        <div class="history-empty">
          No resolved incidents have been recorded by this monitor yet.
        </div>
      `;
      return;
    }

    container.innerHTML =
      history
        .map(
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
        )
        .join("");
  }

  function renderMonitorMeta(data) {
    const monitorState =
      document.getElementById(
        "monitorState"
      );

    const monitorVersion =
      document.getElementById(
        "monitorVersion"
      );

    const monitorAge =
      document.getElementById(
        "monitorAge"
      );

    const cycleInterval =
      document.getElementById(
        "cycleInterval"
      );

    if (monitorState) {
      monitorState.textContent =
        data?.monitor?.state ===
        "online"
          ? "Online"
          : "Verification delayed";
    }

    if (monitorVersion) {
      monitorVersion.textContent =
        data?.engineVersion ||
        "—";
    }

    if (monitorAge) {
      monitorAge.textContent =
        data?.monitoredAt
          ? formatRelative(
              data.monitoredAt
            )
          : "Never";
    }

    if (cycleInterval) {
      cycleInterval.textContent =
        Number.isFinite(
          Number(
            data?.cycle?.intervalSeconds
          )
        )
          ? `${Math.round(
              Number(
                data.cycle.intervalSeconds
              )
            )}s`
          : "—";
    }
  }

  async function loadStatus() {
    const response =
      await fetch(
        `${STATUS_API}?t=${Date.now()}`,
        {
          cache: "no-store",
          credentials: "omit",
          headers: {
            Accept:
              "application/json"
          }
        }
      );

    if (!response.ok) {
      throw new Error(
        `Status API returned ${response.status}`
      );
    }

    const data =
      await response.json();

    const copy =
      statusCopy[
        data.overallStatus
      ] ||
      statusCopy.unknown;

    const overallTitle =
      document.getElementById(
        "overallTitle"
      );

    const overallDescription =
      document.getElementById(
        "overallDescription"
      );

    const lastChecked =
      document.getElementById(
        "lastChecked"
      );

    if (overallTitle) {
      overallTitle.textContent =
        copy.title;
    }

    if (overallDescription) {
      overallDescription.textContent =
        copy.description;
    }

    if (lastChecked) {
      lastChecked.textContent =
        data.monitoredAt
          ? formatTime(
              data.monitoredAt
            )
          : "Verification delayed";
    }

    const mark =
      document.getElementById(
        "overallMark"
      );

    if (mark) {
      mark.className =
        `overall-mark ${copy.className}`;
    }

    document.documentElement.dataset.dyveStatus =
      data.overallStatus ||
      "unknown";

    document.documentElement.dataset.dyveObservedStatus =
      data.observedStatus ||
      "unknown";

    document.documentElement.dataset.dyveMonitor =
      data?.monitor?.state ||
      "unknown";

    document.documentElement.dataset.dyveMonitorStale =
      data?.cycle?.stale
        ? "true"
        : "false";

    renderServices(
      data.services || []
    );

    renderUptime(
      data.services || []
    );

    renderIncidents(
      data.activeIncidents ||
        data.incidents ||
        []
    );

    renderHistory(
      data.incidents || []
    );

    renderMonitorMeta(
      data
    );

    return data;
  }

  async function refresh() {
    const button =
      document.getElementById(
        "refreshButton"
      );

    if (button) {
      button.disabled = true;
      button.textContent =
        "Checking";
    }

    try {
      await loadStatus();
    } catch (error) {
      const title =
        document.getElementById(
          "overallTitle"
        );

      const description =
        document.getElementById(
          "overallDescription"
        );

      if (title) {
        title.textContent =
          "Status temporarily unavailable";
      }

      if (description) {
        description.textContent =
          "The public status endpoint could not be reached. This does not by itself indicate a Dyve outage.";
      }

      console.error(
        "[Dyve Status Page]",
        error
      );
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent =
          "Refresh";
      }
    }
  }

  const refreshButton =
    document.getElementById(
      "refreshButton"
    );

  if (refreshButton) {
    refreshButton.addEventListener(
      "click",
      refresh
    );
  }

  let refreshTimer = null;

  async function initialLoad() {
    try {
      const data =
        await loadStatus();

      const interval =
        Number(
          data?.refresh?.intervalMs
        );

      const safeInterval =
        Number.isFinite(interval) &&
        interval >= 15000 &&
        interval <= 300000
          ? interval
          : 60000;

      clearTimeout(
        refreshTimer
      );

      refreshTimer =
        setTimeout(
          async function tick() {
            try {
              await loadStatus();
            } catch (error) {
              console.error(
                "[Dyve Status Page]",
                error
              );
            }

            refreshTimer =
              setTimeout(
                tick,
                safeInterval
              );
          },
          safeInterval
        );
    } catch (error) {
      console.error(
        "[Dyve Status Page]",
        error
      );

      refreshTimer =
        setTimeout(
          initialLoad,
          15000
        );
    }
  }

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      initialLoad,
      { once: true }
    );
  } else {
    initialLoad();
  }
})();

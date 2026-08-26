(() => {
  const API = "https://status.dyve.online/api";
  const service =
    window.DYVE_STATUS_SERVICE ||
    inferService(window.location.pathname);

  function inferService(pathname) {
    const path = pathname.replace(/\/+$/, "") || "/";

    if (path === "/tech" || path.startsWith("/tech/")) {
      return "Dyve Tech";
    }

    if (path.startsWith("/article/")) {
      return "Article Delivery";
    }

    if (path.startsWith("/hackax/")) {
      return "HackaX Intelligence";
    }

    if (path === "/" || path === "/index.html") {
      return "HackaX Intelligence";
    }

    return "Dyve Core";
  }

  function heartbeat() {
    const payload = {
      service,
      path: window.location.pathname,
      timestamp: new Date().toISOString()
    };

    fetch(`${API}/heartbeat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      keepalive: true,
      credentials: "omit"
    }).catch(() => {});
  }

  function createBadge() {
    const mount = document.querySelector("[data-dyve-status-badge]");

    if (!mount) return;

    mount.innerHTML = `
      <a href="https://status.dyve.online/" target="_blank" rel="noopener noreferrer"
         style="display:inline-flex;align-items:center;gap:8px;color:inherit;text-decoration:none;font:500 11px/1.2 Inter,system-ui,sans-serif;">
        <span data-dyve-status-dot style="width:7px;height:7px;border-radius:50%;background:#7a8881;display:inline-block;"></span>
        <span data-dyve-status-text>Checking system status</span>
      </a>
    `;

    fetch(`${API}/status`, {
      cache: "no-store",
      credentials: "omit"
    })
      .then(response => response.json())
      .then(data => {
        const dot = mount.querySelector("[data-dyve-status-dot]");
        const text = mount.querySelector("[data-dyve-status-text]");

        if (!dot || !text) return;

        if (data.overallStatus === "operational") {
          dot.style.background = "#00f5a0";
          dot.style.boxShadow = "0 0 10px rgba(0,245,160,.65)";
          text.textContent = "All systems operational";
        } else if (data.overallStatus === "degraded") {
          dot.style.background = "#f3c969";
          dot.style.boxShadow = "0 0 10px rgba(243,201,105,.5)";
          text.textContent = "Systems degraded";
        } else if (data.overallStatus === "major_outage") {
          dot.style.background = "#ff6262";
          dot.style.boxShadow = "0 0 10px rgba(255,98,98,.5)";
          text.textContent = "Service disruption";
        } else {
          dot.style.background = "#7a8881";
          dot.style.boxShadow = "none";
          text.textContent = "Status checking";
        }
      })
      .catch(() => {});
  }

  heartbeat();
  createBadge();
})();

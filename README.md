# Dyve Status Engine

A small independent Node.js status system for `status.dyve.online`.

It is intentionally independent from the main Dyve frontend. It performs real HTTP/content checks, records measured results to a local JSON datastore, creates/resolves incidents after consecutive failures/successes, calculates uptime from recorded checks, and exposes a public JSON API consumed by the status page.

## Services monitored

The default configuration monitors:

- Dyve Core: `https://dyve.online/`
- HackaX Intelligence: `https://dyve.online/index.html`
- Dyve Tech: `https://dyve.online/tech/index.html`
- Article Delivery: a representative published article
- Media Delivery: a real Cloudinary asset
- Publishing System: validates both `articles.json` and `tech-articles.json`

Publishing System is not a fake homepage check. It validates that both editorial feed files are reachable and valid JSON with an article collection.

## Important uptime rule

The engine never invents `99.99%` or another uptime number.

Uptime is calculated only from checks actually recorded by this engine. Before enough checks exist, the public page displays `—`.

## Incident rule

A single failed request does not create a public outage.

Default behavior:

- 1 consecutive failure: record failure only
- 2 consecutive failures: record failure only
- 3 consecutive failures: open incident
- 3 consecutive successful checks after an incident: resolve incident

This prevents a transient network failure from creating a false public outage.

## Requirements

- Node.js 20+
- A host with persistent writable storage
- A process that remains running
- A subdomain such as `status.dyve.online`

A persistent disk is important because `data/state.json` contains the monitoring history and incident state.

## Run

```bash
npm start
```

The server listens on port 3000 by default.

## First health check

Open:

```text
http://localhost:3000/api/status
```

The response is the source used by the public status page.

## Public endpoints

```text
GET /api/status
GET /api/health
POST /api/heartbeat
```

`/api/health` only reports whether the status engine itself is running. It does not claim Dyve is healthy.

## Global website heartbeat

Add this once to your global Dyve layout:

```html
<script src="https://status.dyve.online/status.js" defer></script>
```

The script sends a lightweight user-reachability heartbeat when a page loads. This signal is deliberately NOT authoritative for service status; the independent monitor remains authoritative.

You can explicitly identify a page:

```html
<script>
window.DYVE_STATUS_SERVICE = "HackaX Intelligence";
</script>
<script src="https://status.dyve.online/status.js" defer></script>
```

Supported values:

- `Dyve Core`
- `HackaX Intelligence`
- `Dyve Tech`
- `Article Delivery`
- `Media Delivery`
- `Publishing System`

If no explicit service is supplied, the script attempts to infer it from the pathname.

## Status badge

The same script can render a compact status badge:

```html
<div data-dyve-status-badge></div>
<script src="https://status.dyve.online/status.js" defer></script>
```

It reads the real public `/api/status` response.

## Security

There is no admin endpoint in the public application. The engine has no public endpoint that lets a visitor set a service to "operational".

Heartbeats are informational and cannot override monitor results.

If you later add authenticated administration, keep it separate from the public status API.

## Deployment

Recommended architecture:

```text
dyve.online
    main site

status.dyve.online
    this status engine
        |
        +-- independent health checks
        +-- persistent monitoring history
        +-- incidents
        +-- public status API
        +-- public status page
```

Do not host the status engine only on the same server whose failure it is supposed to report.

## Hosting requirement

Because this version runs continuous checks every five minutes, use a host that keeps a Node process alive and provides persistent disk/storage.

If your current frontend host is serverless-only, deploy this engine separately.

# Observability — Prometheus, Grafana & Loki

> This document explains how the three observability tools integrate with the Drift Detector project, what they collect, and how to use them.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Prometheus — Metrics Collection](#1-prometheus--metrics-collection)
3. [Loki — Log Aggregation](#2-loki--log-aggregation)
4. [Promtail — Log Shipping](#3-promtail--log-shipping)
5. [Grafana — Unified Visualisation](#4-grafana--unified-visualisation)
6. [Quick Start](#quick-start)
7. [Accessing the UIs](#accessing-the-uis)
8. [Metrics Reference](#metrics-reference)
9. [Log Labels Reference](#log-labels-reference)
10. [Extending the Stack](#extending-the-stack)
11. [File Layout](#file-layout)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                       drift-net (Docker bridge)             │
│                                                             │
│  ┌──────────────┐   GET /metrics   ┌──────────────────┐    │
│  │  ai-service  │ ◄──────────────  │   Prometheus     │    │
│  │  :8001       │                  │   :9090          │    │
│  │  /metrics    │                  └────────┬─────────┘    │
│  └──────────────┘                           │               │
│                                             │ query         │
│  ┌──────────────┐  push logs  ┌──────────┐ │               │
│  │  Promtail    │ ──────────► │  Loki    │ │               │
│  │  (no port)   │             │  :3100   │─┤               │
│  └──────────────┘             └──────────┘ │               │
│   reads Docker                             │ query         │
│   container logs                           ▼               │
│  ┌──────────────┐                  ┌───────────────┐       │
│  │  dashboard   │                  │   Grafana     │       │
│  │  :3000       │                  │   :3001       │       │
│  └──────────────┘                  └───────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

All six containers run on the same `drift-net` bridge network so they can reach each other by hostname without exposing ports to the internet.

---

## 1. Prometheus — Metrics Collection

### What it is

Prometheus is a pull-based time-series database designed for operational metrics. It periodically sends HTTP GET requests to a `/metrics` endpoint on each monitored service, parses the [OpenMetrics](https://openmetrics.io/) format response, and stores the data internally.

### What it does in this project

| Role | Detail |
|---|---|
| **Scrapes** | `ai-service:8001/metrics` every 15 seconds |
| **Self-monitors** | Also scrapes `localhost:9090` (its own metrics) |
| **Stores** | 30 days of time-series data in the `prometheus_data` Docker volume |
| **Feeds** | Grafana queries it over `http://prometheus:9090` |

### How `/metrics` is exposed in the AI service

The [prometheus-fastapi-instrumentator](https://github.com/trallnag/prometheus-fastapi-instrumentator) library instruments every FastAPI route automatically. Adding two lines to `main.py` is all that's needed:

```python
from prometheus_fastapi_instrumentator import Instrumentator
Instrumentator().instrument(app).expose(app, include_in_schema=False)
```

This auto-registers the following standard metrics for **every route** (no boilerplate per endpoint):

| Metric | Type | Description |
|---|---|---|
| `http_requests_total` | Counter | Total HTTP requests, labelled by `method`, `handler`, `status` |
| `http_request_duration_seconds` | Histogram | Request latency distribution (used for percentile queries) |
| `http_request_size_bytes` | Histogram | Inbound payload size |
| `http_response_size_bytes` | Histogram | Outbound response size |

### Custom drift metrics

Three additional metrics are emitted by `run_analysis()` on every `/analyze` and `/scan` call:

| Metric | Type | Labels | Description |
|---|---|---|---|
| `drift_scan_score_current` | Gauge | — | Most recent per-scan drift score (0–1) |
| `drift_findings_total` | Counter | `severity`, `match_type` | Cumulative findings count, partitioned by severity (`critical`/`high`/`medium`/`low`) and match type (`rule`, `semantic`, `rule+semantic`) |
| `drift_scan_changes_analyzed_total` | Counter | — | Cumulative git-diff changes fed to the engine |

### Security note

`/metrics` is unauthenticated by design — Prometheus scrapes it from within the Docker network and the endpoint is not reachable from the public internet. If you expose the `ai-service` port publicly, add IP-allowlist middleware or reverse-proxy authentication in front of `/metrics`.

---

## 2. Loki — Log Aggregation

### What it is

Loki is a horizontally-scalable, highly-available log aggregation system from Grafana Labs. Unlike Elasticsearch, Loki does **not** full-text-index log content — it only indexes the metadata labels attached to each log stream. The raw log lines are stored compressed, making storage cheap. Queries use the **LogQL** language to filter and aggregate.

### What it does in this project

| Role | Detail |
|---|---|
| **Receives** | Log streams pushed by Promtail over HTTP (`/loki/api/v1/push`) |
| **Stores** | 31 days of logs in the `loki_data` Docker volume |
| **Serves** | Grafana queries it over `http://loki:3100` |

### Storage backend

Loki is configured with the **TSDB** index store and a local filesystem object store — the simplest setup for a single-node deployment. Data lives in the `loki_data` named volume under `/loki/chunks` (compressed log blocks) and `/loki/index` (TSDB index files).

### Configuration file

[`observability/loki/loki-config.yml`](observability/loki/loki-config.yml)

---

## 3. Promtail — Log Shipping

### What it is

Promtail is the official log shipping agent for Loki. It tails log files (or reads from the systemd journal / Docker API) and forwards entries to a Loki push endpoint, enriching each log line with configurable labels.

### What it does in this project

Promtail is mounted with two read-only host paths:

| Mount | Purpose |
|---|---|
| `/var/lib/docker/containers` | Reads the JSON log files Docker writes for each container |
| `/var/run/docker.sock` | Reads container metadata (name, image, Compose labels) so it can add meaningful labels |

Every log line from every container on the Docker host is collected and enriched with:

```
{
  container     = "drift-ai-service"     # or "drift-dashboard", etc.
  compose_service = "ai-service"
  compose_project = "drift-detector"
  logstream     = "stdout"               # or "stderr"
  job           = "docker"
}
```

These labels let you filter logs in Grafana by container or service without parsing the message body.

### Configuration file

[`observability/promtail/promtail-config.yml`](observability/promtail/promtail-config.yml)

> **Windows / Docker Desktop note**: Promtail needs access to `/var/lib/docker/containers` on the Docker host. With Docker Desktop on Windows (WSL2 backend) this path lives inside the WSL2 VM and Promtail accesses it correctly when the bind mount is set to that path. If you use the Hyper-V backend you may need to share the path via Docker Desktop Settings → Resources → File Sharing.

---

## 4. Grafana — Unified Visualisation

### What it is

Grafana is the industry-standard open-source dashboarding and alerting platform. It supports dozens of datasources, rich panel types (time series, stat, gauge, logs, heatmaps), and templated dashboards that can be version-controlled as JSON.

### What it does in this project

| Role | Detail |
|---|---|
| **Datasources** | Auto-provisioned Prometheus (metrics) and Loki (logs) on startup |
| **Dashboard** | Pre-built "Drift Detector — Observability" dashboard loaded from JSON |
| **Refresh** | Dashboard auto-refreshes every 15 seconds |

### Auto-provisioning

Grafana's [provisioning system](https://grafana.com/docs/grafana/latest/administration/provisioning/) reads YAML files from `/etc/grafana/provisioning/` at startup:

```
observability/grafana/
├── provisioning/
│   ├── datasources/
│   │   └── datasources.yml   ← registers Prometheus + Loki
│   └── dashboards/
│       └── dashboards.yml    ← tells Grafana to scan /var/lib/grafana/dashboards
└── dashboards/
    └── drift-detector.json   ← the dashboard definition
```

This means **you never have to click through the Grafana UI** to set up datasources or import dashboards — everything is wired up when the container starts.

### Dashboard panels

The pre-built dashboard ([`observability/grafana/dashboards/drift-detector.json`](observability/grafana/dashboards/drift-detector.json)) contains four rows of panels:

#### 🔍 Service Overview (stat cards)
| Panel | Query |
|---|---|
| AI Service Status | `up{job="drift-ai-service"}` — green=1, red=0 |
| Request Rate | `rate(http_requests_total[5m])` — requests per second |
| 5xx Error Rate | ratio of 5xx responses to total responses |
| P95 Latency | 95th-percentile request duration |
| Latest Drift Score | `drift_scan_score_current` gauge |

#### 📈 HTTP Traffic (time series)
- Request rate broken down by endpoint handler
- Latency percentiles (p50 / p95 / p99) per endpoint

#### 🎯 Drift Analysis Metrics (time series)
- Drift score over time with threshold zones (yellow ≥ 0.5, red ≥ 0.75)
- Findings stacked by severity (critical / high / medium / low)
- Findings by match type (rule / semantic / rule+semantic)
- Total changes analyzed per scan

#### 📋 Live Logs
- `ai-service` logs panel (LogQL: `{container="drift-ai-service"}`)
- `dashboard` logs panel (LogQL: `{container="drift-dashboard"}`)
- All-containers error panel (filters for lines containing ERROR / Exception)

---

## Quick Start

```bash
# 1. Make sure you are on the feat/observability branch
git checkout feat/observability

# 2. Start everything (including the observability stack)
docker compose up -d

# 3. Wait ~60 s for the ai-service model download, then verify
docker compose ps
```

All six services (`ai-service`, `dashboard`, `prometheus`, `loki`, `promtail`, `grafana`) should show `running` or `healthy`.

---

## Accessing the UIs

| Service | URL | Credentials |
|---|---|---|
| **Grafana** | http://localhost:3001 | `admin` / `admin` |
| **Prometheus** | http://localhost:9090 | — |
| **Loki (API)** | http://localhost:3100/ready | — |
| **AI Service docs** | http://localhost:8001/docs | — |
| **Dashboard** | http://localhost:3000 | (your auth) |

To open the pre-built dashboard directly:
> http://localhost:3001/d/drift-detector-obs

To verify Prometheus is scraping the AI service:
> http://localhost:9090/targets → `drift-ai-service` should show `State: UP`

---

## Metrics Reference

### Standard (auto-instrumented by prometheus-fastapi-instrumentator)

```promql
# Request rate for the /scan endpoint
rate(http_requests_total{job="drift-ai-service", handler="/scan"}[5m])

# 95th-percentile latency across all endpoints
histogram_quantile(0.95,
  sum(rate(http_request_duration_seconds_bucket{job="drift-ai-service"}[5m])) by (le)
)

# Error rate (5xx)
sum(rate(http_requests_total{job="drift-ai-service", status=~"5.."}[5m]))
  / sum(rate(http_requests_total{job="drift-ai-service"}[5m]))
```

### Custom drift metrics

```promql
# Current drift score
drift_scan_score_current

# Rate of critical findings over last 5 minutes
rate(drift_findings_total{severity="critical"}[5m])

# Total findings by match type
sum by (match_type) (drift_findings_total)

# Changes analyzed per minute
rate(drift_scan_changes_analyzed_total[1m])
```

---

## Log Labels Reference

Query logs in Grafana Explore using LogQL:

```logql
# All logs from the AI service
{container="drift-ai-service"}

# Only stderr from the dashboard
{container="drift-dashboard", logstream="stderr"}

# All containers — filter for ERROR lines
{job="docker"} |= "ERROR"

# Scan requests that contained a specific repo
{container="drift-ai-service"} |= "scan_id"

# Error rate (log-based) over time
sum(rate({job="docker"} |= "ERROR" [5m])) by (container)
```

---

## Extending the Stack

### Adding a new Prometheus metric

1. In [`ai-service/app/main.py`](ai-service/app/main.py), declare a new metric at module level:
   ```python
   from prometheus_client import Histogram
   _scan_duration = Histogram("drift_scan_duration_seconds", "Wall-clock time of run_analysis()")
   ```
2. Instrument the relevant code with `_scan_duration.time()` as a context manager.
3. The metric appears in Grafana's Prometheus datasource within 15 seconds (next scrape).

### Adding a Grafana panel

1. Open Grafana at http://localhost:3001 → navigate to the Drift Detector dashboard.
2. Click **Edit** → **Add panel**.
3. Once satisfied, click the dashboard menu → **JSON model** → copy the panel JSON.
4. Paste it into [`observability/grafana/dashboards/drift-detector.json`](observability/grafana/dashboards/drift-detector.json) inside the `panels` array.
5. Commit the JSON — the dashboard is version-controlled with the code.

### Adding alerting rules

Create `observability/prometheus/alerts.yml`:
```yaml
groups:
  - name: drift-alerts
    rules:
      - alert: HighDriftScore
        expr: drift_scan_score_current > 0.75
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Drift score is critically high ({{ $value | humanizePercentage }})"
```

Then reference it in `prometheus.yml`:
```yaml
rule_files:
  - /etc/prometheus/alerts.yml
```

And mount the file in `docker-compose.yml`:
```yaml
volumes:
  - ./observability/prometheus/alerts.yml:/etc/prometheus/alerts.yml:ro
```

---

## File Layout

```
observability/
├── prometheus/
│   └── prometheus.yml               # Scrape config — 15 s interval, ai-service target
├── loki/
│   └── loki-config.yml              # Loki server — TSDB store, 31 d retention
├── promtail/
│   └── promtail-config.yml          # Tails /var/lib/docker/containers, ships to Loki
└── grafana/
    ├── provisioning/
    │   ├── datasources/
    │   │   └── datasources.yml      # Auto-registers Prometheus + Loki datasources
    │   └── dashboards/
    │       └── dashboards.yml       # Dashboard file provider config
    └── dashboards/
        └── drift-detector.json      # Pre-built dashboard (version-controlled)
```

Modified application files:

| File | Change |
|---|---|
| [`ai-service/requirements.txt`](ai-service/requirements.txt) | Added `prometheus-fastapi-instrumentator>=6.1` |
| [`ai-service/app/main.py`](ai-service/app/main.py) | Added `Instrumentator`, 3 custom metrics, metric emission in `run_analysis()` |
| [`docker-compose.yml`](docker-compose.yml) | Added `prometheus`, `loki`, `promtail`, `grafana` services + 3 named volumes |

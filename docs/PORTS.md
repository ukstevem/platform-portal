# PSS Platform — Port & Network Registry

**This file is the single source of truth for host ports and service names.**
Never reassign a number once it has been used in production. If an app is retired, comment the line rather than reusing the port.

## Shared Docker network

All apps — monorepo-hosted **and** standalone — attach to one external network:

```
platform_net    (bridge, external, created once)
```

Create it once on any host:

```bash
docker network create platform_net
```

Every `docker-compose.*.yml` in this ecosystem declares:

```yaml
networks:
  default:
    name: platform_net
    external: true
```

**Why external:** any stack can start/stop/replace its containers without tearing down neighbours. The gateway resolves `http://<service-name>:<port>` via Docker DNS on the shared network.

## Port map

| Port | Service name       | App                 | Route           | Host     | Source tree                          |
|------|--------------------|---------------------|-----------------|----------|--------------------------------------|
| 3000 | `gateway`          | Nginx reverse proxy | `/`             | Pi (.75) | `platform-portal/docker/nginx/`      |
| 3000 | `portal`           | Landing page        | `/`             | Pi (.75) | `platform-portal/apps/portal/`       |
| 3001 | `jobcards`         | Job cards           | `/jobcards/`    | Pi (.75) | `platform-portal/apps/jobcards/`     |
| 3002 | `documents`        | Documents           | `/documents/`   | Pi (.75) | `platform-portal/apps/documents/`    |
| 3003 | `timesheets`       | Timesheets          | `/timesheets/`  | Pi (.75) | `platform-portal/apps/timesheets/`   |
| 3004 | `operations`       | Operations          | `/operations/`  | Pi (.75) | `platform-portal/apps/operations/`   |
| 3005 | `scanner`          | Scanner             | `/scanner/`     | Pi (.75) | `platform-portal/apps/scanner/`      |
| 3006 | `laserquote`       | LaserQuote          | `/laserquote/`  | Pi (.75) | `platform-portal/apps/laserquote/`   |
| 3007 | `assembly-viewer`  | Assembly Viewer     | `/assembly/`    | Pi (.75) | `platform-portal/apps/assembly-viewer/` |
| 3008 | `nesting`          | Beam Nesting UI     | `/nesting/`     | Pi (.75) | `platform-portal/apps/nesting/`      |
| 3009 | `cad-review`       | CAD Review          | `/cad-review/`  | Pi (.75) | `platform-portal/apps/cad-review/`   |
| 3010 | `matl-cert`        | Material Certs      | `/matl-cert/`   | Pi (.75) | `pss-matl-cert/app/` (standalone)    |
| 3011 | `employee-presence`| Employee Presence   | `/employee-presence/` | Pi (.75) | `pss-employee-presence/app/` (standalone) |
| 3012 | `orderbook`        | Orderbook           | `/orderbook/`   | Pi (.75) | `pss-orderbook/app/` (standalone)    |
| 3013 | `po-analysis`      | PO Analysis         | `/po-analysis/` | Pi (.75) | `pss-purchase-order-analysis/app/` (standalone) |
| 3014 | `production-card`  | Production Card     | `/production-card/` | Pi (.75) | `pss-production-card/app/` (standalone) |
| 3015 | `welding-control`  | Welding Control    | `/welding-control/` | Pi (.75) | `pss-welding-control/app/` (standalone) |
| 3016 | `nc1cad-app`       | NC1 → DXF UI        | `/nc1cad/`      | Pi (.75) | `pss-nc1cad-app/app/` (standalone, planned) |
| 3017 | `purchase-order`   | Purchase Orders     | `/purchase-order/` | Pi (.75) | `pss-purchase-order/app/` (standalone) |
| 3018 | `wiki`             | PSS Wiki (BookStack)| `/wiki/`        | Pi (.75) | `pss-data-wiki/` (standalone)        |
| 3019 | `admin-ui`         | Estate Health       | `/admin/`       | Pi (.75) | `pss-admin-ui/app/` (standalone)     |
| 3020 | *reserved*         | next standalone     | —               | —        | —                                    |

> **`wiki` has no nginx route yet.** It binds 3018 and its compose cites `/wiki/`, but
> `production.conf` has no `location /wiki/` block, so it is unreachable through the gateway.
> The registry reports this as `PORT-NO-ROUTE` (BD `PSS-Admin-4ud`) — correctly. The row is
> recorded here anyway because **the port is genuinely taken**, and an unrecorded live port is
> the more dangerous of the two problems.
>
> Keep annotations *out* of the table cells: the registry parses the Route column verbatim, so
> a marker next to `/wiki/` becomes part of the route name and the drift report starts talking
> about a route that does not exist.

> **3018 was recorded late, and that is worth remembering.** `pss-data-wiki` binds
> `"${WIKI_PORT}:80"` with `WIKI_PORT=3018`. Because the port is written as a *variable*, the
> PSS-Admin registry's compose parser — which matched literal digits only — reported the wiki
> as claiming no ports at all. PORTS.md showed 3018 as "reserved", the scanner agreed it was
> free, and it was very nearly handed to a second app. The parser now resolves `${VAR}` from
> the sibling `.env`/`.env.example` and reports anything it still cannot resolve as
> `PORT-UNRESOLVED`. **A port claim the tooling cannot see is worse than one it gets wrong.**

> **`admin-ui` is the one row where the service name and the route differ.** The route is
> `/admin/` because that is what people will type; the container is `admin-ui` because a
> container called `admin` on a network shared by every PSS service is asking for a collision.
> Routing is unaffected — the gateway reaches the 3010+ standalone apps by host IP, not by
> Docker service name.

> **3009 was an unrecorded gap, not a reservation.** The table ran 3008 -> 3010 with no
> comment, so it was impossible to tell from here whether the number was free or had been
> used and forgotten. It was claimed for `cad-review` on 2026-08-22 as the natural next
> monorepo slot, after grepping every compose/conf/env in the tree found nothing bound to it.
> **Worth confirming against a live host before deploy** - this file's own lesson is that a
> port claim the tooling cannot see is worse than one it gets wrong, and an absent row proves
> only that nobody wrote it down.

## Standalone vs monorepo — which wins?

When an app moves out of the monorepo, **keep its port and service name identical** so `production.conf` does not need to change. The only nginx edit required on extraction is swapping `http://<svc>:<port>` for `http://<host-ip>:<port>` **only if** the new app runs on a different host. On the same host + shared network, nginx does not change at all.

## External services (not in port map, for reference)

| Host IP   | Port | Purpose                                |
|-----------|------|----------------------------------------|
| 10.0.0.74 | 8001 | Nesting CP-SAT solver (Orin)           |
| 10.0.0.74 | 8016 | NC1 → DXF service (Orin)               |
| 10.0.0.74 | 8017 | PDF render service (Orin, `pss-pdf-service`) |
| 10.0.0.74 | 3000 | Doc service (Orin)                     |
| 10.0.0.75 | 80   | Doc service gateway (Pi)               |
| 10.0.0.75 | 9443 | Portainer                              |

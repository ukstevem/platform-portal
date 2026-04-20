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
| 3010 | `matl-cert`        | Material Certs      | `/matl-cert/`   | Pi (.75) | `pss-matl-cert/app/` (standalone)    |
| 3011 | *reserved*         | next standalone     | —               | —        | —                                    |

## Standalone vs monorepo — which wins?

When an app moves out of the monorepo, **keep its port and service name identical** so `production.conf` does not need to change. The only nginx edit required on extraction is swapping `http://<svc>:<port>` for `http://<host-ip>:<port>` **only if** the new app runs on a different host. On the same host + shared network, nginx does not change at all.

## External services (not in port map, for reference)

| Host IP   | Port | Purpose                                |
|-----------|------|----------------------------------------|
| 10.0.0.74 | 8001 | Nesting CP-SAT solver (Orin)           |
| 10.0.0.74 | 3000 | Doc service (Orin)                     |
| 10.0.0.75 | 80   | Doc service gateway (Pi)               |
| 10.0.0.75 | 9443 | Portainer                              |

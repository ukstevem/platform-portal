# Portainer-on-VM Deployment Guide (build from repo)

This is the **VM path**: Portainer running on a Proxmox VM clones this repo and builds images locally on the VM. No GitHub Container Registry, no cross-compile from a dev machine.

> The Raspberry Pi path is separate — see [portainer-deployment.md](portainer-deployment.md). Different host, different compose file ([docker-compose.deploy.yml](../docker-compose.deploy.yml)), different lifecycle. Do not mix.

## Architecture

- Portainer Stack uses **Repository** mode and points at this Git repo.
- Compose file: [docker-compose.vm.yml](../docker-compose.vm.yml).
- Each service has a `build:` block that targets [docker/node/Dockerfile.prod](../docker/node/Dockerfile.prod) (or [docker/nginx/Dockerfile.prod](../docker/nginx/Dockerfile.prod) for the gateway). Portainer triggers `docker compose build` on the VM.
- Images are tagged `platform-portal/<service>:vm` and live only on the VM's local Docker daemon — they are never pushed anywhere.

## Prerequisites

- Proxmox VM running Linux (amd64) with Docker Engine + Compose v2.
- Portainer CE/BE installed on the VM.
- Outbound HTTPS from the VM to `github.com` (for `git clone`) and `registry-1.docker.io` (for the `node:20-alpine` and `nginx:1.27-alpine` base layers).
- The shared Docker network exists on the VM:
  ```bash
  docker network create platform_net
  ```
- If the GitHub repo is private, a GitHub PAT with `repo` (read) scope is configured in Portainer's Git credentials.

## Stack setup

1. Open Portainer → **Stacks** → **Add stack**.
2. Name: `platform-portal`.
3. Build method: **Repository**.
4. Configure:
   - **Repository URL**: `https://github.com/ukstevem/platform-portal.git`
   - **Repository reference**: `refs/heads/main`
   - **Compose path**: `docker-compose.vm.yml`
   - **Authentication**: enable and select stored credentials if the repo is private.
   - **GitOps updates**: optional — enable polling if you want auto-redeploy on push.
5. Add environment variables (see table below). The `NEXT_PUBLIC_*` vars are baked into images at build time, so they must be set **before** the first deploy.
6. Click **Deploy the stack**. The first build takes 5–10+ minutes on a reasonably-specced VM (full pnpm install + 9 Next.js builds). Subsequent rebuilds reuse Docker layer cache and are much faster for unchanged apps.

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `GATEWAY_PORT` | yes | Host port the gateway listens on (e.g. `3000`). |
| `HOST_DOC_ROOT` | yes | Host path mounted read-only into the documents app at `/data/input`. Use `/tmp` for testing or a CIFS mount in production. |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Baked into every app at build time. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Baked into every app at build time. |
| `NEXT_PUBLIC_DOC_GATEWAY_BASE_URL` | yes | Baked in at build time. |
| `NEXT_PUBLIC_APP_URL` | yes | Baked in at build time. |
| `NEXT_PUBLIC_DOC_SERVICE_URL` | yes | Baked in at build time. |
| `NEXT_PUBLIC_LASER_QUOTE_SERVICE_URL` | yes | Baked in at build time. |
| `SUPABASE_SECRET_KEY` | yes | Service role key — runtime only, never baked into images. Used by `scanner` and `laserquote`. |
| `DOC_SERVICE_URL` | yes | Runtime URL the doc-service-aware apps call (e.g. `http://10.0.0.75:80`). |
| `LASER_QUOTE_SERVICE_URL` | optional | Defaults to `http://10.0.0.x:8090`. |
| `NESTING_SERVICE_URL` | optional | Defaults to `http://10.0.0.74:8001`. |

> Changing any `NEXT_PUBLIC_*` variable requires a rebuild, not just a restart. Use **Pull and redeploy** with **Re-build image** ticked.

## Services

| Service | Internal port | Route |
|---|---|---|
| `gateway` | 80 | `/` (published on `${GATEWAY_PORT}`) |
| `portal` | 3000 | `/` |
| `jobcards` | 3001 | `/jobcards/` |
| `documents` | 3002 | `/documents/` |
| `timesheets` | 3003 | `/timesheets/` |
| `operations` | 3004 | `/operations/` |
| `scanner` | 3005 | `/scanner/` |
| `laserquote` | 3006 | `/laserquote/` |
| `assembly-viewer` | 3007 | `/assembly/` |
| `nesting` | 3008 | `/nesting/` |

All inter-service traffic goes over the `platform_net` Docker network. Only the gateway publishes a host port.

## Updating

1. Make code changes locally and push to GitHub.
2. In Portainer: open the stack → **Pull and redeploy** → tick **Re-pull image** and **Re-build image** → **Update**.

Portainer re-clones the repo, runs `docker compose build`, then `docker compose up -d`. Unchanged apps short-circuit on the layer cache; only services touched by the diff actually rebuild.

If you enable GitOps polling, this happens automatically.

## Document share (optional)

The documents app reads files from `HOST_DOC_ROOT`. To connect a CIFS/SMB share on the VM:

```bash
sudo mkdir -p /mnt/doc_nas
sudo mount -t cifs //pss-dc02/CAD_IOT/doc_nas /mnt/doc_nas \
  -o username=USER,password=PASS
```

Set `HOST_DOC_ROOT=/mnt/doc_nas` in the stack env and redeploy.

To persist across reboots, add to `/etc/fstab`:

```
//pss-dc02/CAD_IOT/doc_nas /mnt/doc_nas cifs username=USER,password=PASS,_netdev 0 0
```

## Supabase migrations

Before first use, run these in the Supabase SQL editor (in order):

1. [`supabase/migrations/001_timesheets.sql`](../supabase/migrations/001_timesheets.sql)
2. [`supabase/migrations/002_project_item_column.sql`](../supabase/migrations/002_project_item_column.sql)
3. [`supabase/migrations/003_project_register_items_rls.sql`](../supabase/migrations/003_project_register_items_rls.sql)
4. [`supabase/migrations/004_timesheet_approvals.sql`](../supabase/migrations/004_timesheet_approvals.sql)

## Troubleshooting

- **First build fails on `pnpm install`** — check the VM has outbound HTTPS to `registry.npmjs.org`. If it goes through a proxy, configure Docker daemon proxy settings.
- **`network platform_net not found`** — run `docker network create platform_net` on the VM, then redeploy.
- **`NEXT_PUBLIC_*` value didn't change after redeploy** — these are baked at build time. Tick **Re-build image** in the redeploy dialog, not just **Re-pull image**.
- **Build runs out of memory** — Next.js builds on small VMs can OOM. Either bump VM RAM or build apps in smaller batches by temporarily commenting services out of the compose file.

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
- **Disk: at least 60 GB total, with 50+ GB free at deploy time.** A from-scratch build of all 9 apps peaks at ~20–30 GB transient (pnpm store, layered build outputs, intermediate images). 15–20 GB VMs will fail with `no space left on device` mid-build. Steady state after a successful build is ~10–15 GB.
- Portainer CE/BE installed on the VM.
- Outbound HTTPS from the VM to `github.com` (for `git clone`) and `registry-1.docker.io` (for the `node:20-alpine` and `nginx:1.27-alpine` base layers).
- The shared Docker network exists on the VM:
  ```bash
  docker network create platform_net
  ```
- If the GitHub repo is private, a GitHub PAT with `repo` (read) scope is configured in Portainer's Git credentials.

## Pre-flight checklist

Run through this before clicking **Deploy** the first time. Skipping any of these is the #1 source of "it failed" surprises.

- [ ] VM disk is **at least 60 GB** (`df -h /` shows ≥ 50 GB free).
- [ ] `docker network ls | grep platform_net` returns a row. If not: `docker network create platform_net`.
- [ ] You have values ready for **every** required env var below — both the build-time `NEXT_PUBLIC_*` set **and** the runtime set (`SUPABASE_SECRET_KEY`, `DOC_SERVICE_URL`, etc.). Missing build-time vars bake in empty strings; missing runtime vars silently break specific apps.
- [ ] `HOST_DOC_ROOT` is a **Linux path on the VM** (e.g. `/tmp` or `/mnt/doc_nas`), not a Windows path copied from your dev `.env`. Docker on the VM will reject `C:/...`.
- [ ] If the GitHub repo is private, a Portainer Git credential is configured.
- [ ] `NEXT_PUBLIC_APP_URL` is added to your Supabase project's **Authentication → URL Configuration → Redirect URLs** allowlist (use a `/**` wildcard). Without this, login redirects fail.

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

The two sets behave very differently. **Build-time** values are compiled into the JavaScript bundle and require a full image rebuild to change. **Runtime** values are read by the running container and a restart is enough.

### Build-time (baked into images — change ⇒ rebuild required)

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | |
| `NEXT_PUBLIC_DOC_GATEWAY_BASE_URL` | yes | |
| `NEXT_PUBLIC_APP_URL` | yes | Must match what's in Supabase Auth → Redirect URLs. Wrong value = login redirects to the wrong host. |
| `NEXT_PUBLIC_DOC_SERVICE_URL` | yes | |
| `NEXT_PUBLIC_LASER_QUOTE_SERVICE_URL` | yes | |

### Runtime (read by containers at startup — change ⇒ restart enough)

| Variable | Required | Notes |
|---|---|---|
| `GATEWAY_PORT` | yes | Host port the gateway listens on (e.g. `3000`). |
| `HOST_DOC_ROOT` | yes | **Linux path on the VM** mounted read-only into the documents app at `/data/input`. Use `/tmp` for testing or a CIFS mount in production. Windows paths from your dev `.env` will be rejected. |
| `SUPABASE_SECRET_KEY` | yes | Service role key. Used by `scanner` and `laserquote`. Never baked into images. |
| `DOC_SERVICE_URL` | yes | URL the doc-service-aware apps call (e.g. `http://10.0.0.75:80`). |
| `LASER_QUOTE_SERVICE_URL` | optional | Defaults to `http://10.0.0.x:8090`. |
| `NESTING_SERVICE_URL` | optional | Defaults to `http://10.0.0.74:8001`. |

> ⚠️ Changing any **build-time** variable requires a real rebuild. See "Forcing a clean rebuild" in [Updating](#updating) — Portainer's Docker layer cache will silently reuse the old build layer if the old images are still on disk.

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
2. In Portainer: open the stack → **Pull and redeploy** → tick **Re-build image** only → **Update**.

> 🚨 **Do NOT tick "Re-pull image" on the VM path.** Re-pull tells Docker to fetch images from a remote registry. The VM's images live only on the local Docker daemon (`platform-portal/<svc>:vm`), so a pull will fail with `pull access denied` for every service. Re-pull is for the Pi/ghcr path only.

Portainer re-clones the repo, runs `docker compose build`, then `docker compose up -d`. Unchanged apps short-circuit on the layer cache; only services touched by the diff actually rebuild.

If you enable GitOps polling, this happens automatically (it re-builds, doesn't re-pull).

### Forcing a clean rebuild

A normal "Re-build image" relies on the Docker layer cache, which is usually a feature but occasionally bites. The most common case: you change a `NEXT_PUBLIC_*` value but the build cache reuses the old `pnpm build` layer because the upstream layers haven't changed. The container starts but the new value never made it into the JS bundle.

When that happens, force a from-scratch rebuild:

```bash
# 1. Stop the stack from Portainer (Stacks → platform-portal → Stop)
#    OR from the CLI:
cd /var/lib/docker/volumes/portainer_data/_data/compose/<stack-id>/
sudo docker compose down

# 2. Remove the existing images so the rebuild can't short-circuit
docker images "platform-portal/*" -q | xargs docker rmi

# 3. Redeploy from Portainer with Re-build image ticked
```

Step 2 is the key one — without it, even "Re-build image" can produce identical bytes because the layer cache hits.

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

### Deploy / build failures

- **`failed to extract layer ... no space left on device`** — VM disk is too small. Default Ubuntu Server installs are often 15–20 GB; a full build needs 50+ GB free. Either grow the Proxmox virtual disk and `growpart` + `pvresize` + `lvextend` + `resize2fs` inside the VM, or check if the LVM VG already has free space (`sudo vgs`) and `lvextend -l +100%FREE` to claim it for free.
- **`unpigz: skipping: <stdin>: corrupted -- crc32 mismatch`** — BuildKit's content store has a half-extracted layer left over from a previous failed build (typically after a disk-full event). Fix:
  ```bash
  docker builder prune -af
  ```
  If that fails too, escalate to `docker system prune -af`, and last-resort `sudo systemctl stop docker && sudo rm -rf /var/lib/docker/buildkit && sudo systemctl start docker`.
- **`pull access denied for platform-portal/<svc>, repository does not exist`** — you ticked **Re-pull image** in the redeploy dialog. The VM path's images are local-only and were never pushed to a registry; there's nothing to pull. Untick Re-pull, keep only Re-build.
- **`invalid volume specification: 'C:/...'`** — `HOST_DOC_ROOT` is a Windows path copied from your dev machine's `.env`. Set it to a Linux path that exists on the VM (`/tmp` for testing, `/mnt/doc_nas` for production).
- **First build fails on `pnpm install`** — check the VM has outbound HTTPS to `registry.npmjs.org`. If it goes through a proxy, configure Docker daemon proxy settings.
- **Build runs out of memory** — Next.js builds on small VMs can OOM. Either bump VM RAM or build apps in smaller batches by temporarily commenting services out of the compose file.

### Runtime failures

- **Stack shows "successfully deployed" but Portainer's Stacks view shows zero containers** — the build phase succeeded but `docker compose up` failed silently. Most common cause is the next bullet.
- **`network platform_net declared as external, but could not be found`** — run `docker network create platform_net` on the VM, then redeploy. This network does not always survive Docker daemon restarts or VM reboots; if the stack stops working after a reboot, this is the first thing to check.
- **`Container name "/platform_portal" is already in use`** — a previous manual `docker compose up` left containers behind that conflict with the Portainer-managed stack. Run:
  ```bash
  cd ~/pp-test  # or wherever you ran the manual deploy
  docker compose -f docker-compose.vm.yml down
  ```
  Then redeploy from Portainer.

### Auth / behavior issues

- **Login redirects to the wrong host (e.g. prod IP instead of the VM IP)** — `NEXT_PUBLIC_APP_URL` was baked into the image with the wrong value. Update the env var in Portainer and follow the **Forcing a clean rebuild** recipe above. Just ticking Re-build often isn't enough; remove the old images first.
- **Supabase rejects the redirect with "Invalid redirect URL"** — the URL Supabase saw isn't on the project's Redirect URLs allowlist. Add `http://<vm-ip>:<port>/**` (matching scheme, host, and port exactly) under Authentication → URL Configuration → Redirect URLs.
- **`scanner` or `laserquote` returns 500s** — `SUPABASE_SECRET_KEY` is unset or wrong. This is a runtime var; correct it in the Portainer stack and restart the affected service (no rebuild needed).

### Reboot resilience

After a VM reboot, the containers come back automatically (`restart: unless-stopped`), but `platform_net` is sometimes missing depending on Docker version and how the daemon shut down. If the stack containers fail to start after a reboot, check:

```bash
docker network ls | grep platform_net
```

Recreate if missing. To make this survive reboots reliably, add a one-shot systemd unit on the VM:

```ini
# /etc/systemd/system/platform-net.service
[Unit]
Description=Ensure platform_net Docker network exists
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
ExecStart=/usr/bin/docker network create platform_net
ExecStartPost=/bin/true
RemainAfterExit=true

[Install]
WantedBy=multi-user.target
```

Then `sudo systemctl enable --now platform-net.service`. The `ExecStartPost=/bin/true` makes "already exists" a non-error.

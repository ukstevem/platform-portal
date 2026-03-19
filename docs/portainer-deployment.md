# Portainer Deployment Guide

## Architecture

Images are built on a dev machine (x64) and cross-compiled for ARM64, then pushed to GitHub Container Registry (ghcr.io). The Raspberry Pi only pulls pre-built images — no building on the Pi.

## Prerequisites

- Docker Desktop on your dev machine (with buildx)
- Portainer running on the Pi (`https://10.0.0.75:9443`)
- Docker DNS configured on the Pi (`/etc/docker/daemon.json`)
- GitHub account with a Personal Access Token (PAT) for container registry

## One-time Setup: GitHub Container Registry

### On your dev machine

```bash
# Log in to ghcr.io (use a GitHub PAT with write:packages scope)
docker login ghcr.io -u ukstevem
```

### On the Raspberry Pi

```bash
# Log in to ghcr.io (use a GitHub PAT with read:packages scope)
sudo docker login ghcr.io -u ukstevem
```

## Building and Pushing Images

From your dev machine, in the project root:

```bash
bash scripts/deploy.sh
```

This reads env vars from `.env`, cross-compiles all 5 images for ARM64, and pushes to `ghcr.io/ukstevem/platform-portal/*`.

## Portainer Stack Setup

1. Open Portainer → **Stacks** → **Add Stack**
2. Name: `platform-portal`
3. Select **Repository**
4. Configure:
   - **Repository URL**: `https://github.com/ukstevem/platform-portal.git`
   - **Reference**: `refs/heads/main`
   - **Compose path**: `docker-compose.deploy.yml`
5. Upload `portainer.env` via **"Load variables from .env file"**, or add manually:

| Variable | Value | Notes |
|---|---|---|
| `GATEWAY_PORT` | `3000` | Host port for nginx gateway |
| `HOST_DOC_ROOT` | `/tmp` | Host path to documents (see below) |

6. Under **Registry**, select the ghcr.io credentials
7. Click **Deploy the stack**

The Pi just pulls images — deployment takes seconds, not minutes.

## Environment Variables

The `NEXT_PUBLIC_*` vars are baked into the images at build time (on your dev machine via `.env`). The Pi only needs:

| Variable | Value | Notes |
|---|---|---|
| `GATEWAY_PORT` | `3000` | Host port for nginx gateway |
| `HOST_DOC_ROOT` | `/tmp` | Host path to documents |

## Services

| Service | Internal Port | Path |
|---|---|---|
| Portal | 3000 | `/` |
| Job Cards | 3001 | `/jobcards/` |
| Documents | 3002 | `/documents/` |
| Timesheets | 3003 | `/timesheets/` |

All traffic routes through the nginx gateway on the configured `GATEWAY_PORT`.

## Updating (deploy workflow)

1. Make code changes on your dev machine
2. Commit and push to GitHub
3. Run `bash scripts/deploy.sh` to build and push new images
4. In Portainer: open the stack → **Pull and redeploy** → tick **"Re-pull image"** → **Update**

The Pi pulls the new images and restarts containers. Takes ~30 seconds.

## Document Share (optional)

The documents app reads files from `HOST_DOC_ROOT`. To connect a network share:

```bash
# Mount the CIFS/SMB share on the server
sudo mkdir -p /mnt/doc_nas
sudo mount -t cifs //pss-dc02/CAD_IOT/doc_nas /mnt/doc_nas -o username=USER,password=PASS
```

Then update `HOST_DOC_ROOT=/mnt/doc_nas` in the stack environment variables and redeploy.

To persist across reboots, add to `/etc/fstab`:

```
//pss-dc02/CAD_IOT/doc_nas /mnt/doc_nas cifs username=USER,password=PASS,_netdev 0 0
```

## Docker DNS (Raspberry Pi)

If the Pi can't pull images or clone repos, ensure `/etc/docker/daemon.json` contains:

```json
{ "dns": ["10.0.0.2", "8.8.8.8"] }
```

Then restart Docker:

```bash
sudo systemctl restart docker
```

## Supabase Migrations

Before first use, run the following SQL files in the Supabase SQL editor (in order):

1. `supabase/migrations/001_timesheets.sql` — employees + timesheet_entries tables
2. `supabase/migrations/002_project_item_column.sql` — project_item format migration
3. `supabase/migrations/003_project_register_items_rls.sql` — RLS for project register
4. `supabase/migrations/004_timesheet_approvals.sql` — timesheet approval workflow

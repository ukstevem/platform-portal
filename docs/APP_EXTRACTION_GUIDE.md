# App Extraction Guide

Playbook for moving an app out of the `platform-portal` monorepo into its own repo, using the same pattern that `matl-cert` proved.

**Goals**
1. Cut the monorepo rebuild cascade (one app's change no longer reinstalls the workspace for every other app).
2. Allow any single app to be stopped, replaced, or rolled back without disrupting others.
3. Keep a single public entry point (`gateway` on port 3000) — users see no change.

---

## 0. Pick the right candidate

Run the timer **before** deciding:

```bash
./scripts/deploy-timed.sh
awk -F, 'NR>1{print $4, $3}' scripts/build-times.csv | sort -n -r | head -5
```

Good extraction candidates:
- Slowest to build, **and**
- Touches `packages/ui` / `packages/auth` / `packages/supabase` only lightly, **and**
- Has an independent release cadence (different stakeholders, different data).

Bad candidates: apps that share components heavily with others (portal + jobcards). Refactor those in-place.

---

## 1. Shared network (one-time, per host)

```bash
docker network create platform_net || true
```

Every compose file in the ecosystem joins this external network. See [PORTS.md](PORTS.md).

---

## 2. Extract the app

### 2a. Create the new repo

```
C:\Dev\PSS\pss-<appname>\
├─ app\                        # the Next.js app itself
│  ├─ app\                     # or pages\
│  ├─ components\
│  ├─ public\
│  ├─ package.json             # standalone — npm or pnpm, its choice
│  ├─ next.config.ts           # basePath: '/<appname>'
│  └─ Dockerfile
├─ docker-compose.app.yml      # runs just this app, joins platform_net
├─ .env.example
├─ .gitignore
└─ README.md
```

Copy the app's source from `platform-portal/apps/<appname>/` into `pss-<appname>/app/`.

### 2b. Handle shared packages

Three options, pick one per package:

1. **Copy & freeze** (fastest, simplest). Vendor the relevant bits of `packages/ui`, `packages/auth`, `packages/supabase` into the new repo at `pss-<appname>/app/packages/`. Accept that design updates will need to be synced manually. **Use this first** — optimise later if drift actually becomes painful.
2. **Publish as npm** (`@pss/ui`, `@pss/auth`, `@pss/supabase`) to GitHub Packages. Proper, but higher up-front cost.
3. **Git submodule**. Avoid — the last-mile ergonomics are bad on Windows.

### 2c. `next.config.ts`

```ts
const nextConfig = {
  basePath: '/<appname>',        // matches nginx location
  output: 'standalone',           // smaller runtime image
  reactStrictMode: true,
};
```

### 2d. `Dockerfile` (production, multi-stage)

```dockerfile
# syntax=docker/dockerfile:1.6
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev=false

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3010
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-3010}/ || exit 1
CMD ["node", "server.js"]
```

Multi-stage keeps the runtime image small (~150 MB vs ~1 GB dev image), which matters on the Pi.

### 2e. `docker-compose.app.yml`

```yaml
services:
  <appname>:
    image: ghcr.io/ukstevem/<appname>:${IMAGE_TAG:-latest}
    container_name: platform_<appname>
    restart: unless-stopped
    environment:
      - PORT=30XX
      - NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}
      - NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}
    ports:
      - "30XX:30XX"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:30XX/<appname>"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s

networks:
  default:
    name: platform_net
    external: true
```

The `ports:` line exposes the app to the host so that the gateway (on this host or another) can reach it. Internal-only services can drop this.

---

## 3. Build & push the image

### On the dev machine (ARM64 for Pi)

```bash
cd C:\Dev\PSS\pss-<appname>\app
docker buildx build \
  --platform linux/arm64 \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  -t ghcr.io/ukstevem/<appname>:$(git rev-parse --short HEAD) \
  -t ghcr.io/ukstevem/<appname>:latest \
  --push \
  .
```

**Always tag with the git sha in addition to `:latest`**. Rollback is then one line in compose:

```yaml
image: ghcr.io/ukstevem/<appname>:abc1234
```

---

## 4. Wire it up at the gateway

In `platform-portal/docker/nginx/production.conf`, add (or leave unchanged if the service name stayed the same):

```nginx
location = /<appname>   { return 301 $scheme://$http_host/<appname>/; }

location /<appname>/ {
  set $<appname>_backend http://<appname>:30XX;     # same-host, shared network
  # set $<appname>_backend http://10.0.0.75:30XX;   # alternative: different host
  proxy_pass $<appname>_backend;
  proxy_http_version 1.1;
  proxy_redirect off;
  proxy_set_header Host              $http_host;
  proxy_set_header X-Forwarded-Host  $http_host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
}
```

Rebuild & push the gateway image:

```bash
cd C:\Dev\PSS\platform-portal
docker buildx build --platform linux/arm64 \
  -f docker/nginx/Dockerfile.prod \
  -t ghcr.io/ukstevem/platform-portal/gateway:latest \
  --push docker/nginx/
```

---

## 5. Deploy on the Pi

```bash
ssh pi@10.0.0.75
cd /opt/platform-portal
git pull
docker network create platform_net || true
docker compose -f docker-compose.deploy.yml pull gateway
docker compose -f docker-compose.deploy.yml up -d gateway

cd /opt/pss-<appname>
docker compose -f docker-compose.app.yml pull
docker compose -f docker-compose.app.yml up -d
```

Run the **app compose** and the **gateway compose** independently. They are connected only by `platform_net`.

---

## 6. Remove the app from the monorepo

Only after the extracted version has run in production for 24h without incident:

1. Delete `platform-portal/apps/<appname>/`.
2. Delete the `<appname>` service block from `docker-compose.yml`, `docker-compose.deploy.yml`, `docker-compose.prod.yml`.
3. Remove `<appname>` from the loop in `scripts/deploy.sh`.
4. Commit with message `remove <appname> — now standalone at pss-<appname>`.

---

## Resilience — replacing a failed container

If an app misbehaves:

```bash
# Roll back to a previous tag (edit docker-compose.app.yml: image: ...:abc1234)
docker compose -f docker-compose.app.yml up -d

# Or: rebuild latest and redeploy
docker compose -f docker-compose.app.yml pull
docker compose -f docker-compose.app.yml up -d --force-recreate <appname>
```

Gateway is untouched. Other apps are untouched. Users of other apps see nothing.

**Never** delete the `platform_net` network as part of a fix — every service on the host is attached to it.

---

## Environment variables — the rule

- **Host-level secrets** (Supabase keys, doc service URLs) live in `.env` on the host, next to each compose file. Never commit `.env`.
- Each standalone repo ships `.env.example` with every variable it reads, even if the value is blank. A new operator must be able to fill out the example and run `docker compose up -d`.
- Build-time `NEXT_PUBLIC_*` vars must be passed as `--build-arg` when building, **not** at runtime. Next.js bakes them into the bundle.
- Runtime-only vars (server-side keys, URLs used in route handlers) go in the compose `environment:` block.

If a `NEXT_PUBLIC_*` value changes, you must rebuild — not restart — the image.

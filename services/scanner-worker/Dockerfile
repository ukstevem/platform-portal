# ─── Stage 1: Build ───
FROM node:20-alpine AS builder
RUN apk add --no-cache python3 make g++
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install
COPY tsconfig.json ./
COPY src/ ./src/
RUN pnpm build

# ─── Stage 2: Production runner ───
FROM node:20-alpine AS runner
RUN apk add --no-cache poppler-utils
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/package.json /app/pnpm-lock.yaml* ./
RUN pnpm install --prod --frozen-lockfile || pnpm install --prod
COPY --from=builder /app/dist/ ./dist/

CMD ["node", "dist/index.js"]

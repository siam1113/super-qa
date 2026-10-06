# Build context is the repo root (monorepo workspace). Build with:
#   docker build -f apps/api/Dockerfile -t qa-api .

FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
RUN npm ci

FROM deps AS builder
COPY . .
RUN npm run build -w apps/api

FROM base AS runner
ENV NODE_ENV=production
RUN addgroup -S nodejs && adduser -S nestjs -G nodejs
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
# --include-workspace-root: apps/api/package.json doesn't list every dep it
# imports — a few (e.g. @nestjs/event-emitter) are declared on the root
# package.json instead, so a workspace-scoped install alone misses them.
RUN npm ci --workspace=apps/api --include-workspace-root --omit=dev --ignore-scripts
COPY --from=builder /app/apps/api/dist apps/api/dist
COPY apps/api/scripts apps/api/scripts
USER nestjs
EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]

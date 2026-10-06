# Build context is the repo root (monorepo workspace). Build with:
#   docker build -f apps/web/Dockerfile -t qa-web .

FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm ci

FROM deps AS builder
COPY . .
# Baked into the client bundle at build time — Next.js NEXT_PUBLIC_* vars
# cannot be changed at container runtime.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_AGENTS_URL
ENV NEXT_STANDALONE=1 \
    NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_PUBLIC_AGENTS_URL=${NEXT_PUBLIC_AGENTS_URL}
RUN npm run build -w apps/web

# Next.js traces the monorepo root into .next/standalone, preserving the
# apps/web/ path and hoisting only the node_modules each app actually needs.
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static apps/web/.next/static
COPY --from=builder /app/apps/web/public apps/web/public
USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "apps/web/server.js"]

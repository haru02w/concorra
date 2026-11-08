# syntax=docker/dockerfile:1
# Targets: web (Next.js standalone), worker (pg-boss + pandoc/LaTeX), migrate (one-shot).

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# Prisma only needs a syntactically valid URL to generate the client.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build pnpm db:generate && pnpm build

FROM build AS migrate
CMD ["pnpm", "db:migrate"]

FROM base AS worker
RUN apt-get update && apt-get install -y --no-install-recommends \
      pandoc texlive-latex-recommended texlive-fonts-recommended texlive-lang-portuguese lmodern \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app /app
ENV NODE_ENV=production
CMD ["pnpm", "worker"]

FROM base AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]

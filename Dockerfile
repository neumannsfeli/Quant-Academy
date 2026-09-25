# Two images from one workspace:
#   --target web   the Next.js app (standalone output)
#   --target ops   migrations, the content seed and the jobs scheduler (TypeScript via tsx)
# The ops image needs the curriculum's built pack as a named context:
#   docker buildx build --target ops --build-context content=../Quant-Academy-Curriculum-/dist .

FROM public.ecr.aws/docker/library/node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch --frozen-lockfile

FROM base AS web-build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --offline --frozen-lockfile --filter "@qa/web..."
# Route modules construct the database client on import; nothing connects during the build.
RUN DATABASE_URL=postgres://build:build@127.0.0.1:1/build pnpm --filter @qa/web build

FROM public.ecr.aws/docker/library/node:22-bookworm-slim AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=web-build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=web-build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]

FROM base AS ops
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --offline --frozen-lockfile --filter "@qa/db..." --filter "@qa/jobs..."
COPY --from=content content.json /content/content.json
ENV NODE_ENV=production CONTENT_BUNDLE=/content/content.json
USER node
# docker run <image> migrate | seed | jobs schedule | jobs once <job> [--force]
ENTRYPOINT ["/repo/deploy/ops-entrypoint.sh"]

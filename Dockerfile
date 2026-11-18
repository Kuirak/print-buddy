# syntax=docker/dockerfile:1
# Home Assistant never builds this: the add-on config names the finished image.
# Build context is the repository root.

FROM node:26-alpine AS build
WORKDIR /app
# node:26-alpine has no corepack; keep the version equal to `packageManager` in package.json
RUN npm install -g pnpm@12.18.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build && pnpm prune --prod

FROM node:26-alpine
# Only for the labels. The server reads its version from print-buddy/config.yaml.
ARG BUILD_VERSION=dev
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/shared ./shared
COPY --from=build /app/server ./server
COPY --from=build /app/dist ./dist
COPY --from=build /app/print-buddy/config.yaml ./print-buddy/config.yaml
LABEL \
  io.hass.version="${BUILD_VERSION}" \
  io.hass.type="app" \
  io.hass.arch="aarch64" \
  org.opencontainers.image.source="https://github.com/Kuirak/print-buddy"
EXPOSE 9217
CMD ["node", "server/main.ts"]

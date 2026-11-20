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

# foo2hbpl2 from foo2zjs (GPL-2.0) packs colour Print Jobs into the Printer's own language when Dell's engine is in the
# share folder (docs/adr/0007-colour-print-jobs-print-through-dells-engine.md). It stays a separate program, and its
# source travels in the image next to the binary, as the GPL asks of whoever hands the binary on.
FROM node:26-alpine AS foo2hbpl2
ARG FOO2ZJS_COMMIT=e04290de6b7a30d588f3411fd9834618e09f7b9b
RUN apk add --no-cache build-base
ADD --checksum=sha256:5105113f1758c515265ee53882e846b2c4134b89e7b40906483c4497cd8df1f0 \
  https://github.com/koenkooi/foo2zjs/archive/${FOO2ZJS_COMMIT}.tar.gz /tmp/foo2zjs.tar.gz
WORKDIR /src
RUN tar xzf /tmp/foo2zjs.tar.gz --strip-components=1 \
  && mkdir -p /out/source \
  && cp foo2hbpl2.c hbpl.h jbig.c jbig.h jbig_ar.c jbig_ar.h COPYING /out/source/ \
  && printf 'foo2zjs %s (https://github.com/koenkooi/foo2zjs)\nBuilt with: cc -O2 -w -o foo2hbpl2 foo2hbpl2.c jbig.c jbig_ar.c\n' "$FOO2ZJS_COMMIT" > /out/source/BUILD \
  && cc -O2 -w -o /out/foo2hbpl2 foo2hbpl2.c jbig.c jbig_ar.c

FROM node:26-alpine
# Only for the labels. The server reads its version from print-buddy/config.yaml.
ARG BUILD_VERSION=dev
ENV NODE_ENV=production
# MuPDF's mutool rasterises colour PDF Print Jobs for Dell's engine; a separate program, from Alpine's package
RUN apk add --no-cache mupdf-tools
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/shared ./shared
COPY --from=build /app/server ./server
COPY --from=build /app/dist ./dist
COPY --from=build /app/print-buddy/config.yaml ./print-buddy/config.yaml
COPY --from=foo2hbpl2 /out/foo2hbpl2 /usr/local/bin/foo2hbpl2
COPY --from=foo2hbpl2 /out/source /usr/local/share/foo2hbpl2/source
LABEL \
  io.hass.version="${BUILD_VERSION}" \
  io.hass.type="app" \
  io.hass.arch="aarch64" \
  org.opencontainers.image.source="https://github.com/Kuirak/print-buddy"
EXPOSE 9217
CMD ["node", "server/main.ts"]

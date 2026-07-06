# LaserKerf web — static PWA served by nginx.
#
# The PWA bundle (including the WASM geometry modules) is built LOCALLY, where the
# Emscripten/Rust toolchain lives, not inside this image:
#
#     pnpm install --frozen-lockfile
#     pnpm --filter web build          # emits apps/web/dist
#
# This image then just serves apps/web/dist. Build context = repo root
# (see docker-compose.yml: context: ../../..).
#
# Phase A only. The laserkerf-api (licensing/accounts) service is not built yet
# and is intentionally absent from this stack — see /DEPLOY.md "Phase B".

FROM nginx:1.27-alpine
COPY apps/deploy/laserkerf/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/web/dist /usr/share/nginx/html
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8000/ || exit 1

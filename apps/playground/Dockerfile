# syntax=docker/dockerfile:1
#
# The MKP playground: the mkp compiler (Rust) behind the playground's Node server.
# Build it with the repository root as the context:
#
#   docker build -f apps/playground/Dockerfile -t mkp-playground .
#   docker run --rm -p 8080:8080 -e DEVBENCH_NOTIFY_URL=… -e DEVBENCH_NOTIFY_TOKEN=… mkp-playground
#
# Three stages: the compiler, the UI's bundle, and what runs. What runs is Node, server.mjs, the
# bundle, the examples and the compiler binary: no node_modules, as the server uses Node's own
# modules only. Both Debian-based stages are bookworm, so the binary finds the glibc it was built on.

# ---- 1. the compiler: `mkp`, with core embedded in it at build time

FROM rust:1-bookworm AS compiler
WORKDIR /src
# cli/build.rs embeds ../../../core, and the syntax crate includes core/entities.mkp
COPY core ./core
COPY targets/rust ./targets/rust
WORKDIR /src/targets/rust
RUN cargo build --release --locked -p mkp-cli \
 && strip target/release/mkp \
 && printf '@@@\n# Hello\n' > /tmp/smoke.mkp.md \
 && ./target/release/mkp check /tmp/smoke.mkp.md

# ---- 2. the UI: @mkp/runtime and @mkp/dom built, then bundled with the playground's own code

FROM node:22-bookworm-slim AS ui
ENV npm_config_fund=false npm_config_audit=false npm_config_update_notifier=false
WORKDIR /src
# the manifests first, so the installs stay cached while only sources change
COPY targets/ts/runtime/package*.json targets/ts/runtime/.npmr[c] ./targets/ts/runtime/
COPY targets/ts/dom/package*.json targets/ts/dom/.npmr[c] ./targets/ts/dom/
COPY apps/playground/package*.json apps/playground/.npmr[c] ./apps/playground/
RUN set -e; \
    for d in targets/ts/runtime targets/ts/dom apps/playground; do \
      cd "/src/$d"; \
      if [ -f package-lock.json ]; then npm ci; else npm install; fi; \
    done
# the sources: .dockerignore leaves out node_modules and dist, so the installs above stay
COPY targets/ts/runtime ./targets/ts/runtime
RUN cd targets/ts/runtime && npm run build
COPY targets/ts/dom ./targets/ts/dom
RUN cd targets/ts/dom && npm run build
COPY apps/playground ./apps/playground
RUN cd apps/playground && npm run build && test -s dist/app.js && test -s dist/app.css

# ---- 3. what runs

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=8080 \
    MKP_BINARY=/usr/local/bin/mkp
WORKDIR /app
COPY --from=compiler /src/targets/rust/target/release/mkp /usr/local/bin/mkp
# the packs a page may import (server.mjs: PACKS), where they are in the repo
COPY examples/graphs ./examples/graphs
COPY --from=ui /src/apps/playground/server.mjs /src/apps/playground/index.html /src/apps/playground/package.json ./apps/playground/
COPY --from=ui /src/apps/playground/examples ./apps/playground/examples
COPY --from=ui /src/apps/playground/dist ./apps/playground/dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "apps/playground/server.mjs"]

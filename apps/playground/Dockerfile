# syntax=docker/dockerfile:1
#
# The MKP playground: its Node server, and the page, which compiles in the browser with mkp.wasm.
# Build it with the repository root as the context:
#
#   docker build -f apps/playground/Dockerfile -t mkp-playground .
#   docker run --rm -p 8080:8080 -e DEVBENCH_NOTIFY_URL=… -e DEVBENCH_NOTIFY_TOKEN=… mkp-playground
#
# Three stages: the compiler as WebAssembly, the UI's bundle, and what runs. What runs is Node,
# server.mjs, the bundle (mkp.wasm in it), the examples and the packs: no node_modules, as the
# server uses Node's own modules only, and no compiler binary.

# ---- 1. the compiler: mkp.wasm, for wasm32-wasip1, with core embedded in it at build time;
#         decNumber's C is compiled by zig's clang (targets/rust/wasm/zig/cc)

FROM rust:1-bookworm AS compiler
RUN apt-get update && apt-get install -y --no-install-recommends python3-venv && rm -rf /var/lib/apt/lists/* \
 && python3 -m venv /opt/zig && /opt/zig/bin/pip install --no-cache-dir ziglang==0.17.1 \
 && rustup target add wasm32-wasip1
ENV MKP_ZIG="/opt/zig/bin/python -m ziglang"
WORKDIR /src
# wasm/build.rs embeds ../../../core, and the syntax crate includes core/entities.mkp
COPY core ./core
COPY targets/rust ./targets/rust
# a member of targets/rust's workspace, so cargo can load the workspace
COPY targets/android/mkp ./targets/android/mkp
RUN targets/rust/wasm/build.sh /src/mkp.wasm && test -s /src/mkp.wasm

# ---- 2. the UI: @mkp/runtime, @mkp/dom and @mkp/wasm built, then bundled with the playground's own code

FROM node:22-bookworm-slim AS ui
ENV npm_config_fund=false npm_config_audit=false npm_config_update_notifier=false
WORKDIR /src
# the manifests first, so the installs stay cached while only sources change
COPY targets/ts/runtime/package*.json targets/ts/runtime/.npmr[c] ./targets/ts/runtime/
COPY targets/ts/dom/package*.json targets/ts/dom/.npmr[c] ./targets/ts/dom/
COPY targets/ts/wasm/package*.json ./targets/ts/wasm/
COPY apps/playground/package*.json apps/playground/.npmr[c] ./apps/playground/
# @mkp/wasm's tests compare it with the binary (@mkp/cli), which isn't built here
RUN set -e; \
    cd /src/targets/ts/wasm && npm pkg delete devDependencies.@mkp/cli; \
    for d in targets/ts/runtime targets/ts/dom targets/ts/wasm apps/playground; do \
      cd "/src/$d"; \
      if [ -f package-lock.json ]; then npm ci; else npm install; fi; \
    done
# the sources: .dockerignore leaves out node_modules and dist, so the installs above stay
COPY targets/ts/runtime ./targets/ts/runtime
RUN cd targets/ts/runtime && npm run build
COPY targets/ts/dom ./targets/ts/dom
RUN cd targets/ts/dom && npm run build
COPY targets/ts/wasm/src targets/ts/wasm/tsconfig.json ./targets/ts/wasm/
COPY --from=compiler /src/mkp.wasm ./targets/ts/wasm/mkp.wasm
# built, and a page compiled with it: a broken mkp.wasm stops the build here
RUN cd targets/ts/wasm && npm run build \
 && node -e "import('./dist/index.js').then(async ({ Compiler }) => { const b = (await Compiler.load()).build('page.mkp.md', '# Hello\\n'); if (b.errors || !b.ir) throw new Error(JSON.stringify(b.diagnostics)); })"
COPY apps/playground ./apps/playground
RUN cd apps/playground && npm run build && test -s dist/app.js && test -s dist/app.css && test -s dist/editor.worker.js && test -s dist/compiler.worker.js && test -s dist/mkp.wasm && ls dist/codicon-*.ttf

# ---- 3. what runs

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app
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

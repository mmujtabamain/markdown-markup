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
# members of targets/rust's workspace, so cargo can load the workspace
COPY targets/android/mkp ./targets/android/mkp
COPY targets/android/mkp-live ./targets/android/mkp-live
RUN targets/rust/wasm/build.sh /src/mkp.wasm && test -s /src/mkp.wasm

# ---- 2. the UI: @mkp/runtime, @mkp/dom, @mkp/wasm and the Targets page's targets (@mkp/embed,
#         @mkp/live, @mkp/embed-live, @mkp/view, @mkp/react, @mkp/react-live) built, then bundled
#         with the playground's own code

FROM node:22-bookworm-slim AS ui
ENV npm_config_fund=false npm_config_audit=false npm_config_update_notifier=false
WORKDIR /src
COPY targets/ts/runtime ./targets/ts/runtime
COPY targets/ts/dom ./targets/ts/dom
COPY targets/ts/wasm ./targets/ts/wasm
COPY --from=compiler /src/mkp.wasm ./targets/ts/wasm/mkp.wasm
COPY targets/ts/bindings/embed ./targets/ts/bindings/embed
COPY targets/ts/bindings/live ./targets/ts/bindings/live
COPY targets/ts/bindings/embed-live ./targets/ts/bindings/embed-live
COPY targets/ts/bindings/view ./targets/ts/bindings/view
COPY targets/ts/bindings/react ./targets/ts/bindings/react
COPY targets/ts/bindings/react-live ./targets/ts/bindings/react-live
COPY apps/playground ./apps/playground
# each package installed, then built, in the order they need each other: npm copies a file:
# package (or links it) as it is then, so what it needs is built first. The packages' tests
# compare them with the binary (@mkp/cli) and @mkp/view, which aren't built here
RUN set -e; \
    cd /src/targets/ts/wasm && npm pkg delete devDependencies.@mkp/cli; \
    cd /src/targets/ts/bindings/embed && npm pkg delete devDependencies.@mkp/cli && rm -f package-lock.json; \
    cd /src/targets/ts/bindings/live && npm pkg delete devDependencies.@mkp/view; \
    for d in view react react-live; do (cd /src/targets/ts/bindings/$d && npm pkg delete devDependencies.@mkp/cli && rm -f package-lock.json); done; \
    for d in targets/ts/runtime targets/ts/dom targets/ts/wasm targets/ts/bindings/embed targets/ts/bindings/view targets/ts/bindings/live targets/ts/bindings/embed-live targets/ts/bindings/react targets/ts/bindings/react-live; do \
      cd "/src/$d"; \
      rm -rf node_modules dist; \
      if [ -f package-lock.json ]; then npm ci; else npm install; fi; \
      npm run build; \
    done; \
    # a page compiled with mkp.wasm: a broken one stops the build here
    cd /src/targets/ts/wasm && node -e "import('./dist/index.js').then(async ({ Compiler }) => { const b = (await Compiler.load()).build('page.mkp.md', '# Hello\\n'); if (b.errors || !b.ir) throw new Error(JSON.stringify(b.diagnostics)); })"; \
    cd /src/apps/playground && rm -rf node_modules dist && npm ci && npm run build \
 && test -s dist/app.js && test -s dist/app.css && test -s dist/editor.worker.js && test -s dist/compiler.worker.js && test -s dist/mkp.wasm \
 && test -s dist/targets.js && test -s dist/targets-counter.ir.json && ls dist/codicon-*.ttf

# ---- 3. what runs

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app
# the packs a page may import (server.mjs: PACKS), where they are in the repo
COPY examples/graphs ./examples/graphs
COPY --from=ui /src/apps/playground/server.mjs /src/apps/playground/index.html /src/apps/playground/targets.html /src/apps/playground/package.json ./apps/playground/
COPY --from=ui /src/apps/playground/examples ./apps/playground/examples
COPY --from=ui /src/apps/playground/dist ./apps/playground/dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "apps/playground/server.mjs"]

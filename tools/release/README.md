# Releasing MKP

A version tag starts the release: `.github/workflows/release.yml` builds everything on Linux,
tests it, and publishes it.

```sh
git tag v0.3.0 && git push origin v0.3.0       # or run the Release workflow by hand
```

What it does, in order:

1. **Binaries.** `mkp` for Linux on x64 and arm64 (static, musl), macOS on Intel and Apple
   silicon, and Windows on x64, each cross-built with `cargo zigbuild` and put in its
   `@mkp/cli-<os>-<cpu>` package (`targets/ts/cli/scripts/copy-binary.mjs --target <triple>`).
2. **mkp.wasm**, for `@mkp/wasm` and the real-time targets (`targets/rust/wasm/build.sh`).
3. **The Android AARs** of mkp-android and mkp-android-live, with the runner's NDK.
4. **Tests.** The Rust workspace, every npm package's tests (`build-ts.mjs --test`) and every
   target's conformance checks (`mkp target check`).
5. **Publishing.** A GitHub release with the binaries, mkp.wasm, the AARs and their SHA-256 sums;
   then the npm packages (`publish-npm.mjs`) and the crates (`publish-crates.sh`).

## What it needs

| Secret | For | Without it |
|---|---|---|
| `NPM_TOKEN` | an npm token that can publish to the `@mkp` scope | the npm packages aren't published; the step says so |
| `CARGO_REGISTRY_TOKEN` | a crates.io token for the `mkp-*` crates | the crates aren't published; the step says so |

The GitHub release needs only the workflow's own token (Settings → Actions → Workflow
permissions: read and write).

## The scripts

- `build-ts.mjs [--test]`: installs and builds every npm package in order, each after what it
  uses (npm links a `file:` dependency, so it is built first), then tests them all.
- `publish-npm.mjs --version x.y.z [--dry-run]`: publishes each package after its dependencies,
  its `file:` dependencies named by the version for the publish; a platform package without its
  binary is left out.
- `publish-crates.sh [--dry-run]`: copies core's MKP files into the crates that embed them, then
  `cargo publish --workspace`, leaving out mkp-schemagen, mkp-wasm and the Android crates, which
  ship another way.
- `packages.mjs`: the npm packages and their order, for both.

Every package and crate carries the release's version (0.3.0); `publish-npm.mjs` refuses one that
doesn't.

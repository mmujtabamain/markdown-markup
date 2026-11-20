# Releasing Extended Mark

A merge into main that raises `VERSION` starts the release: `.github/workflows/release.yml` builds
everything on Linux, tests it, tags the merge commit `v<VERSION>` and publishes it under that tag. The merge request raises `VERSION`
and adds `notes/<VERSION>.md` (notes/README.md); the **Release notes** check holds it to that, and
the **Types, tests and conformance** check (ci.yml) runs the tests, both required by main's ruleset
(.github/rulesets/). A merge that leaves `VERSION` as it was releases nothing, and the workflow can
be run by hand.

To hold a release, disable the Release workflow (Actions → Release → Disable workflow) before the
merge; enable it and run it by hand when the release should go out. While `main`'s `VERSION` has no
release, a merge request may keep it and add to `notes/<VERSION>.md`: the check holds it only above
the last release.

What it does, in order:

1. **Binaries.** `xtmd` for Linux on x64 and arm64 (static, musl), macOS on Intel and Apple
   silicon, and Windows on x64, each cross-built with `cargo zigbuild` and put in its
   `@extended-mark/cli-<os>-<cpu>` package (`targets/ts/cli/scripts/copy-binary.mjs --target <triple>`).
2. **xtmd.wasm**, for `@extended-mark/wasm` and the real-time targets (`targets/rust/wasm/build.sh`).
3. **The Android AARs** of xtmd-android and xtmd-android-live, with the runner's NDK.
4. **Tests:** the same checks every pull request runs (ci.yml): the Rust workspace, every npm
   package's and the playground's tests, and every target's conformance checks.
5. **Publishing.** The GitHub release `v<VERSION>`, titled and described by its note, with the
   binaries, xtmd.wasm, the AARs and their SHA-256 sums; then the npm packages (`publish-npm.mjs`)
   and the crates (`publish-crates.sh`).

## What it needs

The npm packages are `xtmd` (the command), `extended-mark` (the same, by the language's name: it
depends on `xtmd` and gives its command, API and Vite plugin) and `@extended-mark/*`; the crates are
`xtmd-*`. Each
registry is published to by trusted publishing, with the run's own OIDC token, once it is set up;
until then, and for a package's first release (a registry sets up trusted publishing only for a
package it already has), with a token. npm stops taking direct publishes with a token in January
2027, so npm moves to trusted publishing after the first release.

| Repository variable or secret | For | Without it |
|---|---|---|
| `NPM_TRUSTED_PUBLISHING` = `true` (variable) | npm: each package's Trusted Publisher on npmjs.com names this repository and `release.yml` | the token below is used |
| `NPM_TOKEN` (secret) | an npm token that can publish `xtmd`, `extended-mark` and the `@extended-mark` scope | with no trusted publishing either, the npm packages aren't published; the step says so |
| `CRATES_TRUSTED_PUBLISHING` = `true` (variable) | crates.io: each crate's Trusted Publishing names this repository and `release.yml` | the token below is used |
| `CARGO_REGISTRY_TOKEN` (secret) | a crates.io token with publish-new and publish-update for `xtmd*` | with no trusted publishing either, the crates aren't published; the step says so |
| `VSCE_PAT` (secret) | an Azure DevOps token with Marketplace → Manage, for the publisher `extended-mark` | the extension isn't published to the VS Code Marketplace (it is still on the GitHub release, as a .vsix) |
| `OVSX_PAT` (secret) | an Open VSX token whose account owns the namespace `extended-mark` | the extension isn't published to Open VSX, which VSCodium, Cursor and the like install from |

Trusted publishing checks each package's `repository` against the repository the run is in, so
they are moved together when the repository moves.

The GitHub release needs only the workflow's own token (Settings → Actions → Workflow
permissions: read and write).

## The scripts

- `build-ts.mjs [--test | --test-only]`: installs and builds every npm package in order, the
  playground last, each after what it uses (npm links a `file:` dependency, so it is built first),
  then tests them all.
- `check-notes.mjs [--base-version x.y.z] | --notes-for x.y.z`: the release-notes check, and a
  note's title and body for its release.
- `publish-npm.mjs --version x.y.z [--dry-run]`: publishes each package after its dependencies,
  its `file:` dependencies named by the version for the publish; a platform package without its
  binary is left out.
- `publish-crates.sh [--dry-run]`: copies core's Extended Mark files into the crates that embed them, then
  `cargo publish --workspace`, leaving out xtmd-schemagen, xtmd-wasm and the Android crates, which
  ship another way.
- `packages.mjs`: the npm packages and their order, for both.

Every package and crate carries the release's version (0.3.0); `publish-npm.mjs` refuses one that
doesn't.

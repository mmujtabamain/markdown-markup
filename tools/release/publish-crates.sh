#!/bin/sh
# Publishes Extended Mark's crates to crates.io, each after the ones it depends on (cargo orders a workspace
# publish). A published crate holds only its own folder, so core's Extended Mark files are copied into the
# crates that embed them first: xtmd-cli and xtmd-live embed all of core, xtmd-syntax its entities
# (their build scripts look in the crate before the repository), and taken out after.
#
#   tools/release/publish-crates.sh [--dry-run]
#
# Publishing needs CARGO_REGISTRY_TOKEN in the environment; --dry-run needs nothing. The crates
# shipped another way aren't published: xtmd-schemagen (a tool here), xtmd-wasm (xtmd.wasm, in
# @extended-mark/wasm) and the Android libraries (in their AARs).
set -eu
repo=$(cd "$(dirname "$0")/../.." && pwd)
rust="$repo/targets/rust"
export PATH="$HOME/.cargo/bin:$PATH"
cleanup() { rm -rf "$rust/cli/core" "$rust/live/core" "$rust/compiler/syntax/core"; }
trap cleanup EXIT
for c in cli live; do
  mkdir -p "$rust/$c/core"
  cp "$repo"/core/*.xtpack "$rust/$c/core/"
done
mkdir -p "$rust/compiler/syntax/core"
cp "$repo/core/entities.xtpack" "$rust/compiler/syntax/core/"
cd "$rust"
cargo publish --workspace --allow-dirty \
  --exclude xtmd-schemagen --exclude xtmd-wasm --exclude xtmd-android --exclude xtmd-android-live "$@"

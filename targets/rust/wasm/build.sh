#!/bin/bash
# Builds xtmd.wasm, the compiler a real-time target runs in the browser, into @extended-mark/wasm (or the
# path given). Needs Rust's wasm32-wasip1 target (rustup target add wasm32-wasip1) and zig for
# decNumber's C (see zig/cc).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
out=${1:-$here/../../ts/wasm/xtmd.wasm}
export CC_wasm32_wasip1="$here/zig/cc" AR_wasm32_wasip1="$here/zig/ar"
cargo build --release -p xtmd-wasm --target wasm32-wasip1 --manifest-path "$here/../Cargo.toml"
cp "$here/../target/wasm32-wasip1/release/xtmd_wasm.wasm" "$out"
echo "xtmd.wasm: $(du -h "$out" | cut -f1) at $out"

#!/bin/bash
# Builds mkp.wasm, the compiler a real-time target runs in the browser, into @mkp/wasm (or the
# path given). Needs Rust's wasm32-wasip1 target (rustup target add wasm32-wasip1) and zig for
# decNumber's C (see zig/cc).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
out=${1:-$here/../../ts/wasm/mkp.wasm}
export CC_wasm32_wasip1="$here/zig/cc" AR_wasm32_wasip1="$here/zig/ar"
cargo build --release -p mkp-wasm --target wasm32-wasip1 --manifest-path "$here/../Cargo.toml"
cp "$here/../target/wasm32-wasip1/release/mkp_wasm.wasm" "$out"
echo "mkp.wasm: $(du -h "$out" | cut -f1) at $out"

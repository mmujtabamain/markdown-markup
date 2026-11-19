#!/bin/sh
# Builds libxtmd_android_live.so (the compiler, for the real-time target) and its Kotlin bindings
# into xtmd-android-live/native/, as ../xtmd/build.sh builds xtmd-android's:
#
#   build.sh host       the host's library (linux-x86-64), for Robolectric on the JVM, and the bindings
#   build.sh android    the library for arm64-v8a, armeabi-v7a and x86_64, with the NDK's clang
#   build.sh            both
#
# The bindings are written by xtmd-android's uniffi-bindgen, the same UniFFI. XTMD_ANDROID_LIVE_NATIVE
# moves the output; ANDROID_NDK_HOME picks an NDK (else the newest in $ANDROID_HOME/ndk).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
rust=$(cd "$here/../../rust" && pwd)
out=${XTMD_ANDROID_LIVE_NATIVE:-$here/../compose/xtmd-android-live/native}
mkdir -p "$out"
out=$(cd "$out" && pwd)
export PATH="$HOME/.cargo/bin:$PATH" CARGO_INCREMENTAL=0
what=${1:-all}
cd "$rust"

# put in place by a rename, never written over, so a JVM that has the old one loaded keeps it
put() {
  mkdir -p "$2"
  cp "$1" "$2/.libxtmd_android_live.so.new"
  mv -f "$2/.libxtmd_android_live.so.new" "$2/libxtmd_android_live.so"
}

host() {
  cargo build -q -p xtmd-android-live --release
  cargo build -q -p xtmd-android --release --features bindgen --bin uniffi-bindgen
  put target/release/libxtmd_android_live.so "$out/host/linux-x86-64"
  rm -rf "$out/kotlin"
  ./target/release/uniffi-bindgen generate --library "$out/host/linux-x86-64/libxtmd_android_live.so" \
    --language kotlin --out-dir "$out/kotlin" --no-format
  echo "xtmd-android-live: host library and bindings in $out"
}

android() {
  : "${ANDROID_HOME:=$HOME/.local/android}"
  ndk=${ANDROID_NDK_HOME:-$(ls -d "$ANDROID_HOME"/ndk/* | sort -V | tail -n 1)}
  bin="$ndk/toolchains/llvm/prebuilt/linux-x86_64/bin"
  api=26 # xtmd-android's minSdk
  for pair in aarch64-linux-android:arm64-v8a:aarch64-linux-android armv7-linux-androideabi:armeabi-v7a:armv7a-linux-androideabi x86_64-linux-android:x86_64:x86_64-linux-android; do
    triple=${pair%%:*}
    rest=${pair#*:}
    abi=${rest%%:*}
    clang=${rest#*:}
    under=$(echo "$triple" | tr '-' '_')
    upper=$(echo "$under" | tr 'a-z' 'A-Z')
    # the cc crate (libdecnumber, under the compiler's decimals) and the linker both use the NDK's clang
    export "CC_$under=$bin/$clang$api-clang"
    export "AR_$under=$bin/llvm-ar"
    export "CARGO_TARGET_${upper}_LINKER=$bin/$clang$api-clang"
    cargo build -q -p xtmd-android-live --release --target "$triple"
    put "target/$triple/release/libxtmd_android_live.so" "$out/jniLibs/$abi"
  done
  echo "xtmd-android-live: Android libraries in $out/jniLibs"
}

case "$what" in
  host) host ;;
  android) android ;;
  all) host; android ;;
  *) echo "usage: build.sh [host|android]" >&2; exit 2 ;;
esac

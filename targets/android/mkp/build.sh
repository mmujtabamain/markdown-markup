#!/bin/sh
# Builds libmkp_android.so and its Kotlin bindings into mkp-android/native/ (README.md):
#
#   build.sh host       the host's library (linux-x86-64), for Robolectric on the JVM, and the bindings
#   build.sh android    the library for arm64-v8a, armeabi-v7a and x86_64, with the NDK's clang
#   build.sh            both
#
# Everything is a release build: the evaluator is slow in debug, and the checks run it thousands
# of times. MKP_ANDROID_NATIVE moves the output; ANDROID_NDK_HOME picks an NDK (else the newest in
# $ANDROID_HOME/ndk).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
rust=$(cd "$here/../../rust" && pwd)
out=${MKP_ANDROID_NATIVE:-$here/../compose/mkp-android/native}
mkdir -p "$out"
out=$(cd "$out" && pwd)
export PATH="$HOME/.cargo/bin:$PATH" CARGO_INCREMENTAL=0
what=${1:-all}
cd "$rust"

host() {
  # with the generator built alongside, from the same UniFFI, so the bindings match the library
  cargo build -q -p mkp-android --release --features bindgen
  mkdir -p "$out/host/linux-x86-64"
  cp target/release/libmkp_android.so "$out/host/linux-x86-64/"
  rm -rf "$out/kotlin"
  ./target/release/uniffi-bindgen generate --library "$out/host/linux-x86-64/libmkp_android.so" \
    --language kotlin --out-dir "$out/kotlin" --no-format
  echo "mkp-android: host library and bindings in $out"
}

android() {
  : "${ANDROID_HOME:=$HOME/.local/android}"
  ndk=${ANDROID_NDK_HOME:-$(ls -d "$ANDROID_HOME"/ndk/* | sort -V | tail -n 1)}
  bin="$ndk/toolchains/llvm/prebuilt/linux-x86_64/bin"
  api=26 # mkp-android's minSdk
  # Rust's target, Android's ABI, and the NDK clang's prefix (32-bit ARM's differs from Rust's):
  # budget phones often run a 32-bit-only Android, so armeabi-v7a ships too
  for pair in aarch64-linux-android:arm64-v8a:aarch64-linux-android armv7-linux-androideabi:armeabi-v7a:armv7a-linux-androideabi x86_64-linux-android:x86_64:x86_64-linux-android; do
    triple=${pair%%:*}
    rest=${pair#*:}
    abi=${rest%%:*}
    clang=${rest#*:}
    under=$(echo "$triple" | tr '-' '_')
    upper=$(echo "$under" | tr 'a-z' 'A-Z')
    # the cc crate (libdecnumber, under mkp-eval's decimals) and the linker both use the NDK's clang
    export "CC_$under=$bin/$clang$api-clang"
    export "AR_$under=$bin/llvm-ar"
    export "CARGO_TARGET_${upper}_LINKER=$bin/$clang$api-clang"
    cargo build -q -p mkp-android --release --target "$triple"
    mkdir -p "$out/jniLibs/$abi"
    cp "target/$triple/release/libmkp_android.so" "$out/jniLibs/$abi/"
  done
  echo "mkp-android: arm64-v8a, armeabi-v7a and x86_64 libraries in $out/jniLibs"
}

case "$what" in
  host) host ;;
  android) android ;;
  all) host; android ;;
  *) echo "usage: build.sh [host|android|all]" >&2; exit 2 ;;
esac

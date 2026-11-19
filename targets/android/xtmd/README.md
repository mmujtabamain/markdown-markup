# xtmd-android (Rust): the native runtime for Android

`xtmd-runtime` (targets/rust/runtime) behind a [UniFFI](https://mozilla.github.io/uniffi-rs/) interface, written
with UniFFI's proc macros. `uniffi-bindgen` writes the Kotlin bindings from the built library, and
[xtmd-android](../compose) (the Compose target) draws pages through them. It is a member of the Rust workspace
in `targets/rust` (`"../android/xtmd"` in its `Cargo.toml`), so it shares its `Cargo.lock` and `target/`.

## What Kotlin gets (`xtmd.android.ffi`)

| Rust | Kotlin | What it is |
|---|---|---|
| `NativePage` | `class NativePage(irJson, PageInit, Zone)` | A running page: one handle, behind a lock. Every change is one call, one transaction |
| `Node`, `Slot` | `data class Node(path, key, widget, props: Map<String, Val>, slots, listens, events, writes, same)` | A drawn extern widget, props worked out; `key` is who it is across redraws |
| `Val`, `Field` | `sealed class Val` (`Num`, `Text`, `Bool`, `Duration`, `Items`, `Record`, `Case`, `Opt`, `Range`, `Fn`, `View`) | A value. Numbers are exact decimals as text. A token case carries the build's value for it in `token`, so a composable never calls back while it draws |
| `Measure` | `interface Measure { spot(Node): Extent; planeWidth(Node): Double }` | The plane's layout asks the target for sizes, in dp |
| `Zone` | `interface Zone { offsetMinutes(utcMinutes: Long): Int }` | Where the reader is, for `core/moment.local` |
| `XtmdError::Failed { why }` | `XtmdException.Failed(why)` | The IR doesn't read, a value isn't one, or a call came back into the page |

`NativePage`'s methods:

- **Reading:** `tree()`, `treeUpdate(since)` (the tree with each widget that is as it was at
  revision `since`, and everything in it, as a stub with `same: true`: only what changed crosses),
  `timings()` (time in the runtime and in turning the tree into nodes, for measuring), `node(path)`, `revision()` (moves on every draw), `changes()` (moves on every change from
  outside the layout), `markdown()`, `missing()`, `state(name)`, `takeCalls()` (the app's extern fns Extended Mark called),
  `takeErrors()`, `sliderEnds(path)` (a slider's ends and step, exactly, as @extended-mark/dom works them out, aliases of its
  variable's type included), `shade(path, cols, rows)` (a shade's pixels, as ARGB, from its shader).
- **Changing:** `event`, `write`, `set`, `expose`, `setExtern`, `setPage(width, theme)`, `setSupplies(list)`,
  `layout(measure)`.
- **The checks:** `valueJson`, `eventJson`, `writeJson`, `setJson`, `exposeJson`, `externJson` take the check
  protocol's own JSON, and `observeJson(drawn)` writes an observation in it, the tree limited to what the target
  drew: the same bytes the test target's and the native target's adapters send.

Target fns (`src/fns.rs`): `core/can_draw_tex` is true (xtmd-android draws the TeX core accepts and shows TeX it
doesn't know as itself, as @extended-mark/dom does), and `core/moment.local` asks the `Zone` for the offset at the instant
(the checks pass UTC; an app, `DeviceZone`, the phone's zone with summer time).

The page lives on one thread at a time: a call from another thread waits for the lock; a call back into the page
from inside one of its own calls (a `Measure` calling the page) is an error, not a deadlock.

## Building: `build.sh`

```sh
targets/android/xtmd/build.sh host      # libxtmd_android.so for linux-x86-64 (Robolectric, through JNA) + the bindings
targets/android/xtmd/build.sh android   # libxtmd_android.so for arm64-v8a, armeabi-v7a and x86_64, with the NDK's clang
targets/android/xtmd/build.sh           # both
```

Everything goes into `targets/android/compose/xtmd-android/native/` (gitignored; `XTMD_ANDROID_NATIVE` moves it):

```
native/kotlin/xtmd/android/ffi/xtmd_android.kt     the bindings (uniffi-bindgen, --no-format)
native/host/linux-x86-64/libxtmd_android.so       for the JVM
native/jniLibs/arm64-v8a/libxtmd_android.so       for phones
native/jniLibs/x86_64/libxtmd_android.so          for emulators
```

All release builds: the evaluator is slow in debug, and the checks run it a great deal. What `build.sh` does, by hand:

```sh
cd targets/rust
export PATH=$HOME/.cargo/bin:$PATH CARGO_INCREMENTAL=0
rustup target add aarch64-linux-android x86_64-linux-android           # once

# the host's library, with uniffi-bindgen built from the same UniFFI (the `bindgen` feature turns on uniffi/cli)
cargo build -p xtmd-android --release --features bindgen
./target/release/uniffi-bindgen generate --library target/release/libxtmd_android.so \
  --language kotlin --out-dir ../android/compose/xtmd-android/native/kotlin --no-format

# Android: the NDK's clang for the cc crate (libdecnumber, under xtmd-eval's decimals) and as the linker,
# at xtmd-android's minSdk, 26. No cargo-ndk needed.
NDK=$HOME/.local/android/ndk/30.0.16248370/toolchains/llvm/prebuilt/linux-x86_64/bin
CC_aarch64_linux_android=$NDK/aarch64-linux-android26-clang AR_aarch64_linux_android=$NDK/llvm-ar \
CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER=$NDK/aarch64-linux-android26-clang \
  cargo build -p xtmd-android --release --target aarch64-linux-android
# and the same for x86_64-linux-android
```

`uniffi.toml` names the Kotlin package (`xtmd.android.ffi`) and the library JNA loads (`xtmd_android`).

## Tests

```sh
cd targets/rust && cargo test --release -p xtmd-android     # 12 tests: tests/bindings.rs
XTMD_TIME_IR=/tmp/tour.ir.json cargo test --release -p xtmd-android -- mount_time --nocapture   # how long a page takes to mount
```

They compile pages in-process (core once, on a compiler thread) and check the interface as Kotlin uses it: a tree
update sending only what changed, the tree
as `Val`s with token values, events and writes as one change each, a refused write observed, the check
protocol's JSON in and out, a slider's ends, `moment.local` through a zone, a shade's pixels, the plane laid out
from a `Measure`, and supplies.

## Found while building (what took trial and error)

- **UniFFI 0.29.5**, pinned (`=0.29.5`). Recursive records and enums (`Node` in `Slot`, `Val` in `Val`) work; an
  `Option<Val>` inside `Val` can't (infinite size), so an `opt`, a range's ends and a token's value are lists of
  none or one.
- **A variant named `List` breaks the Kotlin:** inside `sealed class Val`, `List<Field>` then means `Val.List`. It
  is `Items`.
- **An error's field named `message` breaks the Kotlin:** it clashes with `Throwable.message`. It is `why`.
- **No `/*` in a doc comment:** the docs are copied into the Kotlin, where block comments nest, so `` `pack/*` ``
  opens a comment that never closes. Write "a whole pack, as `pack/` and a star".
- **The bindings must come from the library they load:** UniFFI checks each function's checksum when the library
  loads. Rebuild the bindings and every processor's library together (`build.sh`), and rebuild the app after.

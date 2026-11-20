# xtmd-android-live

Extended Mark's Android target, real time: `XtmdLiveDoc` compiles a document's text on the device as it is
edited, and draws it with [xtmd-android](../xtmd-android)'s `XtmdDoc`. The compiler is in its own
native library, `libxtmd_android_live.so` ([../../xtmd-live](../../xtmd-live): xtmd-live behind
UniFFI, `xtmd.android.live.ffi`). It hands Kotlin the IR as JSON, which `XtmdDoc` runs on
xtmd-android's own library, so nothing crosses between the two. An app that only draws pages it
was given uses xtmd-android alone, and ships no compiler.

```kotlin
var text by remember { mutableStateOf(initialText) }        // the editor's
XtmdLiveDoc(
    source = text,                                         // when it changes is the app's: each key, a pause, a save
    packs = listOf(PackFile("graphs/graphs.xtmdpack", graphsText)),
    onError = { e -> if (e is DocError.Compile) showProblem(e.message) },   // the first error and where
    onDiagnostics = { list -> markers = list },            // every diagnostic of the latest text
    // and everything XtmdDoc takes: state, onStateChange, externs, fns, docState …
)
```

- A text that compiles replaces the page, keeping `$state` where its fields still exist. One that
  doesn't leaves the last page that did.
- The compile runs off the main thread (`LiveCompiler.build`). Core is compiled the first time,
  once for the app. A newer text cancels the answer of the one before.
- `LiveCompiler.get()` is the app's compiler, to build a text outside a composable.

## Building and testing

```sh
../../xtmd/build.sh host && ../../xtmd-live/build.sh host   # both host libraries and their bindings
../../xtmd-live/build.sh android                           # the compiler for arm64-v8a, armeabi-v7a and x86_64
./gradlew :xtmd-android-live:testDebugUnitTest             # XtmdLiveDocTest, under Robolectric
./gradlew :xtmd-android:checkAdapterArgs                   # then, from this folder: xtmd target check android-live
```

`xtmd target check android-live` (target.yaml) runs every conformance case through
`xtmd.android.LiveCheckAdapter` (xtmd-android's tests, CheckAdapter.kt): the Android adapter's session
with each case's own text compiled on the device by `XtmdLiveDoc`.

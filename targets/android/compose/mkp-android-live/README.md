# mkp-android-live

MKP's Android target, real time: `MkpLiveDoc` compiles a document's text on the device as it is
edited, and draws it with [mkp-android](../mkp-android)'s `MkpDoc`. The compiler is in its own
native library, `libmkp_android_live.so` ([../../mkp-live](../../mkp-live): mkp-live behind
UniFFI, `mkp.android.live.ffi`). It hands Kotlin the IR as JSON, which `MkpDoc` runs on
mkp-android's own library, so nothing crosses between the two. An app that only draws pages it
was given uses mkp-android alone, and ships no compiler.

```kotlin
var text by remember { mutableStateOf(initialText) }        // the editor's
MkpLiveDoc(
    source = text,                                         // when it changes is the app's: each key, a pause, a save
    packs = listOf(PackFile("graphs/graphs.mkp", graphsText)),
    onError = { e -> if (e is DocError.Compile) showProblem(e.message) },   // the first error and where
    onDiagnostics = { list -> markers = list },            // every diagnostic of the latest text
    // and everything MkpDoc takes: state, onStateChange, externs, fns, docState …
)
```

- A text that compiles replaces the page, keeping `$state` where its fields still exist. One that
  doesn't leaves the last page that did.
- The compile runs off the main thread (`LiveCompiler.build`). Core is compiled the first time,
  once for the app. A newer text cancels the answer of the one before.
- `LiveCompiler.get()` is the app's compiler, to build a text outside a composable.

## Building and testing

```sh
../../mkp/build.sh host && ../../mkp-live/build.sh host   # both host libraries and their bindings
../../mkp-live/build.sh android                           # the compiler for arm64-v8a, armeabi-v7a and x86_64
./gradlew :mkp-android-live:testDebugUnitTest             # MkpLiveDocTest, under Robolectric
./gradlew :mkp-android:checkAdapterArgs                   # then, from this folder: mkp target check android-live
```

`mkp target check android-live` (target.yaml) runs every conformance case through
`mkp.android.LiveCheckAdapter` (mkp-android's tests, CheckAdapter.kt): the Android adapter's session
with each case's own text compiled on the device by `MkpLiveDoc`.

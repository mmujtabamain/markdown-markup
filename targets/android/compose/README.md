# MKP's Android target: mkp-android

MKP pages drawn natively on Android: the IR the `mkp` compiler writes, run by MKP's native runtime (Rust, through
the Kotlin bindings UniFFI generates: [../mkp](../mkp)), and drawn by our default Jetpack Compose and Material 3
widgets, one composable per core extern widget.

```
targets/android/
├── mkp/                    the Rust crate: mkp-runtime behind UniFFI, build.sh, its tests
└── compose/                this Gradle project
    ├── mkp-android/        the library (published as mkp:mkp-android): MkpPage, the registry, the widgets;
    │                       its unit tests hold the two check adapters
    ├── sample/             an app showing two pages (the shop example, and a tour of the widgets)
    ├── target.yaml         the target, for `mkp target check android`
    └── tokens.mkp          core's tokens as Material 3 draws them
```

## Using it

```kotlin
// the IR `mkp build page.mkp.md -o page.ir.json` wrote, in the app's assets
val page = remember { CompiledPage.fromAsset(context, "page.ir.json", PageOptions(theme = "DARK")) }
MkpPage(page)                                         // draws it, and keeps it drawn
MkpPage(page, Externs(mapOf("acme/chart" to Widget { props, ctx -> MyChart(props, ctx) })))

page.set("budget" to V.num(40))                       // the app's write to $state: checked, one change
page.expose("doc/scores", "reset")                     // a fn the document exposes
for (call in page.takeCalls()) handle(call.name, call.args)   // the extern fns MKP called
page.markdown()                                        // the page as Markdown, with its values now
```

- **`@Composable fun MkpPage(page: CompiledPage, externs: Externs = Externs.None, modifier, measure, colors)`**
  draws `page.tree` with the registry's composables, each kept by its `key`, so a loop row's widgets follow its
  item. It sets the runtime's supplies from the registry, so a widget nothing draws shows its Markdown.
- **`registry`** maps every core extern widget to its composable: `"core/press" to Widget { props, ctx -> MkpPress(props, ctx) }`.
  `Externs.widgets` replace ours by name, or add a pack's.
- **A widget** is `fun interface Widget { @Composable fun Draw(props: Props, ctx: WidgetContext) }`. `props` are
  `Val`s, worked out (`props.text("label")`, `props.slot("body")`); `ctx.event(name, args)` runs the caller's
  handler and `ctx.write(input, value)` writes a `mut` input, each as one checked change; `ctx.Children(nodes)`
  draws a slot.
- **Colours** come from the Material 3 colour scheme for the tokens a scheme has a role for (SURFACE, INK, MUTED,
  LINE, ACCENT, BAD), and from the build's values for the rest. `colors` gives the schemes, light and dark
  (Material 3's baseline by default; an app passes its own, and every page follows it), and the page's `theme`,
  else the system, picks one. tokens.mkp says which values these are, and a unit test holds the two together.
- **Errors** caught by the runtime are logged with `Log.w("mkp", …)` after each change. `MKP_ANDROID_TRACE=1` in
  the environment logs each redraw and each spot's measured size to standard error.

### How a page is drawn

- **Every change crosses into Rust once** (`page.change { … }`), and the tree comes back in one batch when the
  revision moved.
- **Writes are exact.** A slider snaps to its grid with decimals; a pan, a zoom or a handle writes numbers rounded
  to a sub-pixel. A refused write leaves the value as it was.
- **The plane** is a clipped view holding one inner layer that `graphicsLayer` moves and scales; a custom `Layout`
  places each spot at its point by its anchor and nudge, in dp, and the background is drawn in the same layer. A
  drag pans, two fingers pinch, the wheel and `+`/`-` zoom, the arrows pan. Boxes come from the measure pass
  (`onSizeChanged`), in dp. The planes are laid out once after each change from outside the layout, and again when
  a measured size changes, never after their own layout's redraw (see "Found while building").
- **core.gfx** draws on a `Canvas` per shape, in the surface's units (y up); each shape has a box at its bounds for
  its semantics, clicks and hover. `shade` paints at most 4,096 samples from its shader, worked out in Rust off the
  main thread, and scales them up.
- **Maths** is laid out from its TeX by the same reader as @mkp/dom's (`Math.kt`): on a line of its own, as
  boxes on a Canvas (scripts smaller and raised or lowered, a big operator's limits above and below it, a fraction
  stacked over its bar, a root under its sign); in a sentence, as an `AnnotatedString` (scripts with a baseline
  shift, a fraction as a/b, bracketed only where it would read wrongly). TeX it doesn't know shows as itself.
- **Rows** (`flex` along X, `row`, wrapping or not) centre, start or end their children across as `align` says.
- **A closed overlay's body** stays composed, unmeasured and hidden from accessibility, as @mkp/dom keeps it on
  the page; open, it is a `Popup` (popover, menu, tooltip) or a `Dialog`.

### Parts

Every widget's root has its path in the semantics property `MkpSite`, and a `testTag` with its short name; its
other parts have `testTag`s as @mkp/dom's `data-part`s (targets/ts/dom/README.md):

| Widget | Parts (`testTag`) | Semantics |
|---|---|---|
| paragraph, heading | `paragraph`, `heading` | Rich text as an `AnnotatedString`; a heading is `heading()` |
| bullets, item | `bullets`; `item`, `item.check`, `item.body` | `collectionInfo`; the marker is hidden; the task box is a disabled checkbox named Done or Not done |
| quote, code, math | `quote`; `code`, `code.text`; `math` | Code scrolls sideways and is selectable; maths is named by its TeX |
| table, footnote, divider | `table`, `table.grid`, `table.header`, `table.cell`; `footnote`, `footnote.mark`, `footnote.body`; `divider` | A table is as @mkp/dom draws it: each column as wide as its widest cell, a line under each row, and it scrolls when wider than the page; a footnote is named "Footnote <mark>" |
| label, image, icon | `label`; `image`; `icon` | An image is named by its alt; an icon with a label is an image, else decoration |
| press | `press`, `press.label`, `press.content`, `press.indicator` | BUTTON an `OutlinedButton` (a `Button` filled with its tone when it has one), PLAIN a `TextButton`, TOGGLE and OPTION a tonal or outlined button with `selected`, TAB a `Tab`, SWITCH, CHECK and RADIO a row with role switch, checkbox or radio button; with content, its label is its name |
| field | `field`, `field.label`, `field.input` | An `OutlinedTextField`; Enter (its IME action) submits a one-line field, Ctrl+Enter a longer one |
| slider | `slider`, `slider.label`, `slider.input`, `slider.value` | A Material `Slider` named by its label; arrows, Page Up/Down, Home and End move it exactly |
| overlay | `overlay`, `overlay.anchor`, `overlay.body` | The anchor is a button unless it holds a control; the body is a pane named by its label; Escape closes it |
| canvas, layer | `canvas`, `canvas.surface`; `layer`, `layer.shapes` | A canvas is named by its label; its surface clicks when its click is set |
| circle, path, place | `circle`; `path`, `path.line`, `path.head`; `place`, `place.box` | A shape with a click is a button, one with a label an image |
| handle, shade | `handle`, `handle.dot`; `shade`, `shade.pixels` | A handle is focusable, with its point as its state; arrows move it 8 dp, 40 with Shift |
| flex, grid, cell, sizing | `flex`, `grid`, `cell`, `sizing` | Clickable when their click does something; a run of tabs, radios or options is a selectable group |
| plane, spot | `plane`, `plane.view`, `plane.inner`, `plane.background`, `plane.items`; `spot` | The view is focusable and takes the keys |
| #notice | `notice` | A polite live region |

## Building

What this box has, and the project expects: Java 21, the Android SDK at `~/.local/android` (`local.properties`;
platform 36, build-tools 36.1.0 and NDK 30.0.16248370, all pinned in the build files so AGP fetches nothing),
Rust with the Android targets. Gradle comes from the wrapper (8.14.4); AGP 8.13.2, Kotlin 2.2.21, Compose BOM
2025.10.01 and Robolectric 4.16.1 are the versions omnicui's Android example runs.

```sh
targets/android/mkp/build.sh            # 1. libmkp_android.so for the host, arm64-v8a, armeabi-v7a and x86_64, and the bindings
cd targets/android/compose
./gradlew :mkp-android:assembleRelease  # 2. the AAR: mkp-android/build/outputs/aar/mkp-android-release.aar
./gradlew :mkp-android:publish          #    or published, as mkp:mkp-android:0.3.0, to build/repo
./gradlew :sample:assembleDebug         # 3. the APK: sample/build/outputs/apk/debug/sample-debug.apk
./gradlew :mkp-android:testDebugUnitTest   # the unit tests (Robolectric)
```

The library's build stops with a message when `native/` is missing (step 1). The sample builds its pages' IR with
`targets/rust/target/release/mkp` (`cargo build --release` in targets/rust) as part of its build:
`examples/pages/shop.mkp.md` and `sample/pages/tour.mkp.md`. The APK carries arm64-v8a, armeabi-v7a (budget phones often run a 32-bit-only Android) and x86_64; build.sh needs `rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android`.

## Keeping it fast

A budget phone is 5 to 10 times slower than a desktop, and the runtime redraws the whole page on
every change. So a change's work is kept small, and a drag's is kept off the frames:

- **A redraw sends only what changed.** `NativePage.treeUpdate(since)` sends each widget that is as
  it was (and everything in it) as a stub, and `CompiledPage` keeps the very node it holds for it,
  so only changed nodes cross from Rust, and Compose (with strong skipping) composes only those:
  about 6 widgets a step of a drag on the tour, not all 52.
- **A drag writes at most once a frame, and off the main thread.** `FrameWriter` keeps the latest
  move, writes it on the next frame through `CompiledPage.writeAway` (the runtime's work on a
  background thread, the tree read back on the main one), and never has two writes in flight. The
  handle, the slider's thumb and the plane follow the finger meanwhile; where a drag ends is always
  written. Keys and accessibility actions write at once, as before.
- **The planes are laid out only when a plane or a spot (or anything in one) changed**, or a spot's
  measured size did; a layout that moved a box lays out again on the next change, as one that
  doesn't settle needs (the checks hold this to the test target's behaviour).
- **One colour scheme for as long as the mode lasts**: a new one at each redraw was a new value of
  MaterialTheme's static composition local, and composed the whole page again.
- **Pages load off the main thread**: `CompiledPage.loadAsset` (or `rememberAssetPage` in a
  composable) parses the IR and mounts the page on a background thread; an IR with all of core in
  it takes 40 to 120 ms to mount here, a fraction of a second on a phone. The sample shows a
  progress indicator meanwhile.
- **Tests wait for the off-main work**: `MkpWork.idle` is false while a load, a drag's write or a
  pending frame write runs; every test and both check adapters register it as an idling resource.

`DragPerfTest` measures the tour's three drags (the handle, the plane, the slider) on a phone-sized
window, each step's main-thread processor time split from the runtime's off-main time, against a
control step, and holds them to a budget and to what the fixes do (only changed widgets composed
and sent, one write a step). It writes `mkp-android/build/drag-perf.txt`. `-Pmkp.jfr=<file>` records
a Java Flight Recording of the tests, and `-Pmkp.perf.only=handle|plane|slider` runs one drag.

## Looking at it

`./gradlew :sample:testDebugUnitTest -Pmkp.render=<folder>` draws the sample under Robolectric's native graphics
(Skia, real fonts), as an Infinix X6516 shows it (360 by 806 dp at density 2), light and dark: each tab's first
screen with the app around it, and each page whole. The same pages drawn by @mkp/dom in Chromium at 360 px wide
are what to hold them against. Compose's `captureToImage()` waits for a frame Robolectric's paused looper never
draws, so `RenderTest` draws the window's views on a canvas itself.

## The checks

Both adapters run Compose under Robolectric on a plain JVM (no emulator, no Gradle at check time): build their
classpath once, which also writes the classpath file target.yaml starts them with:

```sh
targets/android/mkp/build.sh host
(cd targets/android/compose && ./gradlew :mkp-android:checkAdapterArgs)    # writes build/check_adapter.args
```

**MKP's target checks** (`check_adapter: exec java @build/check_adapter.args mkp.android.CheckAdapter`):

```sh
cd targets/rust
./target/release/mkp target check android     # android: 58 cases, 55 steps, 0 differ from the case (about 40 s)
./target/release/mkp target check             # every target, each compared with every other
```

The adapter (`mkp-android/src/test/kotlin/mkp/android/CheckAdapter.kt`) keeps one Robolectric sandbox and one
activity, at 640 dp wide (mdpi, so 1 dp is 1 px), and draws each page with `MkpPage` and the badge check pack's
Android widget (`targets/checks/packs/badge/android.kt`). Each step goes through the drawn widget's semantics
where a person could take it: a click is the widget's click action, a submit its IME action, a slider's value
its progress action (when it is on the grid), a field's text its text action, an overlay's `open` a press on
its anchor. The rest (an exact point for a handle or a plane, an event with arguments) goes through the page.
Then Compose settles, the planes are laid out with the checks' fixed sizes (`check/Sizes.kt`, a port of
targets/ts/test/sizes.mjs, so every target's boxes agree exactly), and the observation is the runtime's, its
tree only what Compose drew. `core/moment.local` is in UTC there, as on the test target.

**omnicui's widget contracts** (targets/checks/targets/android/target.yaml):

```sh
omnicui --project targets/checks check android    # 118 pass, 1 platform exception (about 50 s)
```

`mkp.android.OmnicuiAdapter` mounts one widget per contract test, in a fresh activity at the viewport and colour
scheme asked for (`dark` is the page theme DARK). Its pages are the web's, written by the same code
(targets/checks/targets/android/page.mjs runs targets/ts/web/omnicui/source.mjs, so node is needed) and built with
the `mkp` binary, cached in the system's temporary folder. Parts are found in the semantics tree in the web
adapter's order (an alias, the widget itself by its site, `<short>.<part>` inside it or in a popup, `<part>`
anywhere, the nth). `press` is a mouse click and `hover` a mouse move, as Playwright's are; `drag` is a touch
swipe; `focus` switches Compose to keyboard mode first, as a hardware keyboard's first key does; `type` types a
letter at a time. Reads are the merged semantics node's. It advertises no screenshots, traces or clips, as the web
doesn't. The one platform exception (core.press): a pointer's press doesn't move the focus on Android. The target
is `exclusive: true`: run beside Chromium and egui on a box with a 6 GB memory limit, both it and Chromium were
killed for memory, so omnicui runs it on its own.

## Found while building (what took trial and error)

- **AGP's `test_config.properties` names its files relative to the module**, where Gradle runs tests; the adapters
  run from target.yaml's folder, so Robolectric couldn't open `apk-for-local-test.ap_`. `checkAdapterArgs` writes
  a copy with whole paths (`mkp-android/build/check_adapter/com/android/tools/`) first on the classpath, and makes
  the task depend on everything `testDebugUnitTest` depends on, the packaged resources included.
- **JNA**: the app takes `net.java.dev.jna:jna:5.17.0@aar` (libjnidispatch for each processor); the unit tests take
  the plain jar too (the host's libjnidispatch), and find libmkp_android.so through `-Djna.library.path`, set in
  check_adapter.args and on the Gradle test task.
- **The plane's layout isn't idempotent for a spot with no box variable** (the graphs pack's link labels): each
  `layout()` writes its own `box` again and redraws. Laying out after every redraw never settled (Compose "did not
  get idle"); laying out once per change from outside the layout (`changes`, as the test target does once per step)
  does. With Compose's own measure the first layout waits for the spots' first measure, so the first boxes written
  are the real ones.
- **Hover under Robolectric:** a shape with both a `hoverable` and a `clickable`, on two interaction sources,
  never got its Exit; one source shared by both does.
- **Space and Enter** activate Compose's buttons from a hardware keyboard as the contracts expect; a focus on a
  disabled control does nothing (it has no focus action), as on the web.
- **Robolectric's first run downloads its Android 16 jar** (about 200 MB into ~/.m2); later starts take about 10 s.
- **The compiler drops prose `@slot name {` blocks** (an overlay in prose gets an empty anchor and no body), so the
  tour page declares its overlay and its plane as widgets of its own.

## Gaps

- Inline views in rich text (`\{@icon(…)}` in a sentence) aren't drawn: the native runtime has no `drawView` yet.
- Pictures inside rich text show their alt text; `image` loads http, https and data: pictures itself, with no cache
  beyond the composition.
- Maths in a sentence is one line of text: a fraction there is a/b, not stacked; on a line of its own it is laid
  out, but without TeX's fine spacing rules or a maths font (it uses the system serif).

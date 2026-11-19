package xtmd.android

import androidx.compose.foundation.layout.Box
import androidx.compose.material3.ColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import xtmd.android.ffi.Broken
import xtmd.android.ffi.ExternCall
import xtmd.android.ffi.Measure
import xtmd.android.ffi.Val
import xtmd.android.ffi.Zone
import org.json.JSONObject

/**
 * Extended Mark documents in Compose, the Android run-time target: `XtmdDoc` draws a document from its IR,
 * in hand (`ir`) or in the app's assets (`src`). `$state` is the app's to control (`state` with
 * `onStateChange`) or to start from (`defaultState`). Every write is checked by xtmd, and what it
 * refuses reaches `onError`. An [XtmdDocState] takes a [Snapshot] of everything the page holds and
 * puts it back. There is no compiler here: xtmd-android-live's `XtmdLiveDoc` compiles a document's
 * text.
 */

/** What went wrong, for `onError`. */
sealed interface DocError {
    /** A write xtmd refused: the app's, or a reader's. */
    data class Refused(val broken: Broken) : DocError
    /** A handler or a widget that failed. */
    data class Failed(val broken: Broken) : DocError
    /** An IR that couldn't be had: read, parsed or started. */
    data class Load(val message: String) : DocError
    /** A text that didn't compile: a real-time target's (xtmd-android-live). */
    data class Compile(val message: String, val diagnostics: List<String> = emptyList()) : DocError
}

/** Everything the page holds, as JSON in the IR's form: opaque to the app, which keeps it
 * ([toJson]) and gives it back. */
data class Snapshot(val xtmd: String, val ir: String, val stateJson: String, val ownJson: String) {
    fun toJson(): String = JSONObject().put("xtmd", xtmd).put("ir", ir).put("state", JSONObject(stateJson)).put("own", JSONObject(ownJson)).toString()

    companion object {
        /** A snapshot from its JSON; null when it isn't one. */
        fun fromJson(text: String): Snapshot? = runCatching {
            val o = JSONObject(text)
            Snapshot(o.getString("xtmd"), o.getString("ir"), o.getJSONObject("state").toString(), o.getJSONObject("own").toString())
        }.getOrNull()
    }
}

/** What [XtmdDocState.restore] did: `ALL` with the same IR, `STATE` with another (its places may be
 * other widgets), `NONE` when it can't be read or its `$state` was refused. */
data class Restored(val restored: How, val dropped: List<String>, val why: String? = null) {
    enum class How { ALL, STATE, NONE }
}

/** The release snapshots are taken in. */
const val RELEASE = "0.3.0"

/** A short, stable hash of a text: FNV-1a, as @extended-mark/view's. */
internal fun hash(text: String): String {
    var h1 = 0x811c9dc5.toInt()
    var h2 = 0x01000193
    for (c in text) {
        h1 = (h1 xor c.code) * 16777619
        h2 = (h2 xor c.code) * -2048144777 // 2246822519 as an Int
    }
    return (h2.toUInt() % 0x100000u).toString(36) + h1.toUInt().toString(36)
}

/** A channel's full name: `tracker` is the document's own (`doc/tracker`). */
internal fun channel(name: String) = if ('/' in name) name else "doc/$name"

/**
 * The app's handle on a document: given to [XtmdDoc], and read after. Its [page] is the running page
 * once the IR is in; before then the calls do nothing.
 */
@Stable
class XtmdDocState {
    /** The running page. */
    var page: CompiledPage? by mutableStateOf(null)
        internal set
    internal var irHash = ""
    /** Told what a call refused, as `onError` is. */
    internal var told: (DocError) -> Unit = {}

    /** Writes `$state`'s fields as one change, checked: refused whole (told to `onError`), or done. */
    fun set(vararg changes: Pair<String, Val>) {
        page?.set(*changes)
    }

    /** `$state` now. */
    fun state(): Map<String, Val> = page?.state() ?: emptyMap()

    /** The page as Markdown, with the values it has now. */
    fun markdown(): String = page?.markdown() ?: ""

    /** Calls a fn the document exposes, on its channel (`app`, or in full). */
    fun expose(channelName: String, name: String, vararg args: Val) {
        page?.expose(channel(channelName), name, *args)
    }

    /** Everything the page holds now. */
    fun snapshot(): Snapshot? = page?.let { Snapshot(RELEASE, irHash, it.stateJson(), it.ownJson()) }

    /** Puts a snapshot back: with the same IR all of it, with another `$state` only, as one checked write. */
    fun restore(snap: Snapshot): Restored {
        val p = page ?: return Restored(Restored.How.NONE, emptyList(), "the page isn't loaded yet")
        if (snap.xtmd != RELEASE) return Restored(Restored.How.NONE, emptyList(), "a snapshot this xtmd ($RELEASE) can't read")
        p.setJson(snap.stateJson)
        val o = p.takeOutcome()
        for (f in o.failures) told(DocError.Failed(f))
        if (o.refused.isNotEmpty()) {
            for (r in o.refused) told(DocError.Refused(r))
            return Restored(Restored.How.NONE, o.refused.map { it.site ?: it.rule ?: "\$state" }, o.refused.first().let { it.rule ?: it.code })
        }
        if (snap.ir != irHash) return Restored(Restored.How.STATE, listOf("own"))
        return Restored(Restored.How.ALL, p.restoreOwn(snap.ownJson))
    }
}

@Composable
fun rememberXtmdDocState(): XtmdDocState = remember { XtmdDocState() }

/** `$state` as the app gives it, checked as an app's write is: all together, or else each field
 * that fits and keeps the rules, one at a time. What was refused goes to [tell]. */
internal fun give(page: CompiledPage, given: Map<String, Val>, tell: ((DocError) -> Unit)?) {
    if (given.isEmpty()) return
    val fields = page.state().keys
    val known = given.filterKeys { it in fields }
    if (tell != null) for (k in given.keys - fields) tell(DocError.Refused(Broken(code = "contracts.outside", rule = null, site = "\$state.$k")))
    if (known.isEmpty()) return
    page.set(*known.toList().toTypedArray())
    val o = page.takeOutcome()
    val failed = o.failures.toMutableList()
    if (o.refused.isNotEmpty()) {
        for ((k, v) in known) {
            page.set(k to v)
            val one = page.takeOutcome()
            if (tell != null) for (r in one.refused) tell(DocError.Refused(r))
            failed += one.failures
        }
    }
    if (tell != null) for (f in failed) tell(DocError.Failed(f))
}

/**
 * An Extended Mark document. `ir` is its IR in hand (the JSON `xtmd build` writes), or `src` an IR file in
 * the app's assets. `state` with `onStateChange` controls `$state`, or `defaultState` starts it,
 * or `defaultSnapshot` everything; every write is checked by xtmd, and what it refuses reaches
 * `onError`. A new `ir` keeps `$state` where its fields still exist. `fns` are the app's value
 * fns, `externs` each channel's values by its name (`app`) or in full, `widgets` a pack's own.
 * [docState] is the app's handle: `snapshot`, `restore`, `set`, `state`, `markdown`, `expose`.
 */
@Composable
fun XtmdDoc(
    ir: String? = null,
    src: String? = null,
    modifier: Modifier = Modifier,
    state: Map<String, Val>? = null,
    onStateChange: (Map<String, Val>) -> Unit = {},
    defaultState: Map<String, Val> = emptyMap(),
    defaultSnapshot: Snapshot? = null,
    width: String? = null,
    theme: String? = null,
    externs: Map<String, Map<String, Val>> = emptyMap(),
    fns: Map<String, (List<Val>) -> Val?> = emptyMap(),
    widgets: Externs = Externs.None,
    onError: (DocError) -> Unit = {},
    onCalls: (List<ExternCall>) -> Unit = {},
    docState: XtmdDocState = rememberXtmdDocState(),
    measure: Measure? = null,
    colors: (dark: Boolean) -> ColorScheme = XtmdTheme::colors,
    /** Where the reader is in time, for `core/moment.local`: the device's zone. */
    zone: Zone = DeviceZone,
    /** For the checks only: the runtime's defects to switch on. */
    defects: List<String> = emptyList(),
) {
    val context = LocalContext.current
    val latestError by rememberUpdatedState(onError)
    val latestState by rememberUpdatedState(onStateChange)
    val latestCalls by rememberUpdatedState(onCalls)
    val latestFns by rememberUpdatedState(fns)
    val latestExterns by rememberUpdatedState(externs)
    docState.told = { latestError(it) }
    // the `$state` the app last heard, and the one it last gave
    val heard = remember { arrayOf<Map<String, Val>?>(null, null) }

    LaunchedEffect(ir, src) {
        val text = ir ?: src?.let { name ->
            runCatching { context.assets.open(name).bufferedReader().use { it.readText() } }.getOrElse {
                latestError(DocError.Load("the page at $name couldn't be loaded: ${it.message}"))
                return@LaunchedEffect
            }
        } ?: return@LaunchedEffect
        val before = docState.page
        // the app's fns, read when they are called: always the latest
        val names = latestFns.keys
        val opts = PageOptions(
            width = width,
            theme = theme,
            externs = latestExterns.mapKeys { (c, _) -> channel(c) },
            supplies = (registry + widgets.widgets).keys,
            fns = names.associateWith { n -> { args: List<Val> -> latestFns[n]?.invoke(args) } },
            zone = zone,
            defects = defects,
        )
        // mounted here, on the main thread, as the effect runs: a page's IR holds only what it uses,
        // so it is quick, and the page is there by the next frame
        val page = runCatching { CompiledPage.fromJson(text, opts) }.getOrElse {
            latestError(DocError.Load("the page couldn't start: ${it.message}"))
            return@LaunchedEffect
        }
        docState.irHash = hash(text)
        if (before == null && defaultSnapshot != null && state == null) {
            docState.page = page
            docState.restore(defaultSnapshot)
        } else {
            // a new IR keeps `$state` where its fields still exist; the app's, controlled, wins
            val given = state ?: before?.state() ?: defaultState
            give(page, given, if (before == null || state != null) { e -> latestError(e) } else null)
            docState.page = page
        }
        heard[0] = page.state()
        heard[1] = state
    }

    val page = docState.page
    if (page == null) {
        Box(modifier)
        return
    }

    // what the page did reaches the app after each change: `$state`, the calls, the refusals
    LaunchedEffect(page) {
        snapshotFlow { page.changes to page.revision }.collect {
            val now = page.state()
            if (now != heard[0]) {
                heard[0] = now
                latestState(now)
            }
            val calls = page.takeCalls()
            if (calls.isNotEmpty()) latestCalls(calls)
            val o = page.takeOutcome()
            for (r in o.refused) latestError(DocError.Refused(r))
            for (f in o.failures) latestError(DocError.Failed(f))
        }
    }
    // controlled: a new `state` from the app is a checked write; refused, the page keeps the last that fit
    LaunchedEffect(page, state) {
        if (state != null && state != heard[1] && state != page.state()) page.set(*state.toList().toTypedArray())
        heard[1] = state
    }
    LaunchedEffect(page, width, theme) {
        if (width != null || theme != null) page.setPage(width, theme)
    }
    // a channel whose values changed since the page had them
    val sent = remember(page) { HashMap(latestExterns) }
    LaunchedEffect(page, externs) {
        for ((c, values) in externs) {
            if (sent[c] == values) continue
            page.setExtern(channel(c), values)
            sent[c] = values
        }
    }
    key(page) {
        XtmdPage(page, widgets, modifier, measure, colors)
    }
}

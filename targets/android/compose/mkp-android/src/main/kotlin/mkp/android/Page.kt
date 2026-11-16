package mkp.android

import android.content.Context
import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.util.TimeZone
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import mkp.android.ffi.ExternCall
import mkp.android.ffi.Field
import mkp.android.ffi.Measure
import mkp.android.ffi.NativePage
import mkp.android.ffi.Node
import mkp.android.ffi.PageInit
import mkp.android.ffi.Slot
import mkp.android.ffi.Val
import mkp.android.ffi.Zone

/** The reader's own zone, summer time included: what `core/moment.local` gives on a phone. */
object DeviceZone : Zone {
    override fun offsetMinutes(utcMinutes: Long): Int = TimeZone.getDefault().getOffset(utcMinutes * 60_000) / 60_000
}

/** UTC, the checks' zone, so every target's observation agrees. */
object UtcZone : Zone {
    override fun offsetMinutes(utcMinutes: Long): Int = 0
}

/**
 * How a page starts: what the app tells it. `width` is `NARROW`, `MEDIUM` or `WIDE`; `theme` is
 * `LIGHT` or `DARK` (left out, the page draws in the system's mode and MKP code reads no theme).
 */
data class PageOptions(
    val width: String? = null,
    val theme: String? = null,
    /** `$state`'s values, over its starting ones. */
    val state: Map<String, Val> = emptyMap(),
    /** Each channel's values: `"doc/scores" to mapOf("unit" to V.text("pts"))`. */
    val externs: Map<String, Map<String, Val>> = emptyMap(),
    val zone: Zone = DeviceZone,
    /** The extern widgets drawn, by full name, or a whole pack as `pack/` and a star: left out, the default registry's. MkpPage
     * sets it from the registry it draws with. */
    val supplies: Collection<String>? = null,
    /** For the checks only: the test targets' defects. */
    val defects: List<String> = emptyList(),
)

private fun json(m: Map<String, Val>): String = m.entries.joinToString(",", "{", "}") { (k, v) -> "${quote(k)}:${v.toIrJson()}" }

internal fun quote(s: String): String = Val.Text(s).toIrJson().removePrefix("{\"text\":").removeSuffix("}")

/** Work running off the main thread, on every page (pages loading, drags' writes, the planes' layouts). A test
 * waits until there are none: `registerIdlingResource { MkpWork.idle }`, as the check adapters do. */
object MkpWork {
    internal val running = java.util.concurrent.atomic.AtomicInteger(0)
    val idle: Boolean get() = running.get() == 0
}

/** Where a page's time went on the Kotlin side: calls that change it (the runtime's work included),
 * and reading its tree back after a redraw. For measuring; `native.timings()` splits the rest. */
class PageStats {
    var changeNanos = 0L
    var changes = 0
    var treeNanos = 0L
    var trees = 0
    /** How many times a widget's composable ran. */
    var draws = 0L
    /** Time in the plane's layout (part of [changeNanos]). */
    var layoutNanos = 0L
    /** Nodes a tree update left as they were, and nodes it sent whole. */
    var kept = 0L
    var sent = 0L
}

/** Told of what the reader does through the widgets' contexts, and of what each layout wrote: the
 * checks (omnicui's widget contracts) report a widget's events and writes from it. */
interface PageWatcher {
    fun event(path: String, name: String, args: List<Val>) {}
    fun write(path: String, input: String, value: Val) {}
    /** The tree before and after a layout, which may have written spots' boxes and planes' values. */
    fun laidOut(before: List<Node>, after: List<Node>) {}
}

/**
 * A page running on MKP's native runtime: built from the IR `mkp build` writes. Compose reads its
 * [tree] and redraws when [revision] moves; the app writes to it through [set], [expose],
 * [setExtern] and [setPage], and reads [markdown], [state] and the extern calls it made.
 * Every change is one transaction in the runtime, checked, and undone when it fails.
 */
class CompiledPage(val native: NativePage, supplies: Collection<String>?, theme: String? = null) {
    /** The page's theme as the app set it (`LIGHT`, `DARK`), or `null`: the system's mode. */
    var theme: String? by mutableStateOf(theme)
        private set

    /** The drawn extern widgets, as the runtime worked them out on its last draw. */
    var tree: List<Node> by mutableStateOf(native.tree())
        private set

    /** How many times the page has been drawn. */
    var revision: Long by mutableLongStateOf(native.revision().toLong())
        private set

    /** How many changes came from outside the layout: the reader's, the app's. The planes are laid
     * out once after each, and again when a spot's measured size changes, never after their own
     * layout's redraw (which could go on for ever). */
    var changes: Long by mutableLongStateOf(native.changes().toLong())
        private set

    internal var supplies: List<String>? = supplies?.toList()
        private set

    /** Whether a plane or a spot (or anything in one) changed since the planes were last laid out:
     * a page read whole counts as one. */
    internal var planesTouched = true

    /** Whether the tree holds a plane, whose spots are laid out after each draw. */
    internal var hasPlanes = planes(tree)
        private set

    /** The widgets on screen now, by path, as each composable says when it enters and leaves. */
    private val onScreen = HashMap<String, Int>()

    /** Every path a composable is drawing now: the checks observe only these. */
    val drawn: Set<String> get() = onScreen.filterValues { it > 0 }.keys

    internal fun entered(path: String) {
        onScreen[path] = (onScreen[path] ?: 0) + 1
    }

    internal fun left(path: String) {
        val n = (onScreen[path] ?: 0) - 1
        if (n <= 0) onScreen.remove(path) else onScreen[path] = n
    }

    /** Where this page's time went, for measuring. */
    val stats = PageStats()

    /** The nodes drawn now, by key: what a stub in a tree update stands for. */
    private var byKey: Map<String, Node> = index(tree)

    /**
     * The tree after a redraw, from the runtime's update: a widget that is as it was (and everything
     * in it) comes as a stub, and stays the very node this page already holds, so Compose skips
     * it; only what changed crossed from Rust. A stub this page can't place means the full tree.
     */
    private fun update(nodes: List<Node>): List<Node> {
        var missing = false
        fun resolve(n: Node): Node {
            if (n.same) stats.kept++ else stats.sent++
            if (n.same) return byKey[n.key] ?: n.also { missing = true }
            if (n.widget == "core/plane" || n.widget == "core/spot") planesTouched = true
            if (n.slots.isEmpty()) return n
            return n.copy(slots = n.slots.map { s -> Slot(s.name, s.nodes.map(::resolve)) })
        }
        val out = nodes.map(::resolve)
        val tree = if (missing) native.tree().also { planesTouched = true } else out
        byKey = index(tree)
        return tree
    }

    /** Runs a change on the native page, then reads the tree again if it was redrawn. */
    fun <T> change(block: (NativePage) -> T): T {
        val started = System.nanoTime()
        try {
            return block(native)
        } finally {
            stats.changeNanos += System.nanoTime() - started
            stats.changes++
            refresh()
        }
    }

    /**
     * A change made off the main thread: the runtime's work (the write, its redraw) runs on a
     * background thread while the main one keeps drawing frames, and the tree is read back on the
     * main thread when it is done. Call it from the main thread. The page is behind a lock, so a
     * call from the main thread meanwhile waits for it; a drag keeps at most one in flight.
     */
    suspend fun <T> changeAway(block: (NativePage) -> T): T {
        MkpWork.running.incrementAndGet()
        val started = System.nanoTime()
        try {
            return withContext(Dispatchers.Default) { block(native) }
        } finally {
            stats.changeNanos += System.nanoTime() - started
            stats.changes++
            refresh()
            MkpWork.running.decrementAndGet()
        }
    }

    /** A widget's write, made off the main thread ([changeAway]): what a drag writes. */
    suspend fun writeAway(path: String, input: String, value: Val) {
        watcher?.write(path, input, value)
        changeAway { it.write(path, input, value) }
    }

    /** Reads the tree again when the page was drawn since: after any call into the page. */
    fun refresh() {
        val r = native.revision().toLong()
        changes = native.changes().toLong()
        if (r != revision) {
            if (TRACE) System.err.println("[mkp] revision $revision -> $r")
            val started = System.nanoTime()
            tree = update(native.treeUpdate(revision.toULong()))
            stats.treeNanos += System.nanoTime() - started
            stats.trees++
            hasPlanes = planes(tree)
            revision = r
        }
        for (e in native.takeErrors()) Log.w("mkp", e)
    }

    // ---- what the app does

    /** The app's write to `$state`: one change, checked once. */
    fun set(vararg changes: Pair<String, Val>) = change { it.set(changes.map { (k, v) -> Field(k, v) }) }

    /** The app calling a fn the document exposes. */
    fun expose(channel: String, name: String, vararg args: Val) = change { it.expose(channel, name, args.toList()) }

    /** The app giving a channel's values. */
    fun setExtern(channel: String, values: Map<String, Val>) = change { it.setExtern(channel, values.map { (k, v) -> Field(k, v) }) }

    /** The page's own values. */
    fun setPage(width: String?, theme: String?) {
        if (theme != null) this.theme = theme
        change { it.setPage(width, theme) }
    }

    /** The extern widgets drawn, by full name, or a whole pack as `pack/` and a star. */
    fun setSupplies(list: Collection<String>?) {
        val l = list?.sorted()
        if (l == supplies?.sorted()) return
        supplies = l
        change { it.setSupplies(l) }
    }

    /** For the checks: told of the reader's events and writes, and of each layout's. */
    var watcher: PageWatcher? = null

    /** Lays the planes out from a measure (MkpPage does it after every change). */
    fun layout(measure: Measure) {
        val before = tree
        val started = System.nanoTime()
        change { it.layout(measure) }
        stats.layoutNanos += System.nanoTime() - started
        watcher?.laidOut(before, tree)
    }

    /** [layout], off the main thread ([changeAway]): the measure is called on a background thread. */
    suspend fun layoutAway(measure: Measure) {
        val before = tree
        val started = System.nanoTime()
        changeAway { it.layout(measure) }
        stats.layoutNanos += System.nanoTime() - started
        watcher?.laidOut(before, tree)
    }

    /** The page as Markdown, with the values it has now. */
    fun markdown(): String = native.markdown()

    /** One of `$state`'s values. */
    fun state(name: String): Val? = native.state(name)

    /** The app's extern fns MKP called since they were last taken. */
    fun takeCalls(): List<ExternCall> = native.takeCalls()

    /** The extern widgets the page uses that nothing here draws: each shows its Markdown. */
    val missing: List<String> get() = native.missing()

    companion object {
        /** A page from the IR `mkp build` writes, as JSON text. */
        fun fromJson(ir: String, options: PageOptions = PageOptions()): CompiledPage {
            val supplies = options.supplies ?: registry.keys
            val init = PageInit(
                width = options.width,
                theme = options.theme,
                stateJson = options.state.takeIf { it.isNotEmpty() }?.let(::json),
                externsJson = options.externs.takeIf { it.isNotEmpty() }?.let { m -> m.entries.joinToString(",", "{", "}") { (c, v) -> "${quote(c)}:${json(v)}" } },
                supplies = supplies.toList(),
                defects = options.defects,
            )
            return CompiledPage(NativePage(ir, init, options.zone), supplies, options.theme)
        }

        /** A page from an IR file in the app's assets. It reads and mounts the page where it is
         * called: on a phone that is a fraction of a second for a page with all of core in its IR,
         * so call [loadAsset] from the main thread instead. */
        fun fromAsset(context: Context, name: String, options: PageOptions = PageOptions()): CompiledPage =
            fromJson(context.assets.open(name).bufferedReader().use { it.readText() }, options)

        /** [fromJson], off the main thread: the IR is read and the page mounted on a background one. */
        suspend fun load(ir: String, options: PageOptions = PageOptions()): CompiledPage = away(Dispatchers.Default) { fromJson(ir, options) }

        /** [fromAsset], off the main thread. */
        suspend fun loadAsset(context: Context, name: String, options: PageOptions = PageOptions()): CompiledPage =
            away(Dispatchers.IO) { fromAsset(context, name, options) }

        /** Work on another thread, counted in [MkpWork] while it runs. */
        private suspend fun <T> away(on: kotlinx.coroutines.CoroutineDispatcher, block: () -> T): T {
            MkpWork.running.incrementAndGet()
            try {
                return withContext(on) { block() }
            } finally {
                MkpWork.running.decrementAndGet()
            }
        }

        private fun index(nodes: List<Node>): Map<String, Node> {
            val out = HashMap<String, Node>()
            fun walk(ns: List<Node>) {
                for (n in ns) {
                    out[n.key] = n
                    for (s in n.slots) walk(s.nodes)
                }
            }
            walk(nodes)
            return out
        }

        private fun planes(nodes: List<Node>): Boolean = nodes.any { it.widget == "core/plane" || it.slots.any { s -> planes(s.nodes) } }
    }
}

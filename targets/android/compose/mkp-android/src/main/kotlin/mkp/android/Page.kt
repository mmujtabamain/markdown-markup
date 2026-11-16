package mkp.android

import android.content.Context
import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.util.TimeZone
import mkp.android.ffi.ExternCall
import mkp.android.ffi.Field
import mkp.android.ffi.Measure
import mkp.android.ffi.NativePage
import mkp.android.ffi.Node
import mkp.android.ffi.PageInit
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

    /** Runs a change on the native page, then reads the tree again if it was redrawn. */
    fun <T> change(block: (NativePage) -> T): T {
        try {
            return block(native)
        } finally {
            refresh()
        }
    }

    /** Reads the tree again when the page was drawn since: after any call into the page. */
    fun refresh() {
        val r = native.revision().toLong()
        changes = native.changes().toLong()
        if (r != revision) {
            if (TRACE) System.err.println("[mkp] revision $revision -> $r")
            tree = native.tree()
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
        change { it.layout(measure) }
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

        /** A page from an IR file in the app's assets. */
        fun fromAsset(context: Context, name: String, options: PageOptions = PageOptions()): CompiledPage =
            fromJson(context.assets.open(name).bufferedReader().use { it.readText() }, options)

        private fun planes(nodes: List<Node>): Boolean = nodes.any { it.widget == "core/plane" || it.slots.any { s -> planes(s.nodes) } }
    }
}

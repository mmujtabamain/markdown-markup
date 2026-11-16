package mkp.android

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.SemanticsPropertyKey
import androidx.compose.ui.semantics.SemanticsPropertyReceiver
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import mkp.android.ffi.Extent
import mkp.android.ffi.Measure
import mkp.android.ffi.Node
import mkp.android.ffi.Val
import mkp.android.widgets.*

/** One extern widget's composable: given its props and its context, it draws the widget. */
fun interface Widget {
    @Composable
    fun Draw(props: Props, ctx: WidgetContext)
}

/** What an app gives MkpPage besides the page: its own widgets, by full name, which replace ours
 * (`core/press`) or add a pack's (`acme/chart`). */
class Externs(val widgets: Map<String, Widget> = emptyMap()) {
    companion object {
        val None = Externs()
    }
}

/** Our default widgets, by full name: every core extern widget, and the runtime's notice. */
val registry: Map<String, Widget> = mapOf(
    // blocks
    "core/paragraph" to Widget { p, c -> MkpParagraph(p, c) },
    "core/heading" to Widget { p, c -> MkpHeading(p, c) },
    "core/bullets" to Widget { p, c -> MkpBullets(p, c) },
    "core/item" to Widget { p, c -> MkpItem(p, c) },
    "core/quote" to Widget { p, c -> MkpQuote(p, c) },
    "core/code" to Widget { p, c -> MkpCode(p, c) },
    "core/math" to Widget { p, c -> MkpMath(p, c) },
    "core/table" to Widget { p, c -> MkpTable(p, c) },
    "core/footnote" to Widget { p, c -> MkpFootnote(p, c) },
    "core/divider" to Widget { p, c -> MkpDivider(p, c) },
    // controls
    "core/label" to Widget { p, c -> MkpLabel(p, c) },
    "core/image" to Widget { p, c -> MkpImage(p, c) },
    "core/icon" to Widget { p, c -> MkpIcon(p, c) },
    "core/press" to Widget { p, c -> MkpPress(p, c) },       // a Material 3 button, chip, tab, checkbox, switch or radio
    "core/field" to Widget { p, c -> MkpField(p, c) },
    "core/slider" to Widget { p, c -> MkpSlider(p, c) },     // writes go through ctx.write("value", …)
    "core/overlay" to Widget { p, c -> MkpOverlay(p, c) },
    // layout
    "core/flex" to Widget { p, c -> MkpFlex(p, c) },
    "core/grid" to Widget { p, c -> MkpGrid(p, c) },
    "core/cell" to Widget { p, c -> MkpCell(p, c) },
    "core/sizing" to Widget { p, c -> MkpSizing(p, c) },
    "core/plane" to Widget { p, c -> MkpPlane(p, c) },
    "core/spot" to Widget { p, c -> MkpSpot(p, c) },
    // gfx
    "core/canvas" to Widget { p, c -> MkpCanvas(p, c) },
    "core/layer" to Widget { p, c -> MkpLayer(p, c) },
    "core/circle" to Widget { p, c -> MkpCircle(p, c) },
    "core/path" to Widget { p, c -> MkpPath(p, c) },
    "core/place" to Widget { p, c -> MkpPlace(p, c) },
    "core/handle" to Widget { p, c -> MkpHandle(p, c) },
    "core/shade" to Widget { p, c -> MkpShade(p, c) },
    // the runtime's notice for a widget that failed
    "#notice" to Widget { p, c -> MkpNotice(p, c) },
)

/** A drawn widget's props, as the page worked them out. */
class Props(val node: Node) {
    operator fun get(name: String): Val? = node.props[name]
    fun text(name: String): String = get(name).str()
    fun flag(name: String, or: Boolean = false): Boolean = get(name).flag(or)
    fun num(name: String): Double? = get(name).num()
    fun case(name: String): String? = get(name).case()

    /** A slot's widgets, in order. */
    fun slot(name: String): List<Node> = node.slots.firstOrNull { it.name == name }?.nodes ?: emptyList()
    val path: String get() = node.path
    val widget: String get() = node.widget
}

/** What a widget can do on the page it is drawn on. */
class WidgetContext internal constructor(val page: CompiledPage, internal val scope: MkpScope, node: Node) {
    var node: Node = node
        internal set
    val path: String get() = node.path

    /** The reader's event on this widget: runs the caller's handler, as one change. */
    fun event(name: String, args: List<Val> = emptyList()) {
        page.watcher?.event(path, name, args)
        page.change { it.event(path, name, args) }
    }

    /** This widget writing one of its `mut` inputs, as a slider does: checked, then one change.
     * A refused write leaves the value as it was. */
    fun write(input: String, value: Val) {
        page.watcher?.write(path, input, value)
        page.change { it.write(path, input, value) }
    }

    /** Whether the caller set this event to a handler that does something: what makes it clickable. */
    fun listens(event: String): Boolean = event in node.listens

    /** A slot's widgets, drawn one after another, each kept by its key. */
    @Composable
    fun Children(nodes: List<Node>) {
        for (n in nodes) key(n.key) { DrawNode(n) }
    }

    /** One widget of a slot. */
    @Composable
    fun Child(n: Node) {
        key(n.key) { DrawNode(n) }
    }

    /** Blocks as a flow: each after the one before, with the page's space between them. */
    @Composable
    fun Flow(nodes: List<Node>, modifier: Modifier = Modifier) {
        Column(modifier, verticalArrangement = Arrangement.spacedBy(12.dp)) { Children(nodes) }
    }
}

internal val TRACE = System.getenv("MKP_ANDROID_TRACE") != null

internal class MkpScope(val page: CompiledPage, val widgets: Map<String, Widget>, val sizes: SpotSizes)

internal val LocalMkp = staticCompositionLocalOf<MkpScope?> { null }

/** The site a widget's root is drawn at: its path, in the semantics tree, for the checks. */
val MkpSite = SemanticsPropertyKey<String>("MkpSite")
var SemanticsPropertyReceiver.mkpSite by MkpSite

/** A widget's root: its site, and its part name for omnicui's contracts (`slider`, `press`). */
fun Modifier.site(ctx: WidgetContext, part: String): Modifier = this.semantics { mkpSite = ctx.path }.testTag(part)

/** One drawn widget: its composable from the registry, or a notice when nobody supplies it. */
@Composable
fun DrawNode(node: Node) {
    val scope = LocalMkp.current ?: error("DrawNode outside MkpPage")
    val ctx = remember(scope) { WidgetContext(scope.page, scope, node) }
    ctx.node = node
    DisposableEffect(scope.page, node.path) {
        scope.page.entered(node.path)
        onDispose { scope.page.left(node.path) }
    }
    val w = scope.widgets[node.widget]
    if (w == null) Notice("Nothing draws ${node.widget} here: its widget isn't supplied.", ctx) else w.Draw(Props(node), ctx)
}

@Composable
internal fun Notice(message: String, ctx: WidgetContext) {
    Text(
        message,
        Modifier.site(ctx, "notice").fillMaxWidth()
            .background(MaterialTheme.colorScheme.errorContainer, RoundedCornerShape(8.dp))
            .padding(8.dp)
            .semantics { liveRegion = LiveRegionMode.Polite },
        color = MaterialTheme.colorScheme.onErrorContainer,
        style = MaterialTheme.typography.bodyMedium,
    )
}

@Composable
fun MkpNotice(props: Props, ctx: WidgetContext) = Notice(props.text("message"), ctx)

/** Each spot's child's size as Compose measured it, in dp, and each plane's width: the plane's
 * layout reads them. [version] moves when one changes, so the layout runs again. */
class SpotSizes {
    internal val spots = HashMap<String, Extent>()
    internal val planes = HashMap<String, Double>()
    var version by mutableIntStateOf(0)
        internal set

    internal fun spot(path: String, e: Extent) {
        if (spots[path] != e) {
            if (TRACE) System.err.println("[mkp] spot $path ${spots[path]} -> $e")
            spots[path] = e
            version++
        }
    }

    internal fun plane(path: String, w: Double) {
        if (planes[path] != w) {
            if (TRACE) System.err.println("[mkp] plane $path ${planes[path]} -> $w")
            planes[path] = w
            version++
        }
    }

    /** Whether Compose has measured every spot and plane in a tree: the layout waits for it, so
     * its first boxes are the real ones, not a size of nothing written and then put right. */
    internal fun ready(nodes: List<Node>): Boolean = nodes.all { n ->
        (n.widget != "core/spot" || spots.containsKey(n.path)) && (n.widget != "core/plane" || planes.containsKey(n.path)) && n.slots.all { ready(it.nodes) }
    }

    /** The measure Compose's own sizes give. */
    val measure: Measure = object : Measure {
        override fun spot(spot: Node): Extent = spots[spot.path] ?: Extent(0.0, 0.0)
        override fun planeWidth(plane: Node): Double = planes[plane.path] ?: 0.0
    }
}

/**
 * Draws a page with Compose, and keeps it drawn: each extern widget by the registry's composable,
 * kept by its key across redraws, so a loop row's widgets follow its item. The planes are laid
 * out after every draw, from the sizes Compose measured, or from [measure] when it is given (the
 * checks give fixed sizes).
 *
 * [colors] are the Material 3 colour schemes it draws with, light and dark; the page's `theme`
 * picks one, and with none set, the system's mode does.
 */
@Composable
fun MkpPage(
    page: CompiledPage,
    externs: Externs = Externs.None,
    modifier: Modifier = Modifier,
    measure: Measure? = null,
    colors: (dark: Boolean) -> ColorScheme = MkpTheme::colors,
) {
    val widgets = remember(externs) { registry + externs.widgets }
    // the runtime shows the Markdown of whatever the registry doesn't draw
    SideEffect { page.setSupplies(widgets.keys) }
    val sizes = remember(page) { SpotSizes() }
    val scope = remember(page, widgets, sizes) { MkpScope(page, widgets, sizes) }
    val dark = when (page.theme) {
        "DARK" -> true
        "LIGHT" -> false
        else -> isSystemInDarkTheme()
    }
    MaterialTheme(colorScheme = colors(dark)) {
        CompositionLocalProvider(
            LocalMkp provides scope,
            LocalMkpDark provides dark,
            LocalContentColor provides MaterialTheme.colorScheme.onSurface,
            LocalTextStyle provides MaterialTheme.typography.bodyLarge,
        ) {
            val ctx = remember(scope) { WidgetContext(page, scope, Node("", "", "#page", emptyMap(), emptyList(), emptyList(), emptyList(), emptyList())) }
            ctx.Flow(page.tree, modifier.background(MaterialTheme.colorScheme.surface))
        }
    }
    // the plane's layout, after each change from outside, and whenever a spot's measured size changes
    val changes = page.changes
    val version = sizes.version
    LaunchedEffect(page, changes, version, measure) {
        if (!page.hasPlanes) return@LaunchedEffect
        // a spot not measured yet is measured on this frame: then `version` moves and this runs
        // again; one that never is (nothing draws it) doesn't hold the layout up past the frame
        if (measure == null && !sizes.ready(page.tree)) withFrameNanos { }
        page.layout(measure ?: sizes.measure)
    }
}

package xtmd.android.widgets

import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.drawOutline
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import xtmd.android.Props
import xtmd.android.WidgetContext
import xtmd.android.case
import xtmd.android.color
import xtmd.android.ffi.Node
import xtmd.android.ffi.Val
import xtmd.android.field
import xtmd.android.inner
import xtmd.android.items
import xtmd.android.length
import xtmd.android.num
import xtmd.android.site

// Layout: flex as a Row, a Column or a FlowRow, grid as a Layout of its own with column tracks,
// cell as a grid item, and sizing as the flex item whose weight and limits it says. Lengths are
// core's tokens, in dp.

/** How a sizing tells the Row or Column around it to share out room: its weight there. */
internal class FlexItem(val weight: (Float) -> Modifier, val across: Boolean)

internal val LocalFlexItem = compositionLocalOf<FlexItem?> { null }

/** The look flex and grid share: padding, fill, stroke on its edges, radius and shadow. */
@Composable
internal fun boxed(p: Props): Modifier {
    val radius = p["radius"].inner()
    val shape: Shape = when {
        radius == null -> RoundedCornerShape(0.dp)
        radius is Val.Case && radius.name == "PILL" -> CircleShape
        else -> RoundedCornerShape(length(radius) ?: 0.dp)
    }
    var m: Modifier = Modifier
    if (p["shadow"].inner() != null) m = m.shadow(1.dp, shape, clip = false)
    color(p["fill"])?.let { m = m.background(it, shape) }
    val stroke = color(p["stroke"])
    if (stroke != null) {
        val sides = when (p.case("edge")) {
            "TOP" -> listOf(true, false, false, false)
            "RIGHT" -> listOf(false, true, false, false)
            "BOTTOM" -> listOf(false, false, true, false)
            "LEFT" -> listOf(false, false, false, true)
            "X" -> listOf(false, true, false, true)
            "Y" -> listOf(true, false, true, false)
            else -> null
        }
        m = if (sides == null) {
            m.drawBehind {
                val o = shape.createOutline(size, layoutDirection, this)
                drawOutline(o, stroke, style = Stroke(1.dp.toPx()))
            }
        } else {
            m.drawBehind {
                val w = 1.dp.toPx()
                val h = w / 2
                if (sides[0]) drawLine(stroke, Offset(0f, h), Offset(size.width, h), w)
                if (sides[1]) drawLine(stroke, Offset(size.width - h, 0f), Offset(size.width - h, size.height), w)
                if (sides[2]) drawLine(stroke, Offset(0f, size.height - h), Offset(size.width, size.height - h), w)
                if (sides[3]) drawLine(stroke, Offset(h, 0f), Offset(h, size.height), w)
            }
        }
    }
    if (radius != null) m = m.clip(shape)
    length(p["pad"])?.let { m = m.padding(it) }
    return m
}

/** A container whose click does something: clickable, and reachable from the keyboard. */
internal fun Modifier.clicks(ctx: WidgetContext): Modifier =
    if (ctx.listens("click")) this.clickable(role = Role.Button) { ctx.event("click") } else this

/** A run of tabs, options or radios: a group a screen reader moves through as one. */
private fun grouped(nodes: List<Node>): Boolean {
    if (nodes.isEmpty() || nodes.any { it.widget != "core/press" }) return false
    val kinds = nodes.map { (it.props["kind"] as? Val.Case)?.name }.toSet()
    return kinds.size == 1 && kinds.first() in setOf("TAB", "OPTION", "RADIO")
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun XtmdFlex(p: Props, ctx: WidgetContext) {
    val across = p.case("axis") == "X"
    val gap = length(p["gap"]) ?: 0.dp
    val kids = p.slot("children")
    val label = p.text("label")
    var m = Modifier.site(ctx, "flex").then(boxed(p)).clicks(ctx).semantics { if (label.isNotEmpty()) contentDescription = label }
    if (grouped(kids)) m = m.selectableGroup()
    val align = p.case("align") ?: "STRETCH"
    val justify = p.case("justify") ?: "START"
    if (across) {
        val h = when (justify) {
            "CENTER" -> Arrangement.spacedBy(gap, Alignment.CenterHorizontally)
            "END" -> Arrangement.spacedBy(gap, Alignment.End)
            "BETWEEN" -> Arrangement.SpaceBetween
            "AROUND" -> Arrangement.SpaceAround
            else -> Arrangement.spacedBy(gap)
        }
        val v = when (align) {
            "CENTER" -> Alignment.CenterVertically
            "END" -> Alignment.Bottom
            else -> Alignment.Top
        }
        if (p.flag("wrap")) {
            FlowRow(m, horizontalArrangement = h, verticalArrangement = Arrangement.spacedBy(gap), itemVerticalAlignment = v) {
                CompositionLocalProvider(LocalFlexItem provides FlexItem({ w -> Modifier.weight(w) }, true)) { ctx.Children(kids) }
            }
        } else {
            Row(m, horizontalArrangement = h, verticalAlignment = v) {
                CompositionLocalProvider(LocalFlexItem provides FlexItem({ w -> Modifier.weight(w) }, true)) { ctx.Children(kids) }
            }
        }
    } else {
        val v = when (justify) {
            "CENTER" -> Arrangement.spacedBy(gap, Alignment.CenterVertically)
            "END" -> Arrangement.spacedBy(gap, Alignment.Bottom)
            "BETWEEN" -> Arrangement.SpaceBetween
            "AROUND" -> Arrangement.SpaceAround
            else -> Arrangement.spacedBy(gap)
        }
        val h = when (align) {
            "CENTER" -> Alignment.CenterHorizontally
            "END" -> Alignment.End
            else -> Alignment.Start
        }
        Column(m, verticalArrangement = v, horizontalAlignment = h) {
            CompositionLocalProvider(LocalFlexItem provides FlexItem({ w -> Modifier.weight(w) }, false)) { ctx.Children(kids) }
        }
    }
}

/** One column track of a grid: a share of the room left, a fixed width, or its content's. */
private sealed class Track {
    data class Share(val fr: Float) : Track()
    data class Fixed(val width: Dp) : Track()
    data object Auto : Track()
}

private fun tracks(v: Val?): List<Track> {
    val c = v.inner() as? Val.Case ?: return listOf(Track.Share(1f))
    if (c.name == "EQUAL") return List(((c.field("count").num() ?: 1.0).toInt()).coerceIn(1, 12)) { Track.Share(1f) }
    return c.field("of").items().map { t ->
        when (t.case()) {
            "FR" -> Track.Share((t.field("share").num() ?: 1.0).toFloat())
            "CH" -> Track.Fixed(((t.field("count").num() ?: 1.0) * 8).dp)
            "SIZE" -> length(t.field("of"))?.let { Track.Fixed(it) } ?: Track.Auto
            else -> Track.Auto
        }
    }.ifEmpty { listOf(Track.Share(1f)) }
}

@Composable
fun XtmdGrid(p: Props, ctx: WidgetContext) {
    val cols = tracks(p["cols"])
    val gap = length(p["gap"]) ?: 0.dp
    val kids = p.slot("children")
    val alignItems = p.case("align") ?: "STRETCH"
    Layout(
        content = { ctx.Children(kids) },
        modifier = Modifier.site(ctx, "grid").then(boxed(p)).clicks(ctx),
    ) { measurables, constraints ->
        val gapPx = gap.roundToPx()
        val n = cols.size
        val width = if (constraints.hasBoundedWidth) constraints.maxWidth else 640.dp.roundToPx()
        // where each child goes: its row, its first column and its span (a cell says; the rest flow)
        data class At(val row: Int, val col: Int, val span: Int)
        val at = ArrayList<At>()
        var r = 0
        var c = 0
        kids.forEachIndexed { k, node ->
            val span = ((node.props["span"].num() ?: 1.0).toInt()).coerceIn(1, n)
            val col = node.props["col"].inner()?.num()?.toInt()?.minus(1)?.coerceIn(0, n - 1)
            val row = node.props["row"].inner()?.num()?.toInt()?.minus(1)
            if (col != null && col < c) { r++; c = 0 }
            if (col != null) c = col
            if (c + span > n) { r++; c = 0 }
            val place = At(row ?: r, c, minOf(span, n - c))
            at += place
            c += place.span
            if (c >= n) { r++; c = 0 }
            if (k >= measurables.size) return@forEachIndexed
        }
        // the columns' widths: fixed ones, the auto ones from their content, the shares from what is left
        val fixed = IntArray(n)
        for ((i, t) in cols.withIndex()) {
            fixed[i] = when (t) {
                is Track.Fixed -> t.width.roundToPx()
                is Track.Auto -> measurables.withIndex().filter { (k, _) -> at.getOrNull(k)?.let { it.col == i && it.span == 1 } == true }
                    .maxOfOrNull { (_, m) -> m.maxIntrinsicWidth(Constraints.Infinity) } ?: 0
                is Track.Share -> 0
            }
        }
        val shares = cols.sumOf { (it as? Track.Share)?.fr?.toDouble() ?: 0.0 }
        val left = (width - fixed.sum() - gapPx * (n - 1)).coerceAtLeast(0)
        val w = IntArray(n) { i -> (cols[i] as? Track.Share)?.let { (left * it.fr / shares).toInt() } ?: fixed[i] }
        val x = IntArray(n)
        for (i in 1 until n) x[i] = x[i - 1] + w[i - 1] + gapPx
        val placeables = measurables.mapIndexed { k, m ->
            val a = at.getOrElse(k) { At(0, 0, 1) }
            val cw = (a.col until a.col + a.span).sumOf { w[it] } + gapPx * (a.span - 1)
            m.measure(Constraints(minWidth = if (alignItems == "STRETCH") cw else 0, maxWidth = cw.coerceAtLeast(0)))
        }
        val rows = (at.maxOfOrNull { it.row } ?: -1) + 1
        val heights = IntArray(rows)
        placeables.forEachIndexed { k, pl -> val a = at.getOrElse(k) { At(0, 0, 1) }; heights[a.row] = maxOf(heights[a.row], pl.height) }
        val y = IntArray(rows)
        for (i in 1 until rows) y[i] = y[i - 1] + heights[i - 1] + gapPx
        val total = if (rows == 0) 0 else y[rows - 1] + heights[rows - 1]
        layout(width, total.coerceIn(constraints.minHeight, constraints.maxHeight)) {
            placeables.forEachIndexed { k, pl ->
                val a = at.getOrElse(k) { At(0, 0, 1) }
                val dy = when (alignItems) {
                    "CENTER" -> (heights[a.row] - pl.height) / 2
                    "END" -> heights[a.row] - pl.height
                    else -> 0
                }
                pl.place(x[a.col], y[a.row] + dy)
            }
        }
    }
}

@Composable
fun XtmdCell(p: Props, ctx: WidgetContext) {
    val align = when (p.case("place")) {
        "CENTER" -> Alignment.Center
        "END" -> Alignment.TopEnd
        else -> Alignment.TopStart
    }
    Box(Modifier.site(ctx, "cell").fillMaxWidth(), contentAlignment = align) { ctx.Children(p.slot("child")) }
}

@Composable
fun XtmdSizing(p: Props, ctx: WidgetContext) {
    val item = LocalFlexItem.current
    var m = Modifier.site(ctx, "sizing")
    val grow = p["grow"].inner()?.num()
    if (item != null && grow != null && grow > 0) m = m.then(item.weight(grow.toFloat()))
    val basis = length(p["basis"])
    if (basis != null && item != null) m = if (item.across) m.widthIn(min = basis) else m.heightIn(min = basis)
    val minW = length(p["min_width"])
    val maxW = length(p["max_width"])
    if (minW != null || maxW != null) m = m.widthIn(min = minW ?: Dp.Unspecified, max = maxW ?: Dp.Unspecified)
    val minH = length(p["min_height"])
    val maxH = length(p["max_height"])
    if (minH != null || maxH != null) m = m.heightIn(min = minH ?: Dp.Unspecified, max = maxH ?: Dp.Unspecified)
    p["aspect"].inner()?.num()?.let { m = m.aspectRatio(it.toFloat()) }
    CompositionLocalProvider(LocalFlexItem provides null) {
        Box(m) { ctx.Children(p.slot("child")) }
    }
}


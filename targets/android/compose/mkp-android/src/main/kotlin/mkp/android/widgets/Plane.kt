package mkp.android.widgets

import androidx.compose.foundation.border
import androidx.compose.foundation.focusable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.layoutId
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import kotlin.math.abs
import kotlin.math.roundToInt
import mkp.android.Props
import mkp.android.V
import mkp.android.WidgetContext
import mkp.android.XY
import mkp.android.ffi.Extent
import mkp.android.ffi.Val
import mkp.android.inner
import mkp.android.length
import mkp.android.num
import mkp.android.point
import mkp.android.region
import mkp.android.site

// The plane (plan tab 15): a clipped view holding one inner layer that graphicsLayer moves and
// scales for panning and zooming. A custom Layout places each spot at its point, by its anchor
// and nudge, in the plane's units (at zoom 1 one unit is one dp, y up); the background is drawn
// in the same layer. Boxes come from the runtime's placement maths on each spot's size from the
// measure pass, which the transform never changes. A drag pans and a pinch zooms
// (detectTransformGestures); each writes `center` or `zoom` through a checked write.

/** Where a spot sits: its point (nudged), in the plane's units, and its anchor. */
internal data class SpotAt(val x: Double, val y: Double, val anchor: String)

@Composable
fun MkpPlane(p: Props, ctx: WidgetContext) {
    val z = (p.num("zoom") ?: 1.0).takeIf { it > 0 } ?: 1.0
    val c = p["center"].point() ?: XY(0.0, 0.0)
    val aspect = (p.num("aspect") ?: 1.5).takeIf { it > 0 } ?: 1.5
    val given = length(p["width"].inner())
    val label = p.text("label")
    val sizes = ctx.scope.sizes
    val density = LocalDensity.current.density
    val items = p.slot("items")
    // how far the reader may zoom: zoom_range, counted from the zoom that fits bounds with `fit`
    val range = p["zoom_range"].inner() as? Val.Range
    val bounds = p["bounds"].region() ?: items.mapNotNull { it.props["box"].region() }.takeIf { it.isNotEmpty() }?.let { bs ->
        mkp.android.Box2(bs.minOf { it.x0 }, bs.minOf { it.y0 }, bs.maxOf { it.x1 }, bs.maxOf { it.y1 })
    }
    BoxWithConstraints(Modifier.site(ctx, "plane").let { if (given != null) it.width(given) else it.fillMaxWidth() }.semantics { if (label.isNotEmpty()) contentDescription = label }) {
        val wDp = (given?.value ?: maxWidth.value.takeIf { it.isFinite() } ?: 640f).toDouble()
        val hDp = wDp / aspect
        var base = 1.0
        if (p.flag("fit") && bounds != null && bounds.width > 0 && bounds.height > 0) base = minOf(wDp / bounds.width, wDp / aspect / bounds.height)
        val low = maxOf(0.1, (range?.low?.firstOrNull().num() ?: 1.0) * base)
        val high = minOf(10.0, (range?.high?.firstOrNull().num() ?: 1.0) * base)
        val now = rememberUpdatedState(Triple(z, c, low to high))
        /** The reader moving the view: the zoom first, so the centre is kept inside bounds for it. */
        fun move(center: XY, zoom: Double) {
            val (z0, c0, _) = now.value
            if (abs(zoom - z0) > 1e-9) {
                val nz = exactOf(zoom, 3)
                if (nz.toDouble() != z0) ctx.write("zoom", V.num(nz))
            }
            val places = placesFor(1 / zoom)
            val next = XY(exactOf(center.x, places).toDouble(), exactOf(center.y, places).toDouble())
            if (next.x != c0.x || next.y != c0.y) ctx.write("center", pointOf(center, places))
        }
        /** Zooms about a point of the view (px), which stays where it is. */
        fun zoomAt(ox: Float, oy: Float, want: Double) {
            val (z0, c0, lh) = now.value
            val nz = want.coerceIn(lh.first, lh.second)
            if (!(lh.second > lh.first) || abs(nz - z0) < 1e-6) return
            val dx = (ox / density - wDp / 2)
            val dy = (oy / density - hDp / 2)
            val u = XY(c0.x + dx / z0, c0.y - dy / z0)
            move(XY(u.x - dx / nz, u.y + dy / nz), nz)
        }
        val wPx = (wDp * density).toFloat()
        val hPx = (hDp * density).toFloat()
        // framed as @mkp/dom frames it: a line around the view, with the card's corners
        var view = Modifier.testTag("plane.view").size(wDp.dp, hDp.dp)
            .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(12.dp))
            .clip(RoundedCornerShape(12.dp))
            .onSizeChanged { sizes.plane(ctx.path, it.width / density.toDouble()) }
            .onKeyEvent { e ->
                if (e.type != KeyEventType.KeyDown) return@onKeyEvent false
                val (z0, c0, _) = now.value
                val step = 40 / z0
                when (e.key) {
                    Key.DirectionLeft -> move(XY(c0.x - step, c0.y), z0)
                    Key.DirectionRight -> move(XY(c0.x + step, c0.y), z0)
                    Key.DirectionUp -> move(XY(c0.x, c0.y + step), z0)
                    Key.DirectionDown -> move(XY(c0.x, c0.y - step), z0)
                    Key.Plus, Key.Equals, Key.NumPadAdd -> zoomAt(wPx / 2, hPx / 2, z0 * 1.25)
                    Key.Minus, Key.NumPadSubtract -> zoomAt(wPx / 2, hPx / 2, z0 / 1.25)
                    else -> return@onKeyEvent false
                }
                true
            }
            .focusable()
            .pointerInput(wPx, hPx) {
                // one finger (or the mouse) pans by how far it is from where it went down; two
                // pinch; the wheel zooms about the pointer
                awaitEachGesture {
                    val down = awaitFirstDown(requireUnconsumed = false)
                    val (_, c0, _) = now.value
                    var moved = false
                    var pinch: Pair<Float, Double>? = null
                    while (true) {
                        val e = awaitPointerEvent()
                        val pressed = e.changes.filter { it.pressed }
                        if (pressed.isEmpty()) break
                        if (pressed.size >= 2) {
                            val a = pressed[0].position
                            val b = pressed[1].position
                            val dist = (a - b).getDistance().coerceAtLeast(1f)
                            val start = pinch ?: (dist to now.value.first).also { pinch = it }
                            zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, start.second * dist / start.first)
                            pressed.forEach { it.consume() }
                            continue
                        }
                        val change = pressed.first()
                        if (change.isConsumed) continue
                        val d = change.position - down.position
                        if (!moved && d.getDistance() > viewConfiguration.touchSlop) moved = true
                        if (moved) {
                            val z0 = now.value.first
                            move(XY(c0.x - d.x / density / z0, c0.y + d.y / density / z0), z0)
                            change.consume()
                        }
                    }
                }
            }
        view = view.pointerInput(wPx, hPx) {
            awaitPointerEventScope {
                while (true) {
                    val e = awaitPointerEvent()
                    if (e.type != PointerEventType.Scroll) continue
                    val c = e.changes.firstOrNull() ?: continue
                    zoomAt(c.position.x, c.position.y, now.value.first * kotlin.math.exp(-c.scrollDelta.y * 0.15))
                    c.consume()
                }
            }
        }
        if (ctx.listens("click")) {
            view = view.pointerInput(wPx, hPx) {
                detectTapGestures { o: Offset ->
                    val (z0, c0, _) = now.value
                    val at = XY(c0.x + (o.x / density - wDp / 2) / z0, c0.y - (o.y / density - hDp / 2) / z0)
                    ctx.event("click", listOf(pointOf(at, placesFor(1 / z0))))
                }
            }
        }
        // the plane's units on the inner layer: one unit is one dp, y up, (0, 0) at its corner
        val space = remember(density, z) {
            Space(
                x = { u -> (u * density).toFloat() },
                y = { u -> (-u * density).toFloat() },
                len = { u -> (u * density).toFloat() },
                unit = { px, py -> XY(px / density.toDouble(), -py / density.toDouble()) },
                unitsPerDp = { 1 / z },
                keep = { q -> q },
            )
        }
        Box(view) {
            Box(
                Modifier.testTag("plane.inner").fillMaxSize().graphicsLayer {
                    transformOrigin = TransformOrigin(0f, 0f)
                    scaleX = z.toFloat()
                    scaleY = z.toFloat()
                    translationX = (wPx / 2 - c.x * z * density).toFloat()
                    translationY = (hPx / 2 + c.y * z * density).toFloat()
                },
            ) {
                CompositionLocalProvider(LocalSpace provides space) {
                    Box(Modifier.testTag("plane.background").fillMaxSize()) { ctx.Children(p.slot("background")) }
                }
                Layout(content = { ctx.Children(items) }, modifier = Modifier.testTag("plane.items").fillMaxSize()) { ms, cons ->
                    val placed = ms.map { it to it.measure(Constraints()) }
                    layout(cons.maxWidth, cons.maxHeight) {
                        for ((m, pl) in placed) {
                            val at = m.layoutId as? SpotAt ?: SpotAt(0.0, 0.0, "CENTER")
                            val (sx, sy) = anchorShift(at.anchor)
                            pl.place((at.x * density + sx * pl.width).roundToInt(), (-at.y * density + sy * pl.height).roundToInt())
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun MkpSpot(p: Props, ctx: WidgetContext) {
    val at = p["at"].point() ?: XY(0.0, 0.0)
    val nudge = p["nudge"].point() ?: XY(0.0, 0.0)
    val density = LocalDensity.current.density
    val sizes = ctx.scope.sizes
    val path = ctx.path
    Box(
        Modifier.site(ctx, "spot")
            .layoutId(SpotAt(at.x + nudge.x, at.y + nudge.y, p.case("anchor") ?: "CENTER"))
            .onSizeChanged { sizes.spot(path, Extent(it.width / density.toDouble(), it.height / density.toDouble())) },
    ) { ctx.Children(p.slot("child")) }
}



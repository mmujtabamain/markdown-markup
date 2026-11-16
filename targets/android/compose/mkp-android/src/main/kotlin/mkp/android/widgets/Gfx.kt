package mkp.android.widgets

import android.graphics.Bitmap
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.hoverable
import androidx.compose.foundation.interaction.HoverInteraction
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.onPlaced
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.hideFromAccessibility
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import java.math.BigDecimal
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.hypot
import kotlin.math.log10
import kotlin.math.roundToInt
import kotlin.math.sqrt
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import mkp.android.Props
import mkp.android.V
import mkp.android.WidgetContext
import mkp.android.XY
import mkp.android.case
import mkp.android.color
import mkp.android.exact
import mkp.android.ffi.Val
import mkp.android.field
import mkp.android.inner
import mkp.android.items
import mkp.android.length
import mkp.android.num
import mkp.android.point
import mkp.android.region
import mkp.android.rememberFrameWriter
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberUpdatedState
import mkp.android.site
import mkp.android.str
import mkp.android.token

// core.gfx on a Compose Canvas: a canvas or a plane gives its shapes a space (its units, y up,
// onto the surface's pixels), layers are boxes over the whole surface, and each shape draws on a
// Canvas of its own there, with a box at its bounds for its semantics and its clicks. `place`
// puts ordinary widgets at a point; `handle` is dragged; `shade` paints pixels its shader works
// out in the native runtime.

/** A drawing surface's coordinates: its units onto pixels on the surface, and back. */
class Space(
    val x: (Double) -> Float,
    val y: (Double) -> Float,
    /** A length along x (a circle's radius). */
    val len: (Double) -> Float,
    /** A pixel on the surface, in units. */
    val unit: (Float, Float) -> XY,
    /** How many units one dp is, for rounding a write and for the keys' steps. */
    val unitsPerDp: () -> Double,
    /** Keeps a point inside what the surface shows, for a handle. */
    val keep: (XY) -> XY,
)

val LocalSpace = compositionLocalOf<Space?> { null }

/** How many digits after the point keep a sub-pixel's worth, for `units` units per dp. */
internal fun placesFor(unitsPerDp: Double): Int =
    if (!(unitsPerDp > 0) || !unitsPerDp.isFinite()) 2 else maxOf(0, ceil(-log10(unitsPerDp)).toInt() + 1)

/** A number from the screen, rounded to `places`, as an exact decimal. */
internal fun exactOf(x: Double, places: Int): BigDecimal = V.decimal(if (x.isFinite()) x else 0.0, places.coerceIn(0, 12))

internal fun pointOf(p: XY, places: Int): Val = V.point(exactOf(p.x, places), exactOf(p.y, places))

/** A stroke's width in dp: a stroke token, or stroke.PX's number. */
internal fun strokeWidth(v: Val?): Float = (v.token().num() ?: v.num() ?: 1.0).toFloat()

// ---- canvas

@Composable
fun MkpCanvas(p: Props, ctx: WidgetContext) {
    fun ends(v: Val?): Pair<Double, Double> {
        val r = v.inner() as? Val.Range ?: return -1.0 to 1.0
        return (r.low.firstOrNull().num() ?: -1.0) to (r.high.firstOrNull().num() ?: 1.0)
    }
    val (xlo, xhi) = ends(p["x"])
    val (ylo, yhi) = ends(p["y"])
    val w = (length(p["width"])?.value ?: 320f).toDouble()
    val aspect = p["aspect"].inner().num() ?: ((xhi - xlo) / (yhi - ylo).let { if (it == 0.0) 1.0 else it })
    val h = w / (if (aspect > 0) aspect else 1.0)
    val density = LocalDensity.current.density
    val wPx = (w * density).toFloat()
    val hPx = (h * density).toFloat()
    val xs = (xhi - xlo).let { if (it == 0.0) 1.0 else it }
    val ys = (yhi - ylo).let { if (it == 0.0) 1.0 else it }
    val space = remember(xlo, xhi, ylo, yhi, wPx, hPx) {
        Space(
            x = { u -> ((u - xlo) / xs * wPx).toFloat() },
            y = { u -> ((yhi - u) / ys * hPx).toFloat() },
            len = { u -> (u / xs * wPx).toFloat() },
            unit = { px, py -> XY(xlo + px / wPx * xs, yhi - py / hPx * ys) },
            unitsPerDp = { xs / w },
            keep = { q -> XY(q.x.coerceIn(minOf(xlo, xhi), maxOf(xlo, xhi)), q.y.coerceIn(minOf(ylo, yhi), maxOf(ylo, yhi))) },
        )
    }
    val label = p.text("label")
    var m = Modifier.site(ctx, "canvas").width(w.dp).aspectRatio((w / h).toFloat()).clipToBounds()
        .semantics { if (label.isNotEmpty()) contentDescription = label }
    Box(m) {
        var surface = Modifier.testTag("canvas.surface").fillMaxSize()
        if (ctx.listens("click")) {
            surface = surface.semantics { role = Role.Button }.pointerInput(space) {
                detectTapGestures { o ->
                    val at = space.unit(o.x, o.y)
                    val places = placesFor(space.unitsPerDp())
                    ctx.event("click", listOf(pointOf(at, places)))
                }
            }
        }
        Box(surface)
        CompositionLocalProvider(LocalSpace provides space) { ctx.Children(p.slot("layers")) }
    }
}

// ---- layer

@Composable
fun MkpLayer(p: Props, ctx: WidgetContext) {
    val space = LocalSpace.current ?: return
    val o = (p.num("opacity") ?: 1.0).toFloat()
    val clip = p["clip"].region()
    var m = Modifier.site(ctx, "layer").fillMaxSize().graphicsLayer { alpha = o }
    if (clip != null) {
        val l = minOf(space.x(clip.x0), space.x(clip.x1))
        val r = maxOf(space.x(clip.x0), space.x(clip.x1))
        val t = minOf(space.y(clip.y0), space.y(clip.y1))
        val b = maxOf(space.y(clip.y0), space.y(clip.y1))
        m = m.graphicsLayer {
            this.clip = true
            shape = object : androidx.compose.ui.graphics.Shape {
                override fun createOutline(size: androidx.compose.ui.geometry.Size, layoutDirection: androidx.compose.ui.unit.LayoutDirection, density: androidx.compose.ui.unit.Density) =
                    androidx.compose.ui.graphics.Outline.Rectangle(Rect(l, t, r, b))
            }
        }
    }
    Box(m) {
        Box(Modifier.testTag("layer.shapes").fillMaxSize()) { ctx.Children(p.slot("shapes")) }
    }
}

/** A shape's events: a box at its bounds that clicks, and that the pointer enters and leaves. */
@Composable
private fun ShapeHit(ctx: WidgetContext, bounds: Rect, label: String, part: String) {
    // the shape's own node: its site, its name, and what it does
    val click = ctx.listens("click")
    val hover = ctx.listens("enter") || ctx.listens("leave")
    val density = LocalDensity.current.density
    var m = Modifier.offset { IntOffset(bounds.left.roundToInt(), bounds.top.roundToInt()) }
        .size((bounds.width / density).dp, (bounds.height / density).dp)
        .site(ctx, part)
    m = m.semantics {
        if (label.isNotEmpty()) contentDescription = label
        if (!click && label.isNotEmpty()) role = Role.Image
    }
    // the pointer entering and leaving it, as the platform's hover says: one interaction source
    // for the click and the hover, since a clickable has a hover of its own
    val source = remember { MutableInteractionSource() }
    if (hover) {
        LaunchedEffect(source) {
            var inside = false
            source.interactions.collect { i ->
                if (i is HoverInteraction.Enter && !inside) {
                    inside = true
                    ctx.event("enter")
                } else if (i is HoverInteraction.Exit && inside) {
                    inside = false
                    ctx.event("leave")
                }
            }
        }
    }
    m = if (click) {
        m.clip(if (part == "circle") CircleShape else androidx.compose.ui.graphics.RectangleShape)
            .clickable(interactionSource = source, indication = LocalIndication.current, role = Role.Button) { ctx.event("click") }
    } else if (hover) m.hoverable(source) else m
    Box(m)
}

// ---- circle and path

@Composable
fun MkpCircle(p: Props, ctx: WidgetContext) {
    val space = LocalSpace.current ?: return
    val at = p["at"].point() ?: XY(0.0, 0.0)
    val cx = space.x(at.x)
    val cy = space.y(at.y)
    val r = abs(space.len(p.num("r") ?: 0.0))
    val fill = color(p["fill"])
    val stroke = color(p["stroke"])
    val sw = strokeWidth(p["width"]) * LocalDensity.current.density
    val o = (p.num("opacity") ?: 1.0).toFloat()
    Box(Modifier.fillMaxSize()) {
        Canvas(Modifier.fillMaxSize()) {
            if (fill != null) drawCircle(fill, r, Offset(cx, cy), alpha = o)
            if (stroke != null) drawCircle(stroke, r, Offset(cx, cy), alpha = o, style = Stroke(sw))
        }
        ShapeHit(ctx, Rect(cx - r, cy - r, cx + r, cy + r), p.text("label"), "circle")
    }
}

@Composable
fun MkpPath(p: Props, ctx: WidgetContext) {
    val space = LocalSpace.current ?: return
    val pts = p["points"].items().mapNotNull { it.point() }.map { Offset(space.x(it.x), space.y(it.y)) }
    val closed = p.flag("closed")
    val stroke = color(p["stroke"])
    val fill = if (closed) color(p["fill"]) else null
    val density = LocalDensity.current.density
    val w = strokeWidth(p["width"]) * density
    val dash = p.flag("dash")
    val head = p.case("head") ?: "NONE"
    val o = (p.num("opacity") ?: 1.0).toFloat()
    val line = Path().apply {
        pts.forEachIndexed { k, q -> if (k == 0) moveTo(q.x, q.y) else lineTo(q.x, q.y) }
        if (closed) close()
    }
    // the head at the last point, along the last segment, in the stroke's colour
    val tip = if (pts.size >= 2 && head != "NONE") {
        val a = pts[pts.size - 2]
        val b = pts.last()
        val len = hypot(b.x - a.x, b.y - a.y).takeIf { it > 0f } ?: 1f
        val ux = (b.x - a.x) / len
        val uy = (b.y - a.y) / len
        val size = 4 * density + w * 3
        Path().apply {
            if (head == "ARROW") {
                val bx = b.x - ux * size
                val by = b.y - uy * size
                moveTo(b.x, b.y)
                lineTo(bx - uy * size * 0.5f, by + ux * size * 0.5f)
                lineTo(bx + uy * size * 0.5f, by - ux * size * 0.5f)
                close()
            } else {
                addOval(Rect(Offset(b.x, b.y), size * 0.4f))
            }
        }
    } else null
    Box(Modifier.fillMaxSize()) {
        Canvas(Modifier.testTag("path.line").fillMaxSize()) {
            if (fill != null) drawPath(line, fill, alpha = o)
            if (stroke != null) drawPath(line, stroke, alpha = o, style = Stroke(w, pathEffect = if (dash) PathEffect.dashPathEffect(floatArrayOf(w * 4, w * 3)) else null))
        }
        if (tip != null && stroke != null) Canvas(Modifier.testTag("path.head").fillMaxSize()) { drawPath(tip, stroke, alpha = o) }
        val pad = maxOf(w, 6 * density)
        val bounds = if (pts.isEmpty()) Rect.Zero else Rect(pts.minOf { it.x } - pad, pts.minOf { it.y } - pad, pts.maxOf { it.x } + pad, pts.maxOf { it.y } + pad)
        ShapeHit(ctx, bounds, p.text("label"), "path")
    }
}

/** How far an anchor moves a box from its point, as shares of its width and height. */
internal fun anchorShift(anchor: String): Pair<Float, Float> {
    val x = if (anchor.endsWith("W")) 0f else if (anchor.endsWith("E")) -1f else -0.5f
    val y = if (anchor.startsWith("N")) 0f else if (anchor.startsWith("S")) -1f else -0.5f
    return x to y
}

// ---- place: ordinary widgets at a point

@Composable
fun MkpPlace(p: Props, ctx: WidgetContext) {
    val space = LocalSpace.current ?: return
    val at = p["at"].point() ?: XY(0.0, 0.0)
    val nudge = p["nudge"].point() ?: XY(0.0, 0.0)
    val density = LocalDensity.current.density
    val x = space.x(at.x) + (nudge.x * density).toFloat()
    val y = space.y(at.y) - (nudge.y * density).toFloat()
    val (sx, sy) = anchorShift(p.case("anchor") ?: "CENTER")
    val o = (p.num("opacity") ?: 1.0).toFloat()
    val label = p.text("label")
    Layout(
        content = {
            Box(Modifier.testTag("place.box").semantics { if (label.isNotEmpty()) contentDescription = label }) { ctx.Children(p.slot("child")) }
        },
        modifier = Modifier.site(ctx, "place").fillMaxSize().graphicsLayer { alpha = o },
    ) { ms, c ->
        val pl = ms.map { it.measure(androidx.compose.ui.unit.Constraints()) }
        layout(c.maxWidth, c.maxHeight) {
            for (q in pl) q.place((x + sx * q.width).roundToInt(), (y + sy * q.height).roundToInt())
        }
    }
}

// ---- handle

@Composable
fun MkpHandle(p: Props, ctx: WidgetContext) {
    val space = LocalSpace.current ?: return
    val at = p["at"].point() ?: XY(0.0, 0.0)
    val density = LocalDensity.current.density
    val cx = space.x(at.x)
    val cy = space.y(at.y)
    val tone = color(p["tone"]) ?: MaterialTheme.colorScheme.primary
    val o = (p.num("opacity") ?: 1.0).toFloat()
    val label = p.text("label")
    fun write(q: XY) {
        val k = space.keep(q)
        ctx.write("at", pointOf(k, placesFor(space.unitsPerDp())))
    }
    val shown = "(${p["at"].field("x").exact()?.let(V::show) ?: "0"}, ${p["at"].field("y").exact()?.let(V::show) ?: "0"})"
    val hit = 28 * density
    val source = remember { MutableInteractionSource() }
    val focus = remember { FocusRequester() }
    // a drag shows the handle under the finger at once, and writes at most once a frame
    val writer = rememberFrameWriter()
    val drag = remember { mutableStateOf<Offset?>(null) }
    val now = rememberUpdatedState(Offset(cx, cy))
    // the surface's and the handle's own places on the screen, so the finger is found on the
    // surface however far the handle has moved under it
    val places = remember { arrayOfNulls<LayoutCoordinates>(2) }
    Box(Modifier.fillMaxSize().onPlaced { places[0] = it }) {
        Box(
            Modifier.offset {
                // read while placing, so a drag moves it without composing anything again
                val c = drag.value ?: now.value
                IntOffset((c.x - hit / 2).roundToInt(), (c.y - hit / 2).roundToInt())
            }
                .size(28.dp)
                .onPlaced { places[1] = it }
                .site(ctx, "handle")
                .focusRequester(focus)
                .graphicsLayer { alpha = o }
                .semantics {
                    contentDescription = label
                    stateDescription = shown
                    progressBarRangeInfo = ProgressBarRangeInfo(0f, 0f..1f)
                }
                .onKeyEvent { e ->
                    if (e.type != KeyEventType.KeyDown) return@onKeyEvent false
                    val step = space.unitsPerDp() * (if (e.isShiftPressed) 40 else 8)
                    val d = when (e.key) {
                        Key.DirectionLeft -> XY(-step, 0.0)
                        Key.DirectionRight -> XY(step, 0.0)
                        Key.DirectionUp -> XY(0.0, step)
                        Key.DirectionDown -> XY(0.0, -step)
                        else -> return@onKeyEvent false
                    }
                    write(XY(at.x + d.x, at.y + d.y))
                    true
                }
                .focusable(interactionSource = source)
                .pointerInput(space) {
                    // the handle's drag: past the touch slop it takes the focus (as a press does on
                    // the web) and follows the finger; every move, and the lift too, is where the
                    // finger is, so the last write is always where the drag ended
                    awaitEachGesture {
                        val down = awaitFirstDown(requireUnconsumed = false)
                        var dragging = false
                        while (true) {
                            val change = awaitPointerEvent().changes.firstOrNull { it.id == down.id } ?: break
                            if (!dragging && (change.position - down.position).getDistance() > viewConfiguration.touchSlop) {
                                dragging = true
                                focus.requestFocus()
                            }
                            if (dragging) {
                                change.consume()
                                // the finger on the surface, from where the handle is now
                                val surface = places[0]
                                val box = places[1]
                                if (surface != null && box != null && surface.isAttached && box.isAttached) {
                                    val finger = surface.localPositionOf(box, change.position)
                                    val k = space.keep(space.unit(finger.x, finger.y))
                                    drag.value = Offset(space.x(k.x), space.y(k.y))
                                    writer.submit { ctx.writeAway("at", pointOf(k, placesFor(space.unitsPerDp()))) }
                                }
                            }
                            if (!change.pressed) break
                        }
                        // the handle stays under the finger until where it ended is written
                        if (dragging) writer.finish { drag.value = null }
                    }
                },
            contentAlignment = Alignment.Center,
        ) {
            Canvas(Modifier.testTag("handle.dot").size(14.dp).semantics { hideFromAccessibility() }) { drawCircle(tone) }
        }
    }
}

// ---- shade: pixels from a shader

/** At most this many pixels are worked out per shade, scaled up to its size. */
const val MAX_SHADE_PIXELS = 4096

@Composable
fun MkpShade(p: Props, ctx: WidgetContext) {
    val space = LocalSpace.current ?: return
    val area = p["area"].region() ?: return
    val x0 = minOf(space.x(area.x0), space.x(area.x1))
    val x1 = maxOf(space.x(area.x0), space.x(area.x1))
    val y0 = minOf(space.y(area.y0), space.y(area.y1))
    val y1 = maxOf(space.y(area.y0), space.y(area.y1))
    val wPx = x1 - x0
    val hPx = y1 - y0
    val o = (p.num("opacity") ?: 1.0).toFloat()
    val label = p.text("label")
    val density = LocalDensity.current.density
    // painted again when what it shows changes: its area, shader and arguments, and its size
    val sig = listOf(p["area"], p["shader"], p["args"], wPx.roundToInt(), hPx.roundToInt())
    val picture by produceState<ImageBitmap?>(null, sig) {
        value = if (wPx <= 0f || hPx <= 0f) null else withContext(Dispatchers.Default) {
            val scale = minOf(1.0, sqrt(MAX_SHADE_PIXELS / (wPx.toDouble() * hPx)))
            val cols = maxOf(1, (wPx * scale).roundToInt())
            val rows = maxOf(1, (hPx * scale).roundToInt())
            try {
                val px = ctx.page.native.shade(ctx.path, cols.toUInt(), rows.toUInt())
                Bitmap.createBitmap(px.toIntArray(), cols, rows, Bitmap.Config.ARGB_8888).asImageBitmap()
            } catch (_: Exception) {
                null
            }
        }
    }
    Box(Modifier.fillMaxSize()) {
        Box(
            Modifier.offset { IntOffset(x0.roundToInt(), y0.roundToInt()) }
                .size((wPx / density).dp, (hPx / density).dp)
                .site(ctx, "shade")
                .semantics {
                    if (label.isNotEmpty()) contentDescription = label
                    role = Role.Image
                },
        ) {
            val b = picture
            if (b != null) Image(b, null, Modifier.testTag("shade.pixels").fillMaxSize().graphicsLayer { alpha = o }, contentScale = ContentScale.FillBounds, filterQuality = androidx.compose.ui.graphics.FilterQuality.None)
            else Box(Modifier.testTag("shade.pixels").fillMaxSize())
        }
    }
}


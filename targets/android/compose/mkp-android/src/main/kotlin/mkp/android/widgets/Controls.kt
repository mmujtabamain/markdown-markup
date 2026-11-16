package mkp.android.widgets

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.isMetaPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.hideFromAccessibility
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties
import java.math.BigDecimal
import java.math.RoundingMode
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import mkp.android.FILLED
import mkp.android.GLYPHS
import mkp.android.Props
import mkp.android.V
import mkp.android.WidgetContext
import mkp.android.color
import mkp.android.exact
import mkp.android.ffi.Node
import mkp.android.length
import mkp.android.safeSrc
import mkp.android.site
import mkp.android.textStyle

// Drawing and input: label, image, icon, press, field, slider and overlay, as the Material 3
// controls they are, with their roles and states in the semantics tree, so TalkBack, Switch
// Access and a keyboard get them for free.

// ---- label, image, icon

@Composable
fun MkpLabel(p: Props, ctx: WidgetContext) {
    val wrap = p.flag("wrap", true)
    val clip = p.flag("clip")
    var style: TextStyle = textStyle(p.case("size"), p.case("weight"), p.case("font"))
    // a halo: the surface's colour around the letters, so a label reads over lines
    if (p.flag("halo")) style = style.copy(shadow = Shadow(MaterialTheme.colorScheme.surface, blurRadius = 6f))
    Text(
        p.text("value"),
        Modifier.site(ctx, "label").semantics { if (clip) contentDescription = p.text("value") },
        color = color(p["tone"]) ?: LocalContentColor.current,
        style = style,
        textAlign = textAlign(p.case("align")),
        softWrap = wrap,
        maxLines = if (clip || !wrap) 1 else Int.MAX_VALUE,
        overflow = if (clip) TextOverflow.Ellipsis else TextOverflow.Clip,
    )
}

/** A picture from an http(s) or data: link, loaded off the main thread; `null` until it is. */
@Composable
private fun picture(src: String?): ImageBitmap? {
    val state = produceState<ImageBitmap?>(null, src) {
        value = if (src == null) null else withContext(Dispatchers.IO) {
            try {
                val bytes = if (src.startsWith("data:", ignoreCase = true)) {
                    Base64.decode(src.substringAfter("base64,", ""), Base64.DEFAULT)
                } else {
                    URL(src).openStream().use { it.readBytes() }
                }
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
            } catch (_: Exception) {
                null
            }
        }
    }
    return state.value
}

@Composable
fun MkpImage(p: Props, ctx: WidgetContext) {
    val alt = p.text("alt")
    // only http, https and data: pictures; a relative one has nothing to be relative to here
    val src = safeSrc(p.text("src"))?.takeIf { it.startsWith("http", true) || it.startsWith("data:", true) }
    val bitmap = picture(src)
    val width = length(p["width"])
    val m = Modifier.site(ctx, "image").semantics { contentDescription = alt; role = Role.Image }.let { if (width != null) it.width(width) else it }
    if (bitmap != null) {
        Image(bitmap, alt, m.aspectRatio(bitmap.width.toFloat() / bitmap.height.coerceAtLeast(1)), contentScale = ContentScale.Fit)
    } else {
        // not loaded (or not allowed): its alt text, where it would be
        Box(m.background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(8.dp)).padding(8.dp)) {
            Text(alt, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
        }
    }
}

private val vectors = HashMap<String, ImageVector>()

/** A glyph as a 24-unit vector: stroked in the text's colour with round ends, or filled. */
fun glyphVector(name: String?): ImageVector = vectors.getOrPut(name ?: "") {
    val d = GLYPHS[name ?: ""] ?: "M12 12v.01"
    val filled = name in FILLED
    ImageVector.Builder(name ?: "glyph", 24.dp, 24.dp, 24f, 24f).addPath(
        pathData = PathParser().parsePathString(d).toNodes(),
        fill = if (filled) SolidColor(Color.Black) else null,
        stroke = SolidColor(Color.Black),
        strokeLineWidth = 2f,
        strokeLineCap = StrokeCap.Round,
        strokeLineJoin = StrokeJoin.Round,
    ).build()
}

internal fun iconSize(size: String?): Dp = when (size) {
    "SMALL" -> 16.dp
    "LARGE" -> 28.dp
    else -> 20.dp
}

@Composable
fun MkpIcon(p: Props, ctx: WidgetContext) {
    val label = p.text("label")
    Icon(
        glyphVector(p.case("name")),
        contentDescription = label.ifEmpty { null },
        modifier = Modifier.site(ctx, "icon").size(iconSize(p.case("size"))).semantics { if (label.isNotEmpty()) role = Role.Image },
        tint = color(p["tone"]) ?: LocalContentColor.current,
    )
}

// ---- press

/** A press inside an overlay's anchor opens the overlay too, as a click bubbles to it on the web. */
internal val LocalAnchorClick = compositionLocalOf<(() -> Unit)?> { null }

@Composable
fun MkpPress(p: Props, ctx: WidgetContext) {
    val kind = p.case("kind") ?: "BUTTON"
    val selected = p.flag("selected")
    val enabled = !p.flag("disabled")
    val label = p.text("label")
    val content = p.slot("content")
    val tone = color(p["tone"])
    val bubble = LocalAnchorClick.current
    val click = {
        ctx.event("click")
        bubble?.invoke()
        Unit
    }
    val inside: @Composable () -> Unit = {
        CompositionLocalProvider(LocalAnchorClick provides null) {
            if (content.isEmpty()) Text(label, Modifier.testTag("press.label"))
            else {
                // its label stays a part, with nothing to show: the content shows instead
                Box(Modifier.testTag("press.label").size(0.dp))
                Row(Modifier.testTag("press.content"), verticalAlignment = Alignment.CenterVertically) { ctx.Children(content) }
            }
        }
    }
    // with content of its own, the label is its accessible name
    val named = Modifier.semantics { if (content.isNotEmpty()) contentDescription = label }
    val root = Modifier.site(ctx, "press").then(named)
    when (kind) {
        "SWITCH", "CHECK" -> Row(
            root.clip(RoundedCornerShape(8.dp))
                .toggleable(selected, enabled = enabled, role = if (kind == "SWITCH") Role.Switch else Role.Checkbox) { click() }
                .padding(horizontal = 4.dp, vertical = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Box(Modifier.testTag("press.indicator").semantics { hideFromAccessibility() }) {
                if (kind == "SWITCH") Switch(selected, null, enabled = enabled) else Checkbox(selected, null, enabled = enabled)
            }
            inside()
        }
        "RADIO" -> Row(
            root.clip(RoundedCornerShape(8.dp)).selectable(selected, enabled = enabled, role = Role.RadioButton) { click() }.padding(horizontal = 4.dp, vertical = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Box(Modifier.testTag("press.indicator").semantics { hideFromAccessibility() }) { RadioButton(selected, null, enabled = enabled) }
            inside()
        }
        "TAB" -> Tab(selected, onClick = click, modifier = root, enabled = enabled, text = inside)
        "TOGGLE", "OPTION" -> {
            val m = root.semantics { this.selected = selected }
            if (selected) {
                FilledTonalButton(click, m, enabled = enabled, colors = tone?.let { ButtonDefaults.filledTonalButtonColors(containerColor = it.copy(alpha = 0.24f)) } ?: ButtonDefaults.filledTonalButtonColors()) { inside() }
            } else {
                OutlinedButton(click, m, enabled = enabled) { inside() }
            }
        }
        "PLAIN" -> TextButton(click, root.semantics { this.selected = false }, enabled = enabled, colors = tone?.let { ButtonDefaults.textButtonColors(contentColor = it) } ?: ButtonDefaults.textButtonColors()) { inside() }
        else -> Button(
            click,
            root.semantics { this.selected = false },
            enabled = enabled,
            colors = tone?.let { ButtonDefaults.buttonColors(containerColor = it) } ?: ButtonDefaults.buttonColors(),
        ) { inside() }
    }
}

// ---- field

@Composable
fun MkpField(p: Props, ctx: WidgetContext) {
    val value = p.text("value")
    val lines = (p.num("lines") ?: 1.0).toInt().coerceIn(1, 20)
    val one = lines == 1
    var typed by remember { mutableStateOf(TextFieldValue(value)) }
    // the page's value wins, but the caret stays where it was
    if (typed.text != value && typed.composition == null) {
        typed = typed.copy(text = value, selection = androidx.compose.ui.text.TextRange(minOf(typed.selection.start, value.length), minOf(typed.selection.end, value.length)))
    }
    val placeholder = p.text("placeholder")
    Box(Modifier.site(ctx, "field").fillMaxWidth()) {
        OutlinedTextField(
            value = typed,
            onValueChange = { next ->
                val changed = next.text != typed.text
                typed = next
                if (changed) ctx.write("value", V.text(next.text))
            },
            modifier = Modifier.testTag("field.input").fillMaxWidth().onPreviewKeyEvent { e ->
                // Enter submits a one-line field (its IME action); a longer one takes Ctrl or Cmd with it
                if (!one && e.type == KeyEventType.KeyDown && e.key == Key.Enter && (e.isCtrlPressed || e.isMetaPressed)) {
                    ctx.event("submit")
                    true
                } else false
            },
            label = { Text(p.text("label"), Modifier.testTag("field.label")) },
            placeholder = if (placeholder.isEmpty()) null else ({ Text(placeholder) }),
            singleLine = one,
            minLines = lines,
            maxLines = if (one) 1 else maxOf(lines, 20),
            keyboardOptions = KeyboardOptions(imeAction = if (one) ImeAction.Done else ImeAction.Default),
            keyboardActions = KeyboardActions(onDone = { ctx.event("submit") }),
        )
    }
}

// ---- slider

/** A slider's ends and step, exactly. */
data class SliderEnds(val low: BigDecimal, val high: BigDecimal, val step: BigDecimal) {
    /** The number on the slider's grid nearest a value, inside its ends, worked out exactly. */
    fun snap(x: BigDecimal): BigDecimal {
        var k = x.subtract(low).divide(step, java.math.MathContext.DECIMAL128).setScale(0, RoundingMode.HALF_UP)
        if (k.signum() < 0) k = BigDecimal.ZERO
        var v = low.add(k.multiply(step))
        if (v > high) v = low.add(high.subtract(low).divide(step, java.math.MathContext.DECIMAL128).setScale(0, RoundingMode.FLOOR).multiply(step))
        return BigDecimal(V.show(v))
    }

    fun has(x: BigDecimal): Boolean = x >= low && x <= high && snap(x).compareTo(x) == 0
}

fun sliderEnds(ctx: WidgetContext): SliderEnds? = try {
    val e = ctx.page.native.sliderEnds(ctx.path)
    SliderEnds(BigDecimal(e.low), BigDecimal(e.high), BigDecimal(e.step))
} catch (_: Exception) {
    null
}

@Composable
fun MkpSlider(p: Props, ctx: WidgetContext) {
    val ends = remember(p.node.props) { sliderEnds(ctx) } ?: SliderEnds(BigDecimal.ZERO, BigDecimal.ONE, BigDecimal("0.01"))
    val value = p["value"].exact()
    val shown = value?.let(V::show) ?: ""
    val enabled = !p.flag("disabled")
    val label = p.text("label")
    fun go(x: BigDecimal) {
        val v = ends.snap(x.max(ends.low).min(ends.high))
        if (value == null || v.compareTo(value) != 0) ctx.write("value", V.num(v))
    }
    Column(Modifier.site(ctx, "slider").fillMaxWidth()) {
        Text(label, Modifier.testTag("slider.label"), style = MaterialTheme.typography.labelLarge)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Slider(
                value = (value ?: ends.low).toFloat(),
                onValueChange = { x -> go(BigDecimal(x.toDouble())) },
                valueRange = ends.low.toFloat()..ends.high.toFloat(),
                enabled = enabled,
                modifier = Modifier.testTag("slider.input").weight(1f).semantics { contentDescription = label }.onPreviewKeyEvent { e ->
                    if (!enabled || e.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                    val now = value ?: ends.low
                    val big = ends.step.multiply(BigDecimal.TEN)
                    when (e.key) {
                        Key.DirectionRight, Key.DirectionUp -> go(now.add(ends.step))
                        Key.DirectionLeft, Key.DirectionDown -> go(now.subtract(ends.step))
                        Key.PageUp -> go(now.add(big))
                        Key.PageDown -> go(now.subtract(big))
                        Key.MoveHome -> go(ends.low)
                        Key.MoveEnd -> go(ends.high)
                        else -> return@onPreviewKeyEvent false
                    }
                    true
                },
            )
            // the value shown; the slider itself says it to assistive technology
            Text(shown, Modifier.testTag("slider.value").widthIn(min = 32.dp).semantics { hideFromAccessibility() }, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

// ---- overlay

/** Whether a slot holds a control of its own: then that control is the overlay's trigger. */
private fun hasControl(nodes: List<Node>): Boolean = nodes.any { it.widget == "core/press" || it.widget == "core/field" || it.slots.any { s -> hasControl(s.nodes) } }

/** Composes [content] without measuring or placing it, and hides it from assistive technology: a
 * closed overlay's body stays on the page, as @mkp/dom keeps it, but isn't seen. */
@Composable
internal fun Hidden(content: @Composable () -> Unit) {
    Layout(content, Modifier.clearAndSetSemantics { }) { _, _ -> layout(0, 0) {} }
}

@Composable
fun MkpOverlay(p: Props, ctx: WidgetContext) {
    val mode = p.case("mode") ?: "POPOVER"
    val open = p.flag("open")
    val label = p.text("label")
    val anchor = p.slot("anchor")
    val body = p.slot("body")
    fun setOpen(want: Boolean) {
        if (want == open) return
        ctx.write("open", V.bool(want))
        ctx.event("open_changed")
    }
    val trigger = !hasControl(anchor)
    val toggle = { if (mode != "TOOLTIP") setOpen(!open) }
    Box(Modifier.site(ctx, "overlay")) {
        var anchorMod = Modifier.testTag("overlay.anchor").onPreviewKeyEvent { e ->
            if (e.type == KeyEventType.KeyDown && e.key == Key.Escape && open) {
                setOpen(false)
                true
            } else false
        }
        if (mode == "TOOLTIP") {
            // shown while the pointer is on its anchor, or it has the focus
            anchorMod = anchorMod.pointerInput(Unit) {
                awaitPointerEventScope {
                    while (true) {
                        val e = awaitPointerEvent()
                        if (e.type == PointerEventType.Enter) setOpen(true)
                        if (e.type == PointerEventType.Exit) setOpen(false)
                    }
                }
            }.focusable()
        } else if (trigger) {
            anchorMod = anchorMod.clip(RoundedCornerShape(8.dp)).clickable(role = Role.Button, onClickLabel = label.ifEmpty { null }) { toggle() }
        }
        Box(anchorMod) {
            CompositionLocalProvider(LocalAnchorClick provides if (trigger || mode == "TOOLTIP") null else toggle) { ctx.Children(anchor) }
        }
        val shown: @Composable () -> Unit = {
            Surface(
                Modifier.testTag("overlay.body").widthIn(max = 360.dp).semantics(mergeDescendants = true) {
                    if (label.isNotEmpty()) {
                        contentDescription = label
                        paneTitle = label
                    }
                },
                shape = RoundedCornerShape(if (mode == "DIALOG") 28.dp else 8.dp),
                tonalElevation = 3.dp,
                shadowElevation = 3.dp,
            ) {
                ctx.Flow(body, Modifier.padding(if (mode == "DIALOG") 24.dp else 12.dp))
            }
        }
        when {
            !open -> Hidden { ctx.Children(body) }
            mode == "DIALOG" -> Dialog(onDismissRequest = { setOpen(false) }) { shown() }
            else -> Popup(
                alignment = Alignment.TopStart,
                offset = IntOffset(0, 0),
                onDismissRequest = { if (mode != "TOOLTIP") setOpen(false) },
                properties = PopupProperties(focusable = mode == "MENU"),
            ) {
                Box(Modifier.padding(top = 40.dp)) { shown() }
            }
        }
    }
}


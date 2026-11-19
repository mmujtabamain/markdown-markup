package xtmd.android.widgets

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Checkbox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.foundation.layout.size
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.LocalMinimumInteractiveComponentSize
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalDensity
import xtmd.android.MathBlock
import xtmd.android.readTex
import androidx.compose.ui.semantics.CollectionInfo
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.toggleableState
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.semantics.collectionInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.text
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import xtmd.android.Props
import xtmd.android.WidgetContext
import xtmd.android.case
import xtmd.android.codeStyle
import xtmd.android.color
import xtmd.android.headingStyle
import xtmd.android.inner
import xtmd.android.items
import xtmd.android.richText
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.material3.LocalTextStyle
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.text.Placeholder
import androidx.compose.ui.text.PlaceholderVerticalAlign
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.em
import xtmd.android.inlineSlots
import xtmd.android.site
import xtmd.android.str
import xtmd.android.templateText
import xtmd.android.field
import xtmd.android.ffi.Val

// Markdown's own blocks, as Material 3 text: paragraph, heading, bullets and item, quote, code,
// math, table, footnote and divider.

internal fun textAlign(a: String?): TextAlign? = when (a) {
    "CENTER" -> TextAlign.Center
    "END" -> TextAlign.End
    "STRETCH" -> TextAlign.Justify
    else -> null
}

/** Rich text with the page's link and code colours. */
@Composable
internal fun rich(v: Val?) = richText(v, MaterialTheme.colorScheme.primary, MaterialTheme.colorScheme.surfaceVariant)

/** A rich text's Text, with each view in its sentence drawn from the widget's slot where its part
 * is, as a widget of the page. Its room in the line is the size the view measured, so a view is
 * set in place a frame after it is first drawn. A sentence with views has no fixed line height:
 * a line grows to the view it holds, as on the web, where a fixed one would let the view cover
 * the line below. */
@Composable
internal fun RichText(
    v: Val?,
    p: Props,
    ctx: WidgetContext,
    modifier: Modifier = Modifier,
    color: Color = Color.Unspecified,
    textAlign: TextAlign? = null,
    fontWeight: FontWeight? = null,
    style: TextStyle = LocalTextStyle.current,
) {
    val slots = inlineSlots(v)
    val sizes = remember { mutableStateMapOf<String, IntSize>() }
    val density = LocalDensity.current
    val inline = slots.associateWith { slot ->
        val size = sizes[slot]
        val room = with(density) { Placeholder(size?.width?.toSp() ?: 1.em, size?.height?.toSp() ?: 1.em, PlaceholderVerticalAlign.TextCenter) }
        InlineTextContent(room) {
            Box(Modifier.wrapContentSize(Alignment.TopStart, unbounded = true).onSizeChanged { sizes[slot] = it }) {
                ctx.Children(p.slot(slot))
            }
        }
    }
    val lines = if (slots.isEmpty()) style else style.copy(lineHeight = TextUnit.Unspecified)
    Text(rich(v), modifier, color = color, textAlign = textAlign, fontWeight = fontWeight, style = lines, inlineContent = inline)
}

@Composable
fun XtmdParagraph(p: Props, ctx: WidgetContext) {
    RichText(
        p["value"],
        p,
        ctx,
        Modifier.site(ctx, "paragraph").fillMaxWidth(),
        color = color(p["tone"]) ?: MaterialTheme.colorScheme.onSurface,
        textAlign = textAlign(p.case("align")),
        style = MaterialTheme.typography.bodyLarge,
    )
}

@Composable
fun XtmdHeading(p: Props, ctx: WidgetContext) {
    val level = (p.num("level") ?: 1.0).toInt().coerceIn(1, 6)
    RichText(
        p["value"],
        p,
        ctx,
        Modifier.site(ctx, "heading").fillMaxWidth().semantics { heading() },
        style = headingStyle(MaterialTheme.typography, level),
        color = MaterialTheme.colorScheme.onSurface,
    )
}

/** The marker an item of a list shows: a bullet, or its number. */
internal val LocalMarker = compositionLocalOf<String?> { null }

@Composable
fun XtmdBullets(p: Props, ctx: WidgetContext) {
    val ordered = p.flag("ordered")
    val start = (p.num("start") ?: 1.0).toInt()
    val items = p.slot("items")
    Column(
        Modifier.site(ctx, if (ordered) "bullets" else "bullets").semantics { collectionInfo = CollectionInfo(items.size, 1) },
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        items.forEachIndexed { k, n ->
            CompositionLocalProvider(LocalMarker provides if (ordered) "${start + k}." else "•") { ctx.Child(n) }
        }
    }
}

@Composable
fun XtmdItem(p: Props, ctx: WidgetContext) {
    val done = p["done"].inner() as? Val.Bool
    val marker = LocalMarker.current ?: "•"
    // the box or the marker sits on the body's first line: as tall as one line of it, centred there
    val line = with(LocalDensity.current) { MaterialTheme.typography.bodyLarge.lineHeight.toDp() }
    Row(Modifier.site(ctx, "item").fillMaxWidth(), verticalAlignment = Alignment.Top) {
        Box(Modifier.widthIn(min = 16.dp).height(line).padding(end = 8.dp), contentAlignment = Alignment.CenterEnd) {
            if (done != null) {
                // a task box shows whether it is done; a press elsewhere changes it
                CompositionLocalProvider(LocalMinimumInteractiveComponentSize provides 0.dp) {
                    Checkbox(
                        checked = done.b,
                        onCheckedChange = null,
                        enabled = false,
                        modifier = Modifier.testTag("item.check").size(20.dp).semantics {
                            contentDescription = if (done.b) "Done" else "Not done"
                            role = Role.Checkbox
                            toggleableState = ToggleableState(done.b)
                            disabled()
                        },
                    )
                }
            } else {
                // the marker is the list's, not the item's words: a screen reader hears the list's count
                Text(marker, Modifier.clearAndSetSemantics { }, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyLarge)
            }
        }
        ctx.Flow(p.slot("body"), Modifier.testTag("item.body").weight(1f))
    }
}

@Composable
fun XtmdQuote(p: Props, ctx: WidgetContext) {
    Row(Modifier.site(ctx, "quote").fillMaxWidth().height(IntrinsicSize.Min)) {
        Box(Modifier.width(4.dp).fillMaxHeight().background(MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(2.dp)))
        CompositionLocalProvider(androidx.compose.material3.LocalContentColor provides MaterialTheme.colorScheme.onSurfaceVariant) {
            ctx.Flow(p.slot("body"), Modifier.padding(start = 12.dp).weight(1f))
        }
    }
}

@Composable
fun XtmdCode(p: Props, ctx: WidgetContext) {
    val lang = p.text("lang").trim().split(Regex("\\s+")).firstOrNull().orEmpty()
    Box(
        Modifier.site(ctx, "code").fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceContainerHigh, RoundedCornerShape(12.dp))
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 14.dp, vertical = 10.dp)
            .semantics { if (lang.isNotEmpty()) stateDescription = lang },
    ) {
        SelectionContainer {
            // one line break at the end ends the last line: it isn't an empty line of its own
            Text(p.text("src").removeSuffix("\n").removeSuffix("\r"), Modifier.testTag("code.text"), style = codeStyle(MaterialTheme.typography), softWrap = false)
        }
    }
}

@Composable
fun XtmdMath(p: Props, ctx: WidgetContext) {
    val tex = templateText(p["tex"].field("tex"))
    val tree = remember(tex) { readTex(tex.trim()) }
    Box(
        // named by its TeX, as @extended-mark/dom's is; its text is what the drawing says, on one line
        Modifier.site(ctx, "math").fillMaxWidth().horizontalScroll(rememberScrollState()).semantics {
            contentDescription = tex
            text = androidx.compose.ui.text.AnnotatedString(xtmd.android.texText(tex))
        },
        contentAlignment = Alignment.Center,
    ) {
        // a little larger than the text around it, as @extended-mark/dom draws it (1.1em)
        if (tree != null) MathBlock(tree, LocalContentColor.current, MaterialTheme.typography.bodyLarge.fontSize * 1.1f, Modifier.clearAndSetSemantics { })
        else Text(tex, style = codeStyle(MaterialTheme.typography))
    }
}

@Composable
fun XtmdTable(p: Props, ctx: WidgetContext) {
    val head = p["head"].items()
    val rows = p["rows"].items().map { it.items() }
    val align = p["align"].items().map { it.case() }
    val cols = maxOf(head.size, rows.maxOfOrNull { it.size } ?: 0)
    val line = MaterialTheme.colorScheme.outlineVariant
    val density = LocalDensity.current
    // where each row ends, worked out by the layout, for the lines under them
    val ends = remember { mutableStateListOf<Float>() }
    // as @extended-mark/dom draws it: each column as wide as its widest cell, a line under the header
    // (thicker) and under each row; a table wider than the page scrolls
    Box(Modifier.site(ctx, "table").fillMaxWidth().horizontalScroll(rememberScrollState())) {
        Layout(
            content = {
                for ((r, cells) in (listOf(head) + rows).withIndex()) {
                    for (k in 0 until cols) {
                        RichText(
                            cells.getOrNull(k),
                            p,
                            ctx,
                            Modifier.testTag(if (r == 0) "table.header" else "table.cell").padding(horizontal = 12.dp, vertical = 6.dp),
                            textAlign = textAlign(align.getOrNull(k)) ?: TextAlign.Start,
                            fontWeight = if (r == 0) FontWeight.SemiBold else null,
                            style = MaterialTheme.typography.bodyLarge,
                        )
                    }
                }
            },
            modifier = Modifier.testTag("table.grid").semantics { collectionInfo = CollectionInfo(rows.size + 1, cols) }.drawBehind {
                val thin = 1.dp.toPx()
                ends.forEachIndexed { r, y ->
                    val w = if (r == 0) 2 * thin else thin
                    drawLine(line, Offset(0f, y - w / 2), Offset(size.width, y - w / 2), w)
                }
            },
        ) { ms, _ ->
            val n = maxOf(1, cols)
            val widths = IntArray(n)
            ms.forEachIndexed { i, m -> widths[i % n] = maxOf(widths[i % n], m.maxIntrinsicWidth(androidx.compose.ui.unit.Constraints.Infinity)) }
            val placed = ms.mapIndexed { i, m -> m.measure(androidx.compose.ui.unit.Constraints.fixedWidth(widths[i % n])) }
            val heights = placed.chunked(n).map { r -> r.maxOf { it.height } }
            val rule = with(density) { 2.dp.roundToPx() }
            var y = 0
            val tops = heights.map { h -> y.also { y += h + rule } }
            val total = y
            ends.clear()
            ends.addAll(tops.zip(heights).map { (t, h) -> (t + h + rule).toFloat() })
            layout(widths.sum(), total) {
                placed.forEachIndexed { i, pl ->
                    val r = i / n
                    val x = (0 until i % n).sumOf { widths[it] }
                    pl.place(x, tops[r])
                }
            }
        }
    }
}

@Composable
fun XtmdFootnote(p: Props, ctx: WidgetContext) {
    Row(Modifier.site(ctx, "footnote").fillMaxWidth().semantics { contentDescription = "Footnote ${p.text("mark")}" }) {
        Text(p.text("mark"), Modifier.testTag("footnote.mark").padding(end = 8.dp), color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodySmall)
        CompositionLocalProvider(androidx.compose.material3.LocalTextStyle provides MaterialTheme.typography.bodySmall) {
            ctx.Flow(p.slot("body"), Modifier.testTag("footnote.body").weight(1f))
        }
    }
}

@Composable
fun XtmdDivider(p: Props, ctx: WidgetContext) {
    HorizontalDivider(Modifier.site(ctx, "divider").padding(vertical = 4.dp), color = MaterialTheme.colorScheme.outlineVariant)
}


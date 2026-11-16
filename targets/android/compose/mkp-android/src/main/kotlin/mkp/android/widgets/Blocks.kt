package mkp.android.widgets

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
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import mkp.android.Props
import mkp.android.WidgetContext
import mkp.android.case
import mkp.android.codeStyle
import mkp.android.color
import mkp.android.headingStyle
import mkp.android.inner
import mkp.android.items
import mkp.android.richText
import mkp.android.site
import mkp.android.str
import mkp.android.texText
import mkp.android.templateText
import mkp.android.field
import mkp.android.ffi.Val

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

@Composable
fun MkpParagraph(p: Props, ctx: WidgetContext) {
    Text(
        rich(p["value"]),
        Modifier.site(ctx, "paragraph").fillMaxWidth(),
        color = color(p["tone"]) ?: MaterialTheme.colorScheme.onSurface,
        textAlign = textAlign(p.case("align")),
        style = MaterialTheme.typography.bodyLarge,
    )
}

@Composable
fun MkpHeading(p: Props, ctx: WidgetContext) {
    val level = (p.num("level") ?: 1.0).toInt().coerceIn(1, 6)
    Text(
        rich(p["value"]),
        Modifier.site(ctx, "heading").fillMaxWidth().semantics { heading() },
        style = headingStyle(MaterialTheme.typography, level),
        color = MaterialTheme.colorScheme.onSurface,
    )
}

/** The marker an item of a list shows: a bullet, or its number. */
internal val LocalMarker = compositionLocalOf<String?> { null }

@Composable
fun MkpBullets(p: Props, ctx: WidgetContext) {
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
fun MkpItem(p: Props, ctx: WidgetContext) {
    val done = p["done"].inner() as? Val.Bool
    val marker = LocalMarker.current ?: "•"
    Row(Modifier.site(ctx, "item").fillMaxWidth(), verticalAlignment = Alignment.Top) {
        if (done != null) {
            // a task box shows whether it is done; a press elsewhere changes it
            Checkbox(
                checked = done.b,
                onCheckedChange = null,
                enabled = false,
                modifier = Modifier.testTag("item.check").semantics {
                    contentDescription = if (done.b) "Done" else "Not done"
                    role = Role.Checkbox
                    toggleableState = ToggleableState(done.b)
                    disabled()
                },
            )
        } else {
            // the marker is the list's, not the item's words: a screen reader hears the list's count
            Text(marker, Modifier.widthIn(min = 24.dp).padding(end = 6.dp).clearAndSetSemantics { }, textAlign = TextAlign.End, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        ctx.Flow(p.slot("body"), Modifier.testTag("item.body").weight(1f).padding(top = if (done != null) 12.dp else 0.dp))
    }
}

@Composable
fun MkpQuote(p: Props, ctx: WidgetContext) {
    Row(Modifier.site(ctx, "quote").fillMaxWidth().height(IntrinsicSize.Min)) {
        Box(Modifier.width(4.dp).fillMaxHeight().background(MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(2.dp)))
        CompositionLocalProvider(androidx.compose.material3.LocalContentColor provides MaterialTheme.colorScheme.onSurfaceVariant) {
            ctx.Flow(p.slot("body"), Modifier.padding(start = 12.dp).weight(1f))
        }
    }
}

@Composable
fun MkpCode(p: Props, ctx: WidgetContext) {
    val lang = p.text("lang").trim().split(Regex("\\s+")).firstOrNull().orEmpty()
    Box(
        Modifier.site(ctx, "code").fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceContainerHigh, RoundedCornerShape(12.dp))
            .horizontalScroll(rememberScrollState())
            .padding(12.dp)
            .semantics { if (lang.isNotEmpty()) stateDescription = lang },
    ) {
        SelectionContainer {
            Text(p.text("src"), Modifier.testTag("code.text"), style = codeStyle(MaterialTheme.typography), softWrap = false)
        }
    }
}

@Composable
fun MkpMath(p: Props, ctx: WidgetContext) {
    val tex = templateText(p["tex"].field("tex"))
    Box(Modifier.site(ctx, "math").fillMaxWidth().semantics { contentDescription = tex }, contentAlignment = Alignment.Center) {
        Text(texText(tex), style = MaterialTheme.typography.titleLarge.copy(fontFamily = androidx.compose.ui.text.font.FontFamily.Serif))
    }
}

@Composable
fun MkpTable(p: Props, ctx: WidgetContext) {
    val head = p["head"].items()
    val rows = p["rows"].items().map { it.items() }
    val align = p["align"].items().map { it.case() }
    val cols = maxOf(head.size, rows.maxOfOrNull { it.size } ?: 0)
    val line = MaterialTheme.colorScheme.outlineVariant
    Box(Modifier.site(ctx, "table").fillMaxWidth().horizontalScroll(rememberScrollState())) {
        Column(
            Modifier.testTag("table.grid").border(1.dp, line, RoundedCornerShape(8.dp)).semantics { collectionInfo = CollectionInfo(rows.size + 1, cols) },
        ) {
            @Composable
            fun row(cells: List<Val>, header: Boolean) {
                Row(Modifier.height(IntrinsicSize.Min)) {
                    for (k in 0 until cols) {
                        val v = cells.getOrNull(k)
                        Text(
                            rich(v),
                            Modifier.testTag(if (header) "table.header" else "table.cell").widthIn(min = 96.dp).fillMaxHeight().padding(horizontal = 12.dp, vertical = 8.dp),
                            textAlign = textAlign(align.getOrNull(k)) ?: TextAlign.Start,
                            fontWeight = if (header) FontWeight.SemiBold else null,
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                }
            }
            row(head, true)
            for (r in rows) {
                HorizontalDivider(color = line)
                row(r, false)
            }
        }
    }
}

@Composable
fun MkpFootnote(p: Props, ctx: WidgetContext) {
    Row(Modifier.site(ctx, "footnote").fillMaxWidth().semantics { contentDescription = "Footnote ${p.text("mark")}" }) {
        Text(p.text("mark"), Modifier.testTag("footnote.mark").padding(end = 8.dp), color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodySmall)
        CompositionLocalProvider(androidx.compose.material3.LocalTextStyle provides MaterialTheme.typography.bodySmall) {
            ctx.Flow(p.slot("body"), Modifier.testTag("footnote.body").weight(1f))
        }
    }
}

@Composable
fun MkpDivider(p: Props, ctx: WidgetContext) {
    HorizontalDivider(Modifier.site(ctx, "divider").padding(vertical = 4.dp), color = MaterialTheme.colorScheme.outlineVariant)
}


package xtmd.android

import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.BaselineShift
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.em
import xtmd.android.ffi.Val

// rich_text drawn as an AnnotatedString: its segments with their marks, read as Markdown out reads
// them, so what is drawn and what is written say the same words. Links are checked before use and
// nothing in a value is ever read as markup.

/** Whether a link may be followed: http, https and mailto, or a relative one. Control
 * characters and spaces are dropped first, as browsers do, so `java\tscript:` is caught. */
fun safeHref(url: String): String? {
    val plain = url.filter { it > ' ' && it != '\u007f' }
    if (plain.isEmpty()) return null
    val scheme = Regex("^([a-zA-Z][a-zA-Z0-9+.-]*):").find(plain) ?: return url.trim()
    return if (scheme.groupValues[1].lowercase() in setOf("http", "https", "mailto")) url.trim() else null
}

/** Whether a picture may be shown: http, https, relative, or a data: image. */
fun safeSrc(url: String): String? {
    val plain = url.filter { it > ' ' && it != '\u007f' }
    if (plain.lowercase().startsWith("data:image/")) return url.trim()
    val scheme = Regex("^([a-zA-Z][a-zA-Z0-9+.-]*):").find(plain) ?: return if (plain.isNotEmpty()) url.trim() else null
    return if (scheme.groupValues[1].lowercase() in setOf("http", "https")) url.trim() else null
}

/** The widget's slot each view in a rich_text's sentence is drawn from, in order. */
fun inlineSlots(v: Val?): List<String> =
    v.field("segments").items().mapNotNull { seg -> seg.field("part").takeIf { it.case() == "VIEW" }?.let { (it.field("child") as? Val.View)?.slot } }

/** A rich_text as the text Compose draws: marks as spans, links as links, code in the mono font,
 * maths as its Unicode, footnote marks raised, and a view in the sentence as inline content
 * named by its slot ([inlineSlots]), which the Text that draws it is given. */
fun richText(v: Val?, linkColor: Color, codeBackground: Color): AnnotatedString = buildAnnotatedString {
    for (seg in v.field("segments").items()) {
        val part = seg.field("part")
        val marks = seg.field("marks")
        var style = SpanStyle()
        if (marks.field("bold").flag()) style = style.merge(SpanStyle(fontWeight = FontWeight.Bold))
        if (marks.field("italic").flag()) style = style.merge(SpanStyle(fontStyle = FontStyle.Italic))
        if (marks.field("strike").flag()) style = style.merge(SpanStyle(textDecoration = TextDecoration.LineThrough))
        val href = marks.field("link").inner()?.str()
        val words: AnnotatedString.Builder.() -> Unit = {
            withStyle(style) {
                when (part.case()) {
                    "TEXT" -> append(part.field("value").str())
                    "CODE" -> withStyle(SpanStyle(fontFamily = FontFamily.Monospace, background = codeBackground)) { append(part.field("value").str()) }
                    "MATH" -> appendTex(templateText(part.field("tex").field("tex")))
                    "IMAGE" -> append(part.field("alt").str())
                    "NOTE" -> withStyle(SpanStyle(baselineShift = BaselineShift.Superscript, fontSize = 0.75.em, color = linkColor)) { append(part.field("mark").str()) }
                    "BREAK" -> append("\n")
                    "VIEW" -> (part.field("child") as? Val.View)?.slot?.let { appendInlineContent(it) }
                    else -> {}
                }
            }
        }
        val safe = href?.let(::safeHref)
        if (safe != null) {
            withLink(LinkAnnotation.Url(safe, TextLinkStyles(SpanStyle(color = linkColor, textDecoration = TextDecoration.Underline)))) { words() }
        } else words()
    }
}

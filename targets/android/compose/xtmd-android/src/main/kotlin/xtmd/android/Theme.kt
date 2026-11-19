package xtmd.android

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import xtmd.android.ffi.Val

// core's tokens, drawn the Material 3 way (tokens.xtpack says which values): the colours a theme has
// a role for come from MaterialTheme.colorScheme, so an app's own theme restyles every page, and
// the rest (INFO, OK, WARN, the chart colours C1…C6, SHADOW, and any colour a pack adds) from the
// value the build gives the token, for the page's theme. Lengths are dp.

/** Whether the page is drawn dark: the page's `theme`, else the system's. */
val LocalXtmdDark = compositionLocalOf { false }

/** The colour schemes XtmdPage draws with by default: Material 3's baseline. */
object XtmdTheme {
    fun colors(dark: Boolean): ColorScheme = if (dark) darkColorScheme() else lightColorScheme()
}

/** A colour token (or an `opt` of one) as Compose draws it; `null` for none. */
@Composable
@ReadOnlyComposable
fun color(v: Val?): Color? {
    val c = v.inner() as? Val.Case ?: return null
    val s = MaterialTheme.colorScheme
    if (c.ty == "core/color") {
        when (c.name) {
            "SURFACE" -> return s.surface
            "INK" -> return s.onSurface
            "MUTED" -> return s.onSurfaceVariant
            "LINE" -> return s.outlineVariant
            "ACCENT" -> return s.primary
            "BAD" -> return s.error
        }
    }
    // the build's value: a color_value with a hex text for each theme
    val value = c.token.firstOrNull() ?: return null
    return hex(value.field(if (LocalXtmdDark.current) "dark" else "light").str())
}

/** `#rrggbb` or `#rrggbbaa`. */
fun hex(s: String): Color? {
    if (!s.startsWith("#") || (s.length != 7 && s.length != 9)) return null
    val n = s.substring(1).toLongOrNull(16) ?: return null
    return if (s.length == 7) Color(0xFF000000 or n) else Color(((n and 0xFF) shl 24) or (n ushr 8))
}

/** A length token (space, size, radius, stroke) or a plain number, in dp; `null` for none. */
fun length(v: Val?): Dp? {
    val x = v.inner() ?: return null
    if (x is Val.Case && x.ty == "core/radius" && x.name == "CARD") return 12.dp // Material 3's medium shape
    return x.num()?.dp
}

/** A label's text size, the Material 3 type scale's. */
@Composable
@ReadOnlyComposable
fun textStyle(size: String?, weight: String?, font: String?): TextStyle {
    val t = MaterialTheme.typography
    var style = when (font) {
        "HEADING" -> t.titleLarge
        "MONO" -> t.bodyMedium.copy(fontFamily = FontFamily.Monospace)
        else -> when (size) {
            "SMALL" -> t.bodySmall
            "LARGE" -> t.titleLarge
            else -> t.bodyLarge
        }
    }
    if (font != null && size == "SMALL") style = style.copy(fontSize = t.bodySmall.fontSize)
    if (font != null && size == "LARGE") style = style.copy(fontSize = t.titleLarge.fontSize)
    return when (weight) {
        "MEDIUM" -> style.copy(fontWeight = FontWeight.Medium)
        "BOLD" -> style.copy(fontWeight = FontWeight.Bold)
        else -> style
    }
}

/** A heading's style by level, from the Material 3 type scale. */
fun headingStyle(t: Typography, level: Int): TextStyle = when (level) {
    // Material 3's type scale at @extended-mark/dom's sizes: 28 (30), 22, 18, 16, 14 (14.4) and 14 (13.6)
    1 -> t.headlineMedium
    2 -> t.titleLarge
    3 -> t.titleMedium.copy(fontSize = 18.sp, lineHeight = 24.sp)
    4 -> t.titleMedium
    5 -> t.titleSmall
    else -> t.labelLarge
}

/** Code's style: monospace at the body's size. */
fun codeStyle(t: Typography): TextStyle = t.bodyMedium.copy(fontFamily = FontFamily.Monospace, fontSize = 14.sp)

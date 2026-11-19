// The badge pack's externs for the Android target: a composable for xtmd-android's registry, as a
// pack ships one per target it supports (web.mjs is the web's). xtmd-android's check adapters
// compile this file with their own sources (targets/android/compose/xtmd-android/build.gradle.kts).
package badge

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import xtmd.android.Props
import xtmd.android.Widget
import xtmd.android.WidgetContext
import xtmd.android.site

/** A count with its label: one status line, its text following the page. */
@Composable
fun Badge(p: Props, ctx: WidgetContext) {
    Text(
        "${p.text("label")}: ${p.text("count")}",
        Modifier.site(ctx, "badge").semantics { liveRegion = LiveRegionMode.Polite }
            .border(1.dp, LocalContentColor.current, RoundedCornerShape(999.dp))
            .padding(horizontal = 8.dp, vertical = 2.dp),
    )
}

val widgets: Map<String, Widget> = mapOf("badge/badge" to Widget { p, c -> Badge(p, c) })

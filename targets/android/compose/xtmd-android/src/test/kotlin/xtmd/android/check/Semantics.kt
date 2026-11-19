package xtmd.android.check

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.SemanticsNodeInteractionsProvider
import xtmd.android.XtmdSite

// Finding a drawn widget, and its parts, in Compose's semantics tree: each widget's root carries
// its site (XtmdSite), and its parts their testTag ("slider.input"), as @extended-mark/dom's elements carry
// data-xtmd-site and data-part.

fun siteIs(site: String) = SemanticsMatcher("site $site") { it.config.getOrNull(XtmdSite) == site }

fun hasSite() = SemanticsMatcher("a site") { it.config.contains(XtmdSite) }

/** The widget drawn at a site: its root's node, in the unmerged tree (each part on its own). */
fun SemanticsNodeInteractionsProvider.widgetAt(site: String): SemanticsNode? =
    onAllNodes(siteIs(site), useUnmergedTree = true).fetchSemanticsNodes(atLeastOneRootRequired = false).firstOrNull()

/** A node's descendants, depth first, without going into another widget. */
fun SemanticsNode.inside(): Sequence<SemanticsNode> = sequence {
    for (c in children) {
        if (c.config.contains(XtmdSite)) continue
        yield(c)
        yieldAll(c.inside())
    }
}

/** The widget's own node with an action: its root, or a part of it that isn't another widget. */
fun SemanticsNode.withAction(key: androidx.compose.ui.semantics.SemanticsPropertyKey<*>): SemanticsNode? =
    if (config.contains(key)) this else inside().firstOrNull { it.config.contains(key) }

/** A part of the widget, by its testTag (`slider.input`). */
fun SemanticsNode.part(tag: String): SemanticsNode? =
    if (config.getOrNull(SemanticsProperties.TestTag) == tag) this else inside().firstOrNull { it.config.getOrNull(SemanticsProperties.TestTag) == tag }

/** A node to act on through the test API, by its id. */
fun SemanticsNodeInteractionsProvider.interaction(n: SemanticsNode): SemanticsNodeInteraction =
    onNode(SemanticsMatcher("node ${n.id}") { it.id == n.id }, useUnmergedTree = true)

fun SemanticsNode.clickable() = withAction(SemanticsActions.OnClick)

package xtmd.android.check

import xtmd.android.ffi.Extent
import xtmd.android.ffi.Measure
import xtmd.android.ffi.Node
import xtmd.android.ffi.Val

// The checks' fixed sizes, in the page's own lengths, ported from the test target's
// (targets/ts/test/sizes.mjs), so every target's boxes agree exactly:
//
// - Text is 8 wide per character and 20 high: a label, a paragraph, a button's label.
// - A flex lines its children up along its axis (a row's is X, a column's Y); a grid, a cell, a
//   sizing and a spot stack theirs. Each has its `gap` between children and its `pad` on every
//   side (core's space tokens).
// - Anything else is 80 by 20.
// - A plane given no width is 640 wide, the test page's width.

const val CHAR = 8.0
const val LINE = 20.0
const val OTHER = 80.0
const val PAGE_WIDTH = 640.0

private fun textOf(v: Val?): String? = when (v) {
    null -> null
    is Val.Text -> v.s
    is Val.Opt -> v.value.firstOrNull()?.let { textOf(it) } ?: ""
    is Val.Items -> v.items.joinToString("") { textOf(it) ?: "" }
    is Val.Record -> v.fields.joinToString("") { textOf(it.value) ?: "" }
    is Val.Case -> v.values.joinToString("") { textOf(it.value) ?: "" }
    else -> null
}

/** A token case's number (the build's value for it), or 0. An `opt` gives its value's. */
private fun tokenOf(v: Val?): Double = when (v) {
    is Val.Opt -> tokenOf(v.value.firstOrNull())
    is Val.Num -> v.n.toDouble()
    is Val.Case -> (v.token.firstOrNull() as? Val.Num)?.n?.toDouble() ?: 0.0
    else -> 0.0
}

private val CONTAINERS = setOf("core/flex", "core/grid", "core/cell", "core/sizing", "core/spot")

/** A drawn widget's size: width and height. */
fun sizeOf(d: Node): Pair<Double, Double> {
    val kids = d.slots.flatMap { it.nodes }
    val pad = tokenOf(d.props["pad"])
    val gap = tokenOf(d.props["gap"])
    if (d.widget in CONTAINERS) {
        val sizes = kids.map(::sizeOf)
        val between = gap * maxOf(0, sizes.size - 1)
        // a flex lines its children up along its axis; everything else here stacks them
        val across = d.widget == "core/flex" && (d.props["axis"] as? Val.Case)?.name == "X"
        val w = if (across) sizes.sumOf { it.first } + between else maxOf(0.0, sizes.maxOfOrNull { it.first } ?: 0.0)
        val h = if (across) maxOf(0.0, sizes.maxOfOrNull { it.second } ?: 0.0) else sizes.sumOf { it.second } + between
        return (w + 2 * pad) to (h + 2 * pad)
    }
    val text = textOf(d.props["value"]) ?: textOf(d.props["label"])
    if (text != null) return (CHAR * text.codePointCount(0, text.length) + 2 * pad) to (LINE + 2 * pad)
    return OTHER to LINE
}

/** The plane's layout's measure in the checks. */
object FixedMeasure : Measure {
    override fun spot(spot: Node): Extent = sizeOf(spot).let { (w, h) -> Extent(w, h) }

    override fun planeWidth(plane: Node): Double = PAGE_WIDTH
}

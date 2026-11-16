package mkp.android

import java.math.BigDecimal
import java.math.MathContext
import java.math.RoundingMode
import mkp.android.ffi.Field
import mkp.android.ffi.Val

// Reading the values a page gives its widgets (props in the IR's value form, as mkp.android.ffi.Val
// holds them), and making the values a widget writes back. Numbers are exact decimals: a widget
// reads them as Double to draw, and writes BigDecimal so nothing is rounded on the way back.

/** An `opt`'s value, or the value itself; `null` for `opt.NONE`. */
fun Val?.inner(): Val? = when (this) {
    is Val.Opt -> value.firstOrNull()?.inner()
    else -> this
}

/** A record's field, or a case's value, by name (through an `opt`). */
fun Val?.field(name: String): Val? = when (val v = inner()) {
    is Val.Record -> v.fields.firstOrNull { it.name == name }?.value
    is Val.Case -> v.values.firstOrNull { it.name == name }?.value
    else -> null
}

/** A text, a number's or a bool's words; a rich_text's or a template's words; else "". */
fun Val?.str(): String = when (val v = inner()) {
    is Val.Text -> v.s
    is Val.Num -> v.n
    is Val.Bool -> v.b.toString()
    is Val.Record -> when (v.ty) {
        "core/rich_text" -> richWords(v)
        "core/template" -> templateText(v)
        "core/latex" -> templateText(v.field("tex"))
        else -> ""
    }
    else -> ""
}

/** A number, to draw with. */
fun Val?.num(): Double? = when (val v = inner()) {
    is Val.Num -> v.n.toDoubleOrNull()
    is Val.Duration -> v.ms.toDoubleOrNull()
    is Val.Case -> v.token.firstOrNull().num()
    else -> null
}

/** A number, exactly. */
fun Val?.exact(): BigDecimal? = when (val v = inner()) {
    is Val.Num -> v.n.toBigDecimalOrNull()
    is Val.Case -> v.token.firstOrNull().exact()
    else -> null
}

/** A bool, or [or] when it isn't one. */
fun Val?.flag(or: Boolean = false): Boolean = (inner() as? Val.Bool)?.b ?: or

/** A case's name: `press_kind.TOGGLE` is "TOGGLE". */
fun Val?.case(): String? = (inner() as? Val.Case)?.name

/** A list's items (through an `opt`); empty for anything else. */
fun Val?.items(): List<Val> = (inner() as? Val.Items)?.items ?: emptyList()

/** A token case's value as the build gives it, or the plain value itself. */
fun Val?.token(): Val? = when (val v = inner()) {
    is Val.Case -> v.token.firstOrNull() ?: v
    else -> v
}

/** A template's text: its pieces with each hole's shown text between them. */
fun templateText(v: Val?): String {
    val pieces = v.field("pieces").items()
    val holes = v.field("holes").items()
    return pieces.mapIndexed { k, p -> p.str() + (holes.getOrNull(k)?.let { it.field("value").str() } ?: "") }.joinToString("")
}

private fun richWords(v: Val): String = v.field("segments").items().joinToString("") { seg ->
    val part = seg.field("part")
    when (part.case()) {
        "TEXT", "CODE" -> part.field("value").str()
        "MATH" -> templateText(part.field("tex").field("tex"))
        "IMAGE" -> part.field("alt").str()
        "NOTE" -> part.field("mark").str()
        "BREAK" -> "\n"
        else -> ""
    }
}

/** A point's x and y, in its own units. */
data class XY(val x: Double, val y: Double)

fun Val?.point(): XY? {
    val x = field("x").num() ?: return null
    val y = field("y").num() ?: return null
    return XY(x, y)
}

/** A region's corners, ordered: low x and y, high x and y. */
data class Box2(val x0: Double, val y0: Double, val x1: Double, val y1: Double) {
    val width get() = x1 - x0
    val height get() = y1 - y0
}

fun Val?.region(): Box2? {
    val a = field("from").point() ?: return null
    val b = field("to").point() ?: return null
    return Box2(minOf(a.x, b.x), minOf(a.y, b.y), maxOf(a.x, b.x), maxOf(a.y, b.y))
}

/** Making values to write back. */
object V {
    fun text(s: String): Val = Val.Text(s)
    fun bool(b: Boolean): Val = Val.Bool(b)
    fun num(n: BigDecimal): Val = Val.Num(show(n))
    fun num(n: Long): Val = Val.Num(n.toString())
    fun some(v: Val): Val = Val.Opt(listOf(v))
    val none: Val = Val.Opt(emptyList())
    fun record(type: String, vararg fields: Pair<String, Val>): Val = Val.Record(type, fields.map { Field(it.first, it.second) })
    fun point(x: BigDecimal, y: BigDecimal): Val = record("core/point", "x" to num(x), "y" to num(y))

    /** A decimal as MKP writes it: no exponent, no trailing zeros, no negative zero. */
    fun show(n: BigDecimal): String {
        val s = n.stripTrailingZeros()
        if (s.signum() == 0) return "0"
        return s.toPlainString()
    }

    /** A Double from the screen as an exact decimal, rounded to [places] (a drag's pixels). */
    fun decimal(x: Double, places: Int = 2): BigDecimal =
        BigDecimal(x).setScale(places, RoundingMode.HALF_EVEN).stripTrailingZeros()

    /** Division as MKP does it, to 34 digits. */
    fun div(a: BigDecimal, b: BigDecimal): BigDecimal = a.divide(b, MathContext.DECIMAL128)
}

/** A value in the IR's JSON form (`{"num": "35"}`), for the bindings' `*_json` methods and `PageInit`. */
fun Val.toIrJson(): String = StringBuilder().also { irJson(this, it) }.toString()

private fun irJson(v: Val, out: StringBuilder) {
    fun str(s: String) {
        out.append('"')
        for (c in s) when {
            c == '"' -> out.append("\\\"")
            c == '\\' -> out.append("\\\\")
            c == '\n' -> out.append("\\n")
            c == '\r' -> out.append("\\r")
            c == '\t' -> out.append("\\t")
            c < ' ' -> out.append("\\u%04x".format(c.code))
            else -> out.append(c)
        }
        out.append('"')
    }
    fun fields(fs: List<Field>) {
        out.append('{')
        fs.forEachIndexed { k, f ->
            if (k > 0) out.append(',')
            str(f.name)
            out.append(':')
            irJson(f.value, out)
        }
        out.append('}')
    }
    when (v) {
        is Val.Num -> { out.append("{\"num\":"); str(v.n); out.append('}') }
        is Val.Text -> { out.append("{\"text\":"); str(v.s); out.append('}') }
        is Val.Bool -> out.append("{\"bool\":${v.b}}")
        is Val.Duration -> { out.append("{\"duration\":"); str(v.ms); out.append('}') }
        is Val.Items -> {
            out.append("{\"list\":[")
            v.items.forEachIndexed { k, x -> if (k > 0) out.append(','); irJson(x, out) }
            out.append("]}")
        }
        is Val.Record -> { out.append("{\"record\":{\"type\":"); str(v.ty); out.append(",\"fields\":"); fields(v.fields); out.append("}}") }
        is Val.Case -> {
            out.append("{\"case\":{\"enum\":"); str(v.ty); out.append(",\"name\":"); str(v.name)
            if (v.values.isNotEmpty()) { out.append(",\"values\":"); fields(v.values) }
            out.append("}}")
        }
        is Val.Opt -> {
            val x = v.value.firstOrNull()
            if (x == null) out.append("{\"none\":{}}") else { out.append("{\"some\":"); irJson(x, out); out.append('}') }
        }
        is Val.Range -> {
            out.append("{\"range\":{")
            var first = true
            for ((k, x) in listOf("low" to v.low, "high" to v.high, "step" to v.step)) {
                val one = x.firstOrNull() ?: continue
                if (!first) out.append(',')
                first = false
                str(k); out.append(':'); irJson(one, out)
            }
            out.append("}}")
        }
        is Val.Fn, is Val.View -> out.append("{\"none\":{}}")
    }
}

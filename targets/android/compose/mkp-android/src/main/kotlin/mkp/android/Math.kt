package mkp.android

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.BaselineShift
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.em

// TeX as @mkp/dom reads it (targets/ts/dom/src/tex.ts): the same reader, the same commands, and
// the same tree as its MathML (identifiers, numbers, operators, text, scripts, limits, fractions,
// roots, accents, fences, spaces). Compose has no MathML, so the tree is drawn two ways:
//
// - on a line of its own (`math`), laid out as boxes and drawn on a Canvas: scripts smaller and
//   raised or lowered, a big operator's limits above and below it, a fraction stacked over its bar,
//   a root under its sign;
// - in a sentence, as an AnnotatedString: scripts smaller with a baseline shift, a fraction as a/b.
//
// TeX the reader doesn't know is shown as itself, in the mono font. The TeX itself is the
// accessible text either way.

/** A piece of maths, as MathML's elements are. */
sealed class Mx {
    /** An identifier (`i`: italic when it is one letter), a number (`n`), an operator (`o`) or text (`t`). */
    data class Atom(val text: String, val kind: Char, val large: Boolean = false) : Mx()
    data class Row(val kids: List<Mx>) : Mx()
    /** Scripts; `limits` when a big operator takes them above and below, on a line of its own. */
    data class Scripts(val base: Mx, val sub: Mx?, val sup: Mx?, val limits: Boolean) : Mx()
    data class Frac(val num: Mx, val den: Mx) : Mx()
    data class Root(val body: Mx, val index: Mx?) : Mx()
    data class Accent(val body: Mx, val mark: String) : Mx()
    data class Fenced(val open: String, val body: Mx, val close: String) : Mx()
    data class Space(val em: Float) : Mx()
}

private val GREEK = mapOf(
    "alpha" to "α", "beta" to "β", "gamma" to "γ", "delta" to "δ", "epsilon" to "ϵ", "varepsilon" to "ε", "zeta" to "ζ",
    "eta" to "η", "theta" to "θ", "vartheta" to "ϑ", "iota" to "ι", "kappa" to "κ", "lambda" to "λ", "mu" to "μ", "nu" to "ν",
    "xi" to "ξ", "pi" to "π", "varpi" to "ϖ", "rho" to "ρ", "varrho" to "ϱ", "sigma" to "σ", "varsigma" to "ς", "tau" to "τ",
    "upsilon" to "υ", "phi" to "ϕ", "varphi" to "φ", "chi" to "χ", "psi" to "ψ", "omega" to "ω",
    "Gamma" to "Γ", "Delta" to "Δ", "Theta" to "Θ", "Lambda" to "Λ", "Xi" to "Ξ", "Pi" to "Π", "Sigma" to "Σ", "Upsilon" to "Υ",
    "Phi" to "Φ", "Psi" to "Ψ", "Omega" to "Ω", "infty" to "∞", "partial" to "∂", "nabla" to "∇", "ell" to "ℓ", "hbar" to "ℏ",
    "emptyset" to "∅", "aleph" to "ℵ",
)

private val OPS = mapOf(
    "cdot" to "⋅", "times" to "×", "div" to "÷", "pm" to "±", "mp" to "∓", "ast" to "∗", "star" to "⋆", "circ" to "∘", "bullet" to "∙",
    "le" to "≤", "leq" to "≤", "ge" to "≥", "geq" to "≥", "ne" to "≠", "neq" to "≠", "approx" to "≈", "equiv" to "≡", "sim" to "∼",
    "simeq" to "≃", "cong" to "≅", "propto" to "∝", "ll" to "≪", "gg" to "≫", "to" to "→", "rightarrow" to "→", "leftarrow" to "←",
    "gets" to "←", "leftrightarrow" to "↔", "Rightarrow" to "⇒", "Leftarrow" to "⇐", "Leftrightarrow" to "⇔", "implies" to "⟹",
    "iff" to "⟺", "mapsto" to "↦", "uparrow" to "↑", "downarrow" to "↓", "in" to "∈", "notin" to "∉", "ni" to "∋", "subset" to "⊂",
    "subseteq" to "⊆", "supset" to "⊃", "supseteq" to "⊇", "cup" to "∪", "cap" to "∩", "setminus" to "∖", "forall" to "∀",
    "exists" to "∃", "neg" to "¬", "lnot" to "¬", "land" to "∧", "wedge" to "∧", "lor" to "∨", "vee" to "∨", "oplus" to "⊕",
    "otimes" to "⊗", "mid" to "∣", "parallel" to "∥", "perp" to "⊥", "angle" to "∠", "prime" to "′", "ldots" to "…", "cdots" to "⋯",
    "vdots" to "⋮", "ddots" to "⋱", "dots" to "…", "langle" to "⟨", "rangle" to "⟩", "lfloor" to "⌊", "rfloor" to "⌋",
    "lceil" to "⌈", "rceil" to "⌉", "vert" to "|", "Vert" to "‖", "|" to "‖", "{" to "{", "}" to "}", "%" to "%", "$" to "$",
    "&" to "&", "#" to "#", "_" to "_", "," to " ", ";" to " ", ":" to " ", "!" to "",
)

private val BIG = mapOf("sum" to "∑", "prod" to "∏", "coprod" to "∐", "int" to "∫", "iint" to "∬", "oint" to "∮", "bigcup" to "⋃", "bigcap" to "⋂")
private val NAMED = setOf("sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "log", "ln", "lg", "exp", "lim", "max", "min", "sup", "inf", "det", "gcd", "deg", "arg", "dim", "ker", "Pr")
private val ACCENTS = mapOf("hat" to "^", "widehat" to "^", "bar" to "¯", "overline" to "‾", "vec" to "→", "dot" to "˙", "ddot" to "¨", "tilde" to "~", "widetilde" to "~")
private val SPACES = mapOf("quad" to 1f, "qquad" to 2f, " " to 0.25f)

private class Unknown : Exception()

/** TeX as tokens: a command, one character, or a run of digits. */
private fun tokens(tex: String): List<String> {
    val out = ArrayList<String>()
    var k = 0
    val number = Regex("^(?:[0-9]+(?:\\.[0-9]+)?|\\.[0-9]+)")
    while (k < tex.length) {
        val c = tex[k]
        if (c == '\\') {
            if (k + 1 >= tex.length) throw Unknown()
            var e = k + 1
            if (tex[e].isLetter() && tex[e] < '\u0080') while (e < tex.length && tex[e].isLetter() && tex[e] < '\u0080') e++ else e++
            out += tex.substring(k, e)
            k = e
        } else {
            val m = number.find(tex.substring(k))
            if (m != null) {
                out += m.value
                k += m.value.length
            } else {
                out += c.toString()
                k++
            }
        }
    }
    return out
}

private class TexReader(val t: List<String>) {
    var k = 0

    fun peek(): String? {
        while (k < t.size && t[k].isBlank() && t[k].length == 1) k++
        return t.getOrNull(k)
    }

    fun next(): String = peek()?.also { k++ } ?: throw Unknown()

    /** Atoms until a closing brace, `\right` or the end. */
    fun row(stop: String? = null): Mx {
        val kids = ArrayList<Mx>()
        while (true) {
            val x = peek()
            if (x == null || x == stop || x == "}" || x == "\\right") break
            if (x == "&" || x == "\\\\") throw Unknown()
            kids += scripted()
        }
        return kids.singleOrNull() ?: Mx.Row(kids)
    }

    private fun scripted(): Mx {
        val before = peek()
        val base = atom()
        val big = before != null && before.removePrefix("\\") in BIG && before.startsWith("\\")
        var sub: Mx? = null
        var sup: Mx? = null
        while (true) {
            when (peek()) {
                "^" -> if (sup == null) { k++; sup = atom() } else break
                "_" -> if (sub == null) { k++; sub = atom() } else break
                "'" -> { k++; sup = Mx.Atom("′", 'o') }
                else -> break
            }
        }
        return if (sub == null && sup == null) base else Mx.Scripts(base, sub, sup, big)
    }

    private fun group(): Mx {
        if (peek() == "{") {
            k++
            val r = row("}")
            if (next() != "}") throw Unknown()
            return r
        }
        return atom()
    }

    /** A brace group's characters as they are written, for \text. */
    private fun rawGroup(): String {
        if (peek() != "{") return next()
        k++
        var depth = 0
        val out = StringBuilder()
        while (k < t.size) {
            val x = t[k++]
            if (x == "{") depth++
            else if (x == "}" && depth-- == 0) return out.toString()
            out.append(if (x.startsWith("\\") && x.length == 2) x.substring(1) else x)
        }
        throw Unknown()
    }

    private fun fence(): String {
        val x = next()
        return if (x == ".") "" else if (x.startsWith("\\")) OPS[x.substring(1)] ?: x.substring(1) else x
    }

    private fun atom(): Mx {
        val x = next()
        if (x == "{") {
            k--
            return group()
        }
        if (x.all { it.isDigit() || it == '.' }) return Mx.Atom(x, 'n')
        if (x.length == 1 && x[0].isLetter() && x[0] < '\u0080') return Mx.Atom(x, 'i')
        if (!x.startsWith("\\")) {
            return when {
                x == "-" -> Mx.Atom("−", 'o')
                x == "*" -> Mx.Atom("∗", 'o')
                x in listOf("+", "=", "<", ">", "/", ",", ";", ":", "!", "|", "(", ")", "[", "]", "?") -> Mx.Atom(x, 'o')
                x.isBlank() -> Mx.Row(emptyList())
                x == "^" || x == "_" || x == "}" -> throw Unknown()
                else -> Mx.Atom(x, 'i')
            }
        }
        val name = x.substring(1)
        return when {
            name == "frac" || name == "dfrac" || name == "tfrac" -> Mx.Frac(group(), group())
            name == "sqrt" -> if (peek() == "[") {
                k++
                val n = row("]")
                if (next() != "]") throw Unknown()
                Mx.Root(group(), n)
            } else Mx.Root(group(), null)
            name == "left" -> {
                val open = fence()
                val body = row()
                if (next() != "\\right") throw Unknown()
                Mx.Fenced(open, body, fence())
            }
            name in listOf("text", "mathrm", "textrm") -> Mx.Atom(rawGroup(), 't')
            name == "operatorname" -> rawGroup().let { Mx.Atom(it, if (it.length > 1) 't' else 'i') }
            name in listOf("mathbf", "mathit", "mathsf", "mathcal", "boldsymbol") -> group()
            name in ACCENTS -> Mx.Accent(group(), ACCENTS.getValue(name))
            name in SPACES -> Mx.Space(SPACES.getValue(name))
            name in GREEK -> Mx.Atom(GREEK.getValue(name), 'i')
            name in BIG -> Mx.Atom(BIG.getValue(name), 'o', large = true)
            name in NAMED -> Mx.Atom(name, 't')
            name in OPS -> Mx.Atom(OPS.getValue(name), 'o')
            else -> throw Unknown()
        }
    }

    fun done() = peek() == null
}

/** TeX as a tree, or null when this reader doesn't know some of it (it is then shown as itself). */
fun readTex(tex: String): Mx? = try {
    val r = TexReader(tokens(tex))
    val body = r.row()
    if (r.done()) body else null
} catch (_: Unknown) {
    null
} catch (_: IndexOutOfBoundsException) {
    null
}

/** Operators set off by space on both sides, as MathML spaces them. */
private val RELATIONS = setOf("=", "<", ">", "≤", "≥", "≠", "≈", "≡", "∼", "≃", "≅", "∝", "≪", "≫", "→", "←", "↔", "⇒", "⇐", "⇔", "⟹", "⟺", "↦", "∈", "∉", "∋", "⊂", "⊆", "⊃", "⊇", "∣", "∥", "⊥")
private val BINARY = setOf("+", "−", "±", "∓", "×", "÷", "⋅", "∗", "⋆", "∘", "∙", "∪", "∩", "∖", "∧", "∨", "⊕", "⊗")

private fun spacing(op: String): Pair<Float, Float> = when (op) {
    in RELATIONS -> 0.28f to 0.28f
    in BINARY -> 0.22f to 0.22f
    ",", ";" -> 0f to 0.17f
    else -> 0f to 0f
}

// ---- in a sentence: an AnnotatedString

/** Whether a fraction's part needs brackets to be read as a/b: a top-level operator in it. */
private fun needsBrackets(m: Mx): Boolean {
    if (m !is Mx.Row) return false
    var depth = 0
    for (k in m.kids) {
        if (k !is Mx.Atom || k.kind != 'o') continue
        when (k.text) {
            "(", "[" -> depth++
            ")", "]" -> depth--
            else -> if (depth == 0 && (k.text in RELATIONS || k.text in BINARY || k.text == "/")) return true
        }
    }
    return false
}

private fun AnnotatedString.Builder.inline(m: Mx) {
    when (m) {
        is Mx.Atom -> when (m.kind) {
            'i' -> withStyle(SpanStyle(fontStyle = if (m.text.length == 1) FontStyle.Italic else FontStyle.Normal)) { append(m.text) }
            'o' -> {
                val (l, r) = spacing(m.text)
                append((if (l > 0) " " else "") + m.text + (if (r > 0) " " else ""))
            }
            else -> withStyle(SpanStyle(fontStyle = FontStyle.Normal)) { append(m.text) }
        }
        is Mx.Row -> m.kids.forEach { inline(it) }
        is Mx.Scripts -> {
            inline(m.base)
            m.sub?.let { withStyle(SpanStyle(fontSize = 0.7.em, baselineShift = BaselineShift(-0.25f))) { inline(it) } }
            m.sup?.let { withStyle(SpanStyle(fontSize = 0.7.em, baselineShift = BaselineShift(0.45f))) { inline(it) } }
        }
        is Mx.Frac -> {
            fun part(p: Mx) = if (needsBrackets(p)) { append("("); inline(p); append(")") } else inline(p)
            part(m.num)
            append("/")
            part(m.den)
        }
        is Mx.Root -> {
            m.index?.let { withStyle(SpanStyle(fontSize = 0.6.em, baselineShift = BaselineShift(0.5f))) { inline(it) } }
            append("√")
            if (m.body is Mx.Row && m.body.kids.size > 1) { append("("); inline(m.body); append(")") } else inline(m.body)
        }
        is Mx.Accent -> {
            inline(m.body)
            append(when (m.mark) { "^" -> "̂"; "¯", "‾" -> "̅"; "→" -> "⃗"; "˙" -> "̇"; "¨" -> "̈"; else -> "̃" })
        }
        is Mx.Fenced -> { append(m.open); inline(m.body); append(m.close) }
        is Mx.Space -> append(if (m.em >= 1f) " ".repeat(m.em.toInt()) else " ")
    }
}

/** Inline maths for a sentence: scripts raised and lowered, smaller; TeX it doesn't know as itself. */
fun AnnotatedString.Builder.appendTex(tex: String) {
    val m = readTex(tex.trim())
    if (m == null) {
        withStyle(SpanStyle(fontFamily = FontFamily.Monospace, fontSize = 0.9.em)) { append(tex) }
        return
    }
    withStyle(SpanStyle(fontFamily = FontFamily.Serif, fontStyle = FontStyle.Normal)) { inline(m) }
}

/** The text of inline maths, as a sentence draws it (its scripts' styles left out). */
fun texText(tex: String): String = AnnotatedString.Builder().apply { appendTex(tex) }.toAnnotatedString().text

// ---- on a line of its own: boxes on a Canvas

/** A box of maths: its width, how far it goes above its baseline and below, and how to draw it. */
private class MBox(val w: Float, val asc: Float, val desc: Float, val draw: DrawScope.(x: Float, baseline: Float) -> Unit)

private class Layouter(val measurer: TextMeasurer, val color: Color, val toSp: (Float) -> TextUnit) {
    fun text(s: String, size: Float, italic: Boolean): MBox {
        val r = measurer.measure(AnnotatedString(s), TextStyle(fontSize = toSp(size), fontFamily = FontFamily.Serif, fontStyle = if (italic) FontStyle.Italic else FontStyle.Normal))
        val asc = r.firstBaseline
        return MBox(r.size.width.toFloat(), asc, r.size.height - asc) { x, b -> drawText(r, color, Offset(x, b - asc)) }
    }

    fun row(boxes: List<MBox>): MBox {
        val w = boxes.sumOf { it.w.toDouble() }.toFloat()
        val asc = boxes.maxOfOrNull { it.asc } ?: 0f
        val desc = boxes.maxOfOrNull { it.desc } ?: 0f
        return MBox(w, asc, desc) { x, b ->
            var at = x
            for (c in boxes) {
                c.draw(this, at, b)
                at += c.w
            }
        }
    }

    fun space(w: Float) = MBox(w, 0f, 0f) { _, _ -> }

    fun layout(m: Mx, size: Float, display: Boolean): MBox = when (m) {
        is Mx.Atom -> when (m.kind) {
            'i' -> text(m.text, size, m.text.length == 1)
            'o' -> {
                val (l, r) = spacing(m.text)
                val glyph = text(m.text, if (m.large && display) size * 1.45f else size, false)
                if (l == 0f && r == 0f) glyph else row(listOf(space(l * size), glyph, space(r * size)))
            }
            else -> text(m.text, size, false)
        }
        is Mx.Row -> row(m.kids.map { layout(it, size, display) })
        is Mx.Scripts -> scripts(m, size, display)
        is Mx.Frac -> frac(m, size, display)
        is Mx.Root -> root(m, size, display)
        is Mx.Accent -> {
            val body = layout(m.body, size, display)
            val mark = text(m.mark, size * 0.9f, false)
            val lift = body.asc + mark.desc * 0.2f
            MBox(maxOf(body.w, mark.w), lift + mark.asc * 0.6f, body.desc) { x, b ->
                body.draw(this, x + (maxOf(body.w, mark.w) - body.w) / 2, b)
                mark.draw(this, x + (maxOf(body.w, mark.w) - mark.w) / 2, b - body.asc + mark.asc * 0.55f)
            }
        }
        is Mx.Fenced -> {
            val body = layout(m.body, size, display)
            // the fences grow with what they hold
            val grow = ((body.asc + body.desc) / (size * 1.15f)).coerceAtLeast(1f)
            val open = if (m.open.isEmpty()) space(0f) else text(m.open, size * grow, false)
            val close = if (m.close.isEmpty()) space(0f) else text(m.close, size * grow, false)
            val shift = (open.asc - open.desc - (body.asc - body.desc)) / 2
            MBox(open.w + body.w + close.w, maxOf(body.asc, open.asc - shift), maxOf(body.desc, open.desc + shift)) { x, b ->
                open.draw(this, x, b + shift)
                body.draw(this, x + open.w, b)
                close.draw(this, x + open.w + body.w, b + shift)
            }
        }
        is Mx.Space -> space(m.em * size)
    }

    private fun scripts(m: Mx.Scripts, size: Float, display: Boolean): MBox {
        val base = layout(m.base, size, display)
        val small = size * 0.7f
        val sub = m.sub?.let { layout(it, small, false) }
        val sup = m.sup?.let { layout(it, small, false) }
        if (m.limits && display) {
            // a big operator's limits, centred above and below it
            val w = maxOf(base.w, sub?.w ?: 0f, sup?.w ?: 0f)
            val gap = size * 0.08f
            val asc = base.asc + (sup?.let { gap + it.asc + it.desc } ?: 0f)
            val desc = base.desc + (sub?.let { gap + it.asc + it.desc } ?: 0f)
            return MBox(w + size * 0.1f, asc, desc) { x, b ->
                base.draw(this, x + (w - base.w) / 2, b)
                sup?.let { it.draw(this, x + (w - it.w) / 2, b - base.asc - gap - it.desc) }
                sub?.let { it.draw(this, x + (w - it.w) / 2, b + base.desc + gap + it.asc) }
            }
        }
        val up = maxOf(size * 0.42f, base.asc - small * 0.4f)
        val down = if (sup != null) size * 0.3f else size * 0.22f
        val w = base.w + maxOf(sub?.w ?: 0f, sup?.w ?: 0f) + size * 0.05f
        val asc = maxOf(base.asc, sup?.let { up + it.asc } ?: 0f)
        val desc = maxOf(base.desc, sub?.let { down + it.desc } ?: 0f)
        return MBox(w, asc, desc) { x, b ->
            base.draw(this, x, b)
            sup?.draw(this, x + base.w + size * 0.03f, b - up)
            sub?.draw(this, x + base.w + size * 0.03f, b + down)
        }
    }

    private fun frac(m: Mx.Frac, size: Float, display: Boolean): MBox {
        val part = if (display) size * 0.9f else size * 0.75f
        val num = layout(m.num, part, false)
        val den = layout(m.den, part, false)
        val w = maxOf(num.w, den.w) + size * 0.2f
        val axis = size * 0.27f
        val bar = maxOf(1f, size * 0.05f)
        val gap = size * 0.12f
        val asc = axis + bar / 2 + gap + num.desc + num.asc
        val desc = -axis + bar / 2 + gap + den.asc + den.desc
        return MBox(w + size * 0.1f, asc, desc) { x, b ->
            val left = x + size * 0.05f
            num.draw(this, left + (w - num.w) / 2, b - axis - bar / 2 - gap - num.desc)
            drawLine(color, Offset(left, b - axis), Offset(left + w, b - axis), bar)
            den.draw(this, left + (w - den.w) / 2, b - axis + bar / 2 + gap + den.asc)
        }
    }

    private fun root(m: Mx.Root, size: Float, display: Boolean): MBox {
        val body = layout(m.body, size, display)
        val index = m.index?.let { layout(it, size * 0.55f, false) }
        val gap = size * 0.12f
        val sign = size * 0.55f
        val lead = (index?.w ?: 0f).coerceAtLeast(0f)
        val top = body.asc + gap
        val stroke = maxOf(1f, size * 0.05f)
        return MBox(lead + sign + body.w + size * 0.1f, top + stroke, body.desc) { x, b ->
            val sx = x + lead
            val p = Path().apply {
                moveTo(sx, b - size * 0.3f)
                lineTo(sx + sign * 0.3f, b - size * 0.38f)
                lineTo(sx + sign * 0.55f, b + body.desc)
                lineTo(sx + sign, b - top)
                lineTo(sx + sign + body.w + size * 0.05f, b - top)
            }
            drawPath(p, color, style = Stroke(stroke))
            index?.draw(this, x, b - size * 0.45f)
            body.draw(this, sx + sign + size * 0.02f, b)
        }
    }
}

/** Maths on a line of its own, laid out from its tree in the box engine above, at [fontSize] in [color]. */
@Composable
fun MathBlock(tree: Mx, color: Color, fontSize: TextUnit, modifier: Modifier = Modifier) {
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val px = with(density) { fontSize.toPx() }
    val box = remember(tree, px, color, density) {
        Layouter(measurer, color) { with(density) { it.toSp() } }.layout(tree, px, true)
    }
    val pad = px * 0.15f
    with(density) {
        Canvas(modifier.size((box.w + 2 * pad).toDp(), (box.asc + box.desc + 2 * pad).toDp())) {
            box.draw(this, pad, pad + box.asc)
        }
    }
}

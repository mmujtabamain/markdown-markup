package mkp.android

// TeX drawn as Unicode text on one line: Greek, operators, big operators and accents as their
// characters, scripts as superscript and subscript characters where Unicode has them (else
// `^(…)` and `_(…)`), `\frac{a}{b}` as `a⁄b`, `\sqrt{x}` as `√x`, and `\text{…}` as itself.
// Compose has no maths layout; the TeX itself stays the element's accessible text, as @mkp/dom
// keeps it. TeX this reader doesn't know is shown as itself.

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
    "&" to "&", "#" to "#", "_" to "_", "," to " ", ";" to " ", ":" to " ", "!" to "", " " to " ", "quad" to "  ", "qquad" to "    ",
    "sum" to "∑", "prod" to "∏", "coprod" to "∐", "int" to "∫", "iint" to "∬", "oint" to "∮", "bigcup" to "⋃", "bigcap" to "⋂",
    "left" to "", "right" to "", "big" to "", "Big" to "", "displaystyle" to "", "limits" to "",
)

private val NAMED = setOf("sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "log", "ln", "lg", "exp", "lim", "max", "min", "sup", "inf", "det", "gcd", "deg", "arg", "dim", "ker", "Pr")
private val ACCENTS = mapOf("hat" to "̂", "widehat" to "̂", "bar" to "̄", "overline" to "̅", "vec" to "⃗", "dot" to "̇", "ddot" to "̈", "tilde" to "̃", "widetilde" to "̃")
private const val SUP_FROM = "0123456789+-=()niax"
private const val SUP_TO = "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱᵃˣ"
private const val SUB_FROM = "0123456789+-=()aeoxij"
private const val SUB_TO = "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₒₓᵢⱼ"

private class Unknown : Exception()

private class TexReader(val tex: String) {
    var k = 0

    fun group(): String {
        skipSpace()
        if (k >= tex.length) return ""
        if (tex[k] == '{') {
            k++
            val out = StringBuilder()
            while (k < tex.length && tex[k] != '}') out.append(atom())
            if (k >= tex.length) throw Unknown()
            k++
            return out.toString()
        }
        return atom()
    }

    fun skipSpace() {
        while (k < tex.length && tex[k] == ' ') k++
    }

    fun script(s: String, from: String, to: String, mark: Char): String =
        if (s.isNotEmpty() && s.all { from.indexOf(it) >= 0 }) s.map { to[from.indexOf(it)] }.joinToString("")
        else if (s.length == 1) "$mark$s" else "$mark($s)"

    fun atom(): String {
        val c = tex[k]
        when {
            c == '\\' -> {
                k++
                if (k >= tex.length) throw Unknown()
                val start = k
                if (tex[k].isLetter()) while (k < tex.length && tex[k].isLetter()) k++ else k++
                val name = tex.substring(start, k)
                GREEK[name]?.let { return it }
                OPS[name]?.let { return it }
                if (name in NAMED) return name
                ACCENTS[name]?.let { return group() + it }
                return when (name) {
                    "frac", "dfrac", "tfrac" -> {
                        val a = group()
                        val b = group()
                        "${if (a.length > 1) "($a)" else a}⁄${if (b.length > 1) "($b)" else b}"
                    }
                    "sqrt" -> {
                        val g = group()
                        if (g.length > 1) "√($g)" else "√$g"
                    }
                    "text", "mathrm", "mathbf", "mathit", "operatorname", "mathbb", "mathcal" -> group()
                    else -> throw Unknown()
                }
            }
            c == '^' -> { k++; return script(group(), SUP_FROM, SUP_TO, '^') }
            c == '_' -> { k++; return script(group(), SUB_FROM, SUB_TO, '_') }
            c == '{' -> return group()
            c == '}' -> throw Unknown()
            else -> { k++; return c.toString() }
        }
    }

    fun all(): String {
        val out = StringBuilder()
        while (k < tex.length) out.append(atom())
        return out.toString()
    }
}

/** TeX as the Unicode text drawn for it; TeX the reader doesn't know is shown as itself. */
fun texText(tex: String): String = try {
    TexReader(tex.trim()).all()
} catch (_: Unknown) {
    tex
} catch (_: IndexOutOfBoundsException) {
    tex
}

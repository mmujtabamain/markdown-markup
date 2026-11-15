// TeX drawn as MathML, which every current browser lays out natively: a small reader for the
// common part of TeX (scripts, fractions, roots, fences, Greek, operators, accents, text). The
// TeX itself is the element's accessible text. TeX it doesn't know is shown as itself.

const MATHML = "http://www.w3.org/1998/Math/MathML";

const GREEK: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ϵ", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ",
  iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", varpi: "ϖ", rho: "ρ", varrho: "ϱ", sigma: "σ",
  varsigma: "ς", tau: "τ", upsilon: "υ", phi: "ϕ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  infty: "∞", partial: "∂", nabla: "∇", ell: "ℓ", hbar: "ℏ", emptyset: "∅", aleph: "ℵ",
};

const OPS: Record<string, string> = {
  cdot: "⋅", times: "×", div: "÷", pm: "±", mp: "∓", ast: "∗", star: "⋆", circ: "∘", bullet: "∙",
  le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠", approx: "≈", equiv: "≡", sim: "∼", simeq: "≃", cong: "≅", propto: "∝",
  ll: "≪", gg: "≫", to: "→", rightarrow: "→", leftarrow: "←", gets: "←", leftrightarrow: "↔", Rightarrow: "⇒", Leftarrow: "⇐",
  Leftrightarrow: "⇔", implies: "⟹", iff: "⟺", mapsto: "↦", uparrow: "↑", downarrow: "↓",
  in: "∈", notin: "∉", ni: "∋", subset: "⊂", subseteq: "⊆", supset: "⊃", supseteq: "⊇", cup: "∪", cap: "∩", setminus: "∖",
  forall: "∀", exists: "∃", neg: "¬", lnot: "¬", land: "∧", wedge: "∧", lor: "∨", vee: "∨", oplus: "⊕", otimes: "⊗",
  mid: "∣", parallel: "∥", perp: "⊥", angle: "∠", prime: "′", ldots: "…", cdots: "⋯", vdots: "⋮", ddots: "⋱", dots: "…",
  langle: "⟨", rangle: "⟩", lfloor: "⌊", rfloor: "⌋", lceil: "⌈", rceil: "⌉", vert: "|", Vert: "‖", "|": "‖",
  "{": "{", "}": "}", "%": "%", "$": "$", "&": "&", "#": "#", _: "_", ",": " ", ";": " ", ":": " ", "!": "",
};

const BIG: Record<string, string> = { sum: "∑", prod: "∏", coprod: "∐", int: "∫", iint: "∬", oint: "∮", bigcup: "⋃", bigcap: "⋂" };
const NAMED = ["sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "log", "ln", "lg", "exp", "lim", "max", "min", "sup", "inf", "det", "gcd", "deg", "arg", "dim", "ker", "Pr"];
const ACCENTS: Record<string, string> = { hat: "^", widehat: "^", bar: "¯", overline: "‾", vec: "→", dot: "˙", ddot: "¨", tilde: "~", widetilde: "~" };
const SPACES: Record<string, string> = { quad: "1em", qquad: "2em", " ": "0.25em" };

class Unknown extends Error {}

/** TeX as tokens: a command, one character, or a run of digits. */
function tokens(tex: string): string[] {
  const out: string[] = [];
  for (let k = 0; k < tex.length; ) {
    const c = tex[k];
    if (c === "\\") {
      const m = /^\\([A-Za-z]+|.)/s.exec(tex.slice(k));
      if (!m) throw new Unknown("a lone backslash");
      out.push(m[0]);
      k += m[0].length;
    } else if (/^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)/.test(tex.slice(k))) {
      const m = /^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)/.exec(tex.slice(k))!;
      out.push(m[0]);
      k += m[0].length;
    } else {
      out.push(c);
      k += 1;
    }
  }
  return out;
}

class Reader {
  k = 0;
  constructor(private readonly t: string[]) {}

  private peek(): string | undefined {
    while (this.t[this.k] !== undefined && /^\s$/.test(this.t[this.k])) this.k++;
    return this.t[this.k];
  }

  private next(): string {
    const x = this.peek();
    if (x === undefined) throw new Unknown("TeX ended early");
    this.k++;
    return x;
  }

  /** Atoms until a closing brace, `\right` or the end. */
  row(stop?: string): Element {
    const kids: Element[] = [];
    for (;;) {
      const x = this.peek();
      if (x === undefined || x === stop || x === "}" || x === "\\right") break;
      if (x === "&" || x === "\\\\") throw new Unknown("alignment");
      kids.push(this.scripted());
    }
    return kids.length === 1 ? kids[0] : el("mrow", kids);
  }

  /** An atom with its sub- and superscripts. */
  private scripted(): Element {
    const before = this.peek();
    let base = this.atom();
    const big = before !== undefined && before.slice(1) in BIG;
    let sub: Element | undefined;
    let sup: Element | undefined;
    for (;;) {
      const x = this.peek();
      if (x === "^" && !sup) {
        this.k++;
        sup = this.atom();
      } else if (x === "_" && !sub) {
        this.k++;
        sub = this.atom();
      } else if (x === "'") {
        this.k++;
        sup = el("mo", "′");
      } else break;
    }
    if (sub && sup) return el(big ? "munderover" : "msubsup", [base, sub, sup]);
    if (sub) return el(big ? "munder" : "msub", [base, sub]);
    if (sup) return el(big ? "mover" : "msup", [base, sup]);
    return base;
  }

  private group(): Element {
    if (this.peek() === "{") {
      this.k++;
      const r = this.row("}");
      if (this.next() !== "}") throw new Unknown("an open brace");
      return r;
    }
    return this.atom();
  }

  /** A brace group's characters as they are written, for \text. */
  private rawGroup(): string {
    if (this.peek() !== "{") return this.next();
    this.k++;
    let depth = 0;
    let out = "";
    // spaces count here, so the tokens are read as they are
    while (this.k < this.t.length) {
      const x = this.t[this.k++];
      if (x === "{") depth++;
      else if (x === "}" && depth-- === 0) return out;
      out += x.startsWith("\\") && x.length === 2 ? x[1] : x;
    }
    throw new Unknown("an open brace");
  }

  private atom(): Element {
    const x = this.next();
    if (x === "{") {
      this.k--;
      return this.group();
    }
    if (/^[0-9.]+$/.test(x)) return el("mn", x);
    if (/^[A-Za-z]$/.test(x)) return el("mi", x);
    if (!x.startsWith("\\")) {
      if (x === "-") return el("mo", "−");
      if (x === "*") return el("mo", "∗");
      if ("+=<>/,;:!|()[]?".includes(x)) return el("mo", x);
      if (/^\s$/.test(x)) return el("mrow", []);
      if (x === "^" || x === "_" || x === "}") throw new Unknown(`a stray ${x}`);
      return el("mi", x);
    }
    const name = x.slice(1);
    if (name === "frac" || name === "dfrac" || name === "tfrac") return el("mfrac", [this.group(), this.group()]);
    if (name === "sqrt") {
      if (this.peek() === "[") {
        this.k++;
        const n = this.row("]");
        if (this.next() !== "]") throw new Unknown("an open [");
        return el("mroot", [this.group(), n]);
      }
      return el("msqrt", [this.group()]);
    }
    if (name === "left") {
      const open = this.fence();
      const body = this.row();
      if (this.next() !== "\\right") throw new Unknown("\\left without \\right");
      const close = this.fence();
      return el("mrow", [open, body, close]);
    }
    if (name === "text" || name === "mathrm" || name === "textrm" || name === "operatorname") {
      const words = this.rawGroup();
      return name === "operatorname" ? mi(words) : el("mtext", words);
    }
    if (name === "mathbf" || name === "mathit" || name === "mathsf" || name === "mathcal" || name === "boldsymbol") return this.group();
    if (name in ACCENTS) {
      const m = el("mover", [this.group(), el("mo", ACCENTS[name])]);
      m.setAttribute("accent", "true");
      return m;
    }
    if (name in SPACES) {
      const sp = el("mspace", []);
      sp.setAttribute("width", SPACES[name]);
      return sp;
    }
    if (name in GREEK) return el("mi", GREEK[name]);
    if (name in BIG) {
      const o = el("mo", BIG[name]);
      o.setAttribute("largeop", "true");
      return o;
    }
    if (NAMED.includes(name)) return mi(name);
    if (name in OPS) return el("mo", OPS[name]);
    throw new Unknown(`\\${name}`);
  }

  private fence(): Element {
    const x = this.next();
    const c = x === "." ? "" : x.startsWith("\\") ? (OPS[x.slice(1)] ?? x.slice(1)) : x;
    const o = el("mo", c);
    o.setAttribute("stretchy", "true");
    return o;
  }

  done(): boolean {
    return this.peek() === undefined;
  }
}

function el(tag: string, kids: Element[] | string): Element {
  const e = document.createElementNS(MATHML, tag);
  if (typeof kids === "string") e.textContent = kids;
  else e.append(...kids);
  return e;
}

/** A name set upright, as `\sin` is. */
function mi(name: string): Element {
  const e = el("mi", name);
  if ([...name].length > 1) return e;
  e.setAttribute("mathvariant", "normal");
  return e;
}

/** MathML for TeX, or undefined when this reader doesn't know some of it. */
export function texToMathML(tex: string, display: boolean): Element | undefined {
  try {
    const r = new Reader(tokens(tex));
    const body = r.row();
    if (!r.done()) return undefined;
    const ann = el("annotation", tex);
    ann.setAttribute("encoding", "application/x-tex");
    const m = el("math", [el("semantics", [body, ann])]);
    if (display) m.setAttribute("display", "block");
    return m;
  } catch {
    return undefined;
  }
}

/** Draws TeX into a `mkp-math` element: MathML to see, the TeX as its accessible text. */
export function drawTex(into: HTMLElement, tex: string, display: boolean): void {
  if (into.getAttribute("data-tex") === tex && into.firstChild) return;
  into.setAttribute("data-tex", tex);
  into.setAttribute("role", "math");
  into.setAttribute("aria-label", tex);
  const m = texToMathML(tex, display);
  if (m) {
    m.setAttribute("aria-hidden", "true");
    into.classList.remove("mkp-math-tex");
    into.replaceChildren(m);
  } else {
    // TeX this reader doesn't know: shown as it is written
    into.classList.add("mkp-math-tex");
    into.textContent = tex;
  }
}

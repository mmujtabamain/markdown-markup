// The page's tokens as CSS custom properties on the root, so a widget names a token
// (`var(--mkp-color-ink)`) and a theme change is one set of properties, not a redraw of every
// colour. Values come from the build's tokens block, as the evaluator gives them.

import { Value as V, type Page, type Value } from "@mkp/runtime";
import { field, inner, num, str } from "./values.js";

export type Theme = "LIGHT" | "DARK";

/** A token type's short name in a property: `core/color` is `color`, `acme/brand` is `acme-brand`. */
function short(ty: string): string {
  return (ty.startsWith("core/") ? ty.slice(5) : ty.replace("/", "-")).toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

/** The custom property of a token case: `--mkp-color-ink`, `--mkp-space-m`. */
export function tokenVar(ty: string, name: string): string {
  return `--mkp-${short(ty)}-${name.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;
}

export class Tokens {
  private readonly page: Page;
  private readonly named = new Set<string>();
  /** The theme each root's properties were last written for: one page may be mounted twice. */
  private readonly applied = new WeakMap<HTMLElement, Theme>();

  constructor(page: Page) {
    this.page = page;
    for (const t of page.program.tokens.values()) for (const name of Object.keys(t.values)) this.named.add(`${t.name}.${name}`);
  }

  /** The page's theme now: core/page.theme, given by the app. */
  theme(): Theme {
    const t = inner(this.page.externsNow().get("core/page.theme"));
    return t && t.kind === "case" && t.name === "DARK" ? "DARK" : "LIGHT";
  }

  /** A token case's value: a number, a colour's text for the theme, or a record. Anything that
   * isn't a token is itself; none is undefined. */
  value(v: Value | undefined): Value | undefined {
    v = inner(v);
    if (!v || v.kind !== "case" || !this.page.program.tokens.has(v.ty)) return v;
    let out: Value;
    try {
      out = this.page.machine.defaultTokenValue(v);
    } catch {
      return undefined;
    }
    if (out.kind === "record" && out.ty === "core/color_value") return field(out, this.theme() === "DARK" ? "dark" : "light");
    return out;
  }

  /** A token's number: `space.M` is 8. */
  number(v: Value | undefined): number | undefined {
    return num(this.value(v));
  }

  /** A colour token as CSS: its custom property when the build names it, else its value. */
  color(v: Value | undefined): string | undefined {
    v = inner(v);
    if (!v) return undefined;
    if (v.kind === "case" && this.named.has(`${v.ty}.${v.name}`)) return `var(${tokenVar(v.ty, v.name)})`;
    const t = this.value(v);
    return t && t.kind === "text" ? t.s : undefined;
  }

  /** A length token (space, size, radius) as CSS. */
  length(v: Value | undefined): string | undefined {
    v = inner(v);
    if (!v) return undefined;
    if (v.kind === "case" && this.named.has(`${v.ty}.${v.name}`)) return `var(${tokenVar(v.ty, v.name)})`;
    const n = this.number(v);
    return n === undefined ? undefined : `${n}px`;
  }

  /** Writes every token's property on the root, for the theme the page has now. Cheap when the
   * theme hasn't changed since the last time. */
  apply(root: HTMLElement): void {
    const theme = this.theme();
    if (theme === this.applied.get(root)) return;
    this.applied.set(root, theme);
    root.setAttribute("data-mkp-theme", theme.toLowerCase());
    root.style.colorScheme = theme === "DARK" ? "dark" : "light";
    for (const [prop, css] of Object.entries(this.properties())) root.style.setProperty(prop, css);
  }

  /** Every token's custom property and its CSS, for the theme the page has now: what `apply` writes
   * on a root, for a target that renders the root's style itself. */
  properties(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const t of this.page.program.tokens.values()) {
      for (const name of Object.keys(t.values)) {
        let v: Value;
        try {
          v = this.page.machine.defaultTokenValue(V.caseOf(t.name, name));
        } catch {
          continue;
        }
        const prop = tokenVar(t.name, name);
        for (const [suffix, css] of this.cssOf(v)) out[prop + suffix] = css;
      }
    }
    return out;
  }

  /** Removes what apply wrote, when the page is unmounted. */
  clear(root: HTMLElement): void {
    for (const p of [...root.style].filter((p) => p.startsWith("--mkp-"))) root.style.removeProperty(p);
    root.style.colorScheme = "";
    root.removeAttribute("data-mkp-theme");
    this.applied.delete(root);
  }

  /** A token's value as CSS: one property, or one per field for a font. */
  private cssOf(v: Value): [string, string][] {
    if (v.kind === "num") return [["", `${v.n.toNumber()}px`]];
    if (v.kind === "text") return [["", v.s]];
    if (v.kind !== "record") return [];
    switch (v.ty) {
      case "core/color_value":
        return [["", str(field(v, this.theme() === "DARK" ? "dark" : "light"))]];
      case "core/font_value":
        return [
          ["-family", str(field(v, "family"))],
          ["-size", `${num(field(v, "size")) ?? 16}px`],
          ["-weight", str(field(v, "weight")) || "400"],
          ["-line", str(field(v, "line")) || "1.5"],
        ];
      case "core/shadow_value": {
        const tone = this.value(field(v, "tone"));
        return [["", `${num(field(v, "x")) ?? 0}px ${num(field(v, "y")) ?? 0}px ${num(field(v, "blur")) ?? 0}px ${tone?.kind === "text" ? tone.s : "#0000001f"}`]];
      }
    }
    return [];
  }
}

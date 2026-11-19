// Drawing and input: label, image, icon, press, field, slider and overlay, as the native controls
// they are, with their roles and states, as @extended-mark/dom draws them (the same parts and classes, so
// the same stylesheet). What only the live element can do (moving focus along a group of tabs,
// showing a popover) is done in its listeners and hooks.

import { Num, Value as V, type Drawn, type Page, type ir } from "@extended-mark/runtime";
import { exact, FILLED, flag, GLYPHS, inner, kase, safeSrc, str } from "@extended-mark/dom/shared";
import type { ViewWidget } from "../render.js";
import type { Act } from "../act.js";
import { attr, cls, css, h, on, prop, s, type Child, type VNode } from "../vnode.js";

const ALIGN: Record<string, string> = { START: "start", CENTER: "center", END: "end", STRETCH: "justify", BASELINE: "start" };

/** An id unique on the document and the same at every render: the document's prefix and the
 * widget's place. */
export function idOf(uid: string, what: string, d: Drawn): string {
  return `${uid}${what}-${d.path.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

/** A DOM event a control handled, so a clickable flex around it lets it be (as @extended-mark/dom's claim). */
const claimed = new WeakSet<Event>();
export const claim = (e: Event): void => {
  claimed.add(e);
};
export const isClaimed = (e: Event): boolean => claimed.has(e);

// ---- label, image, icon

export const label: ViewWidget = (d, ctx) => {
  const p = (k: string) => d.props.get(k);
  const value = str(p("value"));
  const font = kase(p("font"));
  const a = kase(p("align")) ?? "START";
  const el = h("span", "label", {
    "data-size": (kase(p("size")) ?? "NORMAL").toLowerCase(),
    "data-weight": (kase(p("weight")) ?? "REGULAR").toLowerCase(),
    "data-font": font ? font.toLowerCase() : undefined,
    // a clipped label still says all of itself
    title: flag(p("clip")) ? value : undefined,
  }, [value]);
  css(el, "color", ctx.tokens.color(p("tone")));
  css(el, "text-align", a === "START" ? undefined : ALIGN[a]);
  cls(el, "xtmd-nowrap", !flag(p("wrap"), true));
  cls(el, "xtmd-clip", flag(p("clip")));
  cls(el, "xtmd-halo", flag(p("halo")));
  return el;
};

export const image: ViewWidget = (d, ctx) => {
  const safe = safeSrc(str(d.props.get("src")));
  const el = h("img", "image", { loading: "lazy", decoding: "async", alt: str(d.props.get("alt")), src: safe, "data-unsafe-src": safe ? undefined : "" });
  css(el, "width", ctx.tokens.length(d.props.get("width")));
  return el;
};

/** An icon's SVG for a glyph: drawn in the current colour, sized to the text. */
export function glyph(name: string | undefined, part = "icon"): VNode {
  const el = s("svg", part, { viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false", "data-glyph": name ?? "" }, [s("path", undefined, { d: GLYPHS[name ?? ""] ?? "M12 12v.01" })]);
  return cls(el, "xtmd-filled", FILLED.has(name ?? ""));
}

export const icon: ViewWidget = (d, ctx) => {
  const el = glyph(kase(d.props.get("name")));
  const lbl = str(d.props.get("label"));
  // labelled, it is a picture with a name; otherwise decoration
  attr(el, "role", lbl ? "img" : undefined);
  attr(el, "aria-label", lbl || undefined);
  attr(el, "aria-hidden", lbl ? undefined : "true");
  attr(el, "data-size", (kase(d.props.get("size")) ?? "NORMAL").toLowerCase());
  css(el, "color", ctx.tokens.color(d.props.get("tone")));
  return el;
};

// ---- press

/** Each press kind's role and the attribute its `selected` sets. */
const KINDS: Record<string, { role?: string; state?: string }> = {
  BUTTON: {},
  PLAIN: {},
  TOGGLE: { state: "aria-pressed" },
  TAB: { role: "tab", state: "aria-selected" },
  OPTION: { role: "option", state: "aria-selected" },
  SWITCH: { role: "switch", state: "aria-checked" },
  CHECK: { role: "checkbox", state: "aria-checked" },
  RADIO: { role: "radio", state: "aria-checked" },
};

const GROUPED = new Set(["TAB", "OPTION", "RADIO"]);

export const press: ViewWidget = (d, ctx) => {
  const p = (k: string) => d.props.get(k);
  const kind = kase(p("kind")) ?? "BUTTON";
  const k = KINDS[kind] ?? KINDS.BUTTON;
  const selected = flag(p("selected"));
  const disabled = flag(p("disabled"));
  const nodes = d.slots.get("content") ?? [];
  // with content of its own, the label is its accessible name; with none, its text
  const name = str(p("label"));
  const tone = ctx.tokens.color(p("tone"));
  const lbl = prop(h("span", "press.label", {}, nodes.length ? [] : [name]), "hidden", nodes.length > 0);
  const content = prop(h("span", "press.content", {}, ctx.children(nodes)), "hidden", nodes.length === 0);
  const el = h("button", "press", { type: "button", "data-kind": kind.toLowerCase(), role: k.role, "aria-label": nodes.length ? name : undefined }, [
    h("span", "press.indicator", { "aria-hidden": "true" }),
    lbl,
    content,
  ]);
  for (const a of ["aria-pressed", "aria-selected", "aria-checked"]) attr(el, a, a === k.state ? String(selected) : undefined);
  cls(el, "xtmd-selected", selected);
  cls(el, "xtmd-toned", !!tone);
  css(el, "--xtmd-tone", tone);
  prop(el, "disabled", disabled);
  on(el, "click", (e) => {
    claim(e);
    if (!(e.currentTarget as HTMLButtonElement).disabled) ctx.event("click");
  });
  // tabs, options and radios move along their group with the arrow keys, as native ones do
  if (GROUPED.has(kind)) {
    on(el, "keydown", (e) => {
      const ke = e as KeyboardEvent;
      const me = e.currentTarget as HTMLButtonElement;
      const step = ke.key === "ArrowRight" || ke.key === "ArrowDown" ? 1 : ke.key === "ArrowLeft" || ke.key === "ArrowUp" ? -1 : 0;
      if (!step || !me.parentElement) return;
      const group = [...me.parentElement.querySelectorAll<HTMLButtonElement>(`:scope > [data-kind="${kind.toLowerCase()}"]:not(:disabled)`)];
      const next = group[(group.indexOf(me) + step + group.length) % group.length];
      if (next && next !== me) {
        e.preventDefault();
        next.focus();
      }
    });
  }
  return el;
};

// ---- field

/** Fields in the middle of composing text (an IME): they write once it is done. */
const composing = new WeakSet<EventTarget>();

export const field: ViewWidget = (d, ctx) => {
  const p = (k: string) => d.props.get(k);
  const lines = Math.max(1, Math.min(20, Math.round(Number(str(p("lines"))) || 1)));
  const multi = lines > 1;
  const write = (el: HTMLInputElement | HTMLTextAreaElement) => {
    if (!composing.has(el)) ctx.write("value", V.text(el.value));
  };
  const input = h(multi ? "textarea" : "input", "field.input", multi ? { rows: String(lines) } : { type: "text" });
  attr(input, "placeholder", str(p("placeholder")) || undefined);
  // the page's value wins: a write it refused shows what `$state` holds again
  prop(input, "value", str(p("value")));
  on(input, "input", (e) => write(e.currentTarget as HTMLInputElement));
  on(input, "compositionstart", (e) => composing.add(e.currentTarget!));
  on(input, "compositionend", (e) => {
    composing.delete(e.currentTarget!);
    write(e.currentTarget as HTMLInputElement);
  });
  on(input, "keydown", (e) => {
    const ke = e as KeyboardEvent;
    if (ke.key !== "Enter" || composing.has(e.currentTarget!) || ke.isComposing) return;
    // Enter submits a one-line field; a longer one takes Ctrl or Cmd with it
    if (multi && !(ke.ctrlKey || ke.metaKey)) return;
    ke.preventDefault();
    ctx.event("submit");
  });
  on(input, "click", claim);
  return h("label", "field", {}, [h("span", "field.label", {}, [str(p("label"))]), input]);
};

// ---- slider

interface Ends {
  low: Num;
  high: Num;
  step: Num;
}

/** The ends and step a variable's type gives, its aliases' included: `int 0..10` is 0, 10, 1. */
function contractEnds(page: Page, t: ir.Type | undefined): { low?: Num; high?: Num; step?: Num } {
  const out: { low?: Num; high?: Num; step?: Num } = {};
  const n = (x: ir.Expr | undefined): Num | undefined => {
    if (!x) return undefined;
    try {
      return exact(page.value(x));
    } catch {
      return undefined;
    }
  };
  for (let k = 0; t && k < 16; k++) {
    const c = t.contract;
    out.low ??= n(c?.range?.low);
    out.high ??= n(c?.range?.high);
    out.step ??= n(c?.step);
    t = page.program.aliases.get(t.name);
  }
  return out;
}

/** A slider's ends: from `range` when it is given, then from its variable's contract, then 0..1. */
export function endsOf(d: Drawn, page: Page): Ends {
  const r = inner(d.props.get("range"));
  const given = r && r.kind === "range" ? { low: exact(r.low ?? undefined), high: exact(r.high ?? undefined), step: exact(r.step ?? undefined) } : {};
  let c: { low?: Num; high?: Num; step?: Num } = {};
  try {
    c = contractEnds(page, page.writeType(d, "value"));
  } catch {
    // a type it can't read: the defaults
  }
  const low = given.low ?? c.low ?? Num.zero();
  let high = given.high ?? c.high;
  let step = given.step ?? c.step;
  if (!high || !high.gt(low)) high = low.add(step ? step.mul(Num.int(10)) : Num.int(1));
  // no step anywhere: a hundredth of the way, so a drag writes a number a person would
  if (!step || !step.gt(Num.zero())) step = high.sub(low).div(Num.int(100));
  return { low, high, step };
}

/** The number on the slider's grid nearest a value, inside its ends, worked out exactly. */
export function snap(x: Num, e: Ends): Num {
  let k = x.sub(e.low).div(e.step).round();
  if (k.isNegative()) k = Num.zero();
  let v = e.low.add(k.mul(e.step));
  if (v.gt(e.high)) v = e.low.add(e.high.sub(e.low).div(e.step).floor().mul(e.step));
  return v;
}

export const slider: ViewWidget = (d, ctx) => {
  const id = idOf(ctx.uid, "slider", d);
  const ends = endsOf(d, ctx.page);
  const value = exact(d.props.get("value"));
  const shown = value?.show() ?? "";
  const input = h("input", "slider.input", {
    type: "range",
    id,
    min: ends.low.show(),
    max: ends.high.show(),
    step: ends.step.show(),
    "aria-valuemin": ends.low.show(),
    "aria-valuemax": ends.high.show(),
    "aria-valuenow": shown || undefined,
    "aria-valuetext": shown || undefined,
  });
  if (value) prop(input, "value", shown);
  prop(input, "disabled", flag(d.props.get("disabled")));
  on(input, "input", (e) => {
    const x = Num.parse((e.currentTarget as HTMLInputElement).value);
    if (!x) return;
    const v = snap(x, ends);
    if (value && v.equals(value)) return;
    ctx.write("value", { kind: "num", n: v });
  });
  on(input, "click", claim);
  return h("div", "slider", {}, [h("label", "slider.label", { for: id }, [str(d.props.get("label"))]), input, h("output", "slider.value", { for: id, "aria-hidden": "true" }, [shown])]);
};

// ---- overlay

const FOCUSABLE = "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";

/** Whether an overlay's body is shown now. */
function showing(body: Element): boolean {
  return body instanceof HTMLDialogElement ? body.open : body.matches(":popover-open");
}

export const overlay: ViewWidget = (d, ctx) => {
  const mode = kase(d.props.get("mode")) ?? "POPOVER";
  const open = flag(d.props.get("open"));
  const name = str(d.props.get("label"));
  const id = idOf(ctx.uid, "overlay", d);
  const tooltip = mode === "TOOLTIP";
  /** The reader opening or closing it: written to `open`, then told as `open_changed`. */
  const setOpen = (want: boolean) => {
    if (want === open) return;
    ctx.write("open", V.bool(want));
    ctx.event("open_changed");
  };
  const anchorKids: Child[] = ctx.children(d.slots.get("anchor") ?? []);
  const anchor = h("span", "overlay.anchor", {}, anchorKids);
  css(anchor, "anchor-name", `--${id}`);
  let pressedWhileOpen = false;
  on(anchor, "pointerdown", (e) => {
    const body = (e.currentTarget as Element).parentElement?.querySelector(":scope > [data-part='overlay.body']");
    pressedWhileOpen = open && !!body && showing(body);
  });
  on(anchor, "click", () => {
    if (tooltip) return;
    // a press on the anchor while it is open closes it, even after a light dismiss closed it first
    const want = pressedWhileOpen ? false : !open;
    pressedWhileOpen = false;
    setOpen(want);
  });
  on(anchor, "keydown", (e) => {
    const ke = e as KeyboardEvent;
    const me = e.currentTarget as HTMLElement;
    if (me.querySelector(FOCUSABLE) || (ke.key !== "Enter" && ke.key !== " ")) return;
    e.preventDefault();
    me.click();
  });
  if (tooltip) {
    for (const [type, want] of [["pointerenter", true], ["pointerleave", false], ["focusin", true], ["focusout", false]] as const) on(anchor, type, () => setOpen(want));
  }
  const bodyKids = ctx.children(d.slots.get("body") ?? []);
  const body =
    mode === "DIALOG"
      ? h("dialog", "overlay.body", { id, "data-mode": "dialog", role: "dialog", "aria-label": name || undefined }, bodyKids)
      : h("div", "overlay.body", { id, "data-mode": mode.toLowerCase(), popover: tooltip ? "manual" : "auto", role: tooltip ? "tooltip" : "dialog", "aria-label": name || undefined }, bodyKids);
  if (mode === "DIALOG") {
    on(body, "close", () => open && setOpen(false));
    // a click on the backdrop closes it, as Escape does
    on(body, "click", (e) => e.target === e.currentTarget && setOpen(false));
  } else {
    css(body, "position-anchor", `--${id}`);
    on(body, "toggle", (e) => {
      const t = e as ToggleEvent;
      if (t.newState === "closed" && open) setOpen(false);
      if (mode === "MENU" && t.newState === "open") (e.currentTarget as HTMLElement).querySelector<HTMLElement>(FOCUSABLE)?.focus();
    });
  }
  // a menu's items are whatever the body holds, moved through with the arrow keys
  if (mode === "MENU") {
    on(body, "keydown", (e) => {
      const ke = e as KeyboardEvent;
      const step = ke.key === "ArrowDown" ? 1 : ke.key === "ArrowUp" ? -1 : 0;
      if (!step) return;
      const me = e.currentTarget as HTMLElement;
      const items = [...me.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => !x.matches(":disabled"));
      const at = items.indexOf(me.ownerDocument.activeElement as HTMLElement);
      items[(at + step + items.length) % items.length]?.focus();
      e.preventDefault();
    });
  }
  const el = h("div", "overlay", { "data-open": String(open) }, [anchor, body]);
  // the body follows `open`, and the trigger says what it controls: the anchor's own control when
  // it has one, else the anchor itself, made a button
  const sync = (root: Element) => {
    const a = root.querySelector(":scope > [data-part='overlay.anchor']") as HTMLElement | null;
    const b = root.querySelector(":scope > [data-part='overlay.body']") as HTMLElement | null;
    if (!a || !b) return;
    try {
      if (open && !showing(b)) {
        if (b instanceof HTMLDialogElement) b.showModal();
        else b.showPopover();
      } else if (!open && showing(b)) {
        if (b instanceof HTMLDialogElement) b.close();
        else b.hidePopover();
      }
    } catch {
      // a body that can't be shown yet: the next render tries again
    }
    const inside = a.querySelector<HTMLElement>(FOCUSABLE);
    const trigger = inside ?? a;
    for (const t of [a, ...(inside ? [inside] : [])]) {
      if (t !== trigger) for (const x of ["aria-expanded", "aria-haspopup", "aria-controls", "aria-describedby"]) t.removeAttribute(x);
    }
    const set = (x: HTMLElement, n: string, v: string | undefined) => (v === undefined ? x.removeAttribute(n) : x.setAttribute(n, v));
    set(a, "role", trigger === a && !tooltip ? "button" : undefined);
    set(a, "tabindex", trigger === a ? "0" : undefined);
    set(a, "aria-label", trigger === a && name && !a.textContent?.trim() ? name : undefined);
    set(trigger, "aria-haspopup", tooltip ? undefined : "dialog");
    set(trigger, "aria-controls", tooltip ? undefined : id);
    set(trigger, "aria-describedby", tooltip ? id : undefined);
    set(trigger, "aria-expanded", tooltip ? undefined : String(open));
  };
  el.hook = {
    mount: sync,
    update: sync,
    unmount(root) {
      const b = root.querySelector(":scope > [data-part='overlay.body']");
      try {
        if (b && showing(b)) {
          if (b instanceof HTMLDialogElement) b.close();
          else (b as HTMLElement).hidePopover();
        }
      } catch {
        // already gone
      }
    },
  };
  return el;
};

// ---- acting through the element, for the checks

/** Each control acting as a reader would: pressing, typing, dragging, opening. */
export const acts: Record<string, Act> = {
  "core/press": (el, a) => {
    if (!("event" in a) || a.event !== "click") return false;
    el.click();
    return true;
  },
  "core/field": (el, a) => {
    const input = el.querySelector<HTMLInputElement | HTMLTextAreaElement>("[data-part='field.input']");
    if (!input) return false;
    if ("event" in a) {
      if (a.event !== "submit") return false;
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ctrlKey: input instanceof HTMLTextAreaElement }));
      return true;
    }
    if (a.write !== "value" || a.value.kind !== "text") return false;
    // a one-line input can't hold a line break: that write goes through the page
    if (input instanceof HTMLInputElement && /[\r\n]/.test(a.value.s)) return false;
    input.focus();
    setNative(input, a.value.s);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  },
  "core/slider": (el, a, page, path) => {
    if (!("write" in a) || a.write !== "value") return false;
    const input = el.querySelector<HTMLInputElement>("[data-part='slider.input']");
    const d = page.find(path);
    if (!input || !d) return false;
    const ends = endsOf(d, page);
    const x = a.value.kind === "num" ? a.value.n : undefined;
    // only what a drag can reach: on the grid, between the ends
    if (!x || x.lt(ends.low) || x.gt(ends.high) || !snap(x, ends).equals(x)) return false;
    if (input.disabled) return true;
    setNative(input, x.show());
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  },
  "core/overlay": (el, a) => {
    if (!("write" in a) || a.write !== "open" || a.value.kind !== "bool") return false;
    const open = el.getAttribute("data-open") === "true";
    if (a.value.b === open) return true;
    const anchor = el.querySelector<HTMLElement>(":scope > [data-part='overlay.anchor']");
    const body = el.querySelector<HTMLElement>(":scope > [data-part='overlay.body']");
    if (!anchor || !body) return false;
    if (body.getAttribute("data-mode") === "tooltip") anchor.dispatchEvent(new FocusEvent(a.value.b ? "focusin" : "focusout", { bubbles: true }));
    else if (a.value.b || !showing(body)) (anchor.querySelector<HTMLElement>(FOCUSABLE) ?? anchor).click();
    else if (body instanceof HTMLDialogElement) body.close();
    else body.hidePopover();
    return true;
  },
};

/** Sets an input's value as typing does: through the prototype's setter, so a framework that
 * tracks the value (React) sees the change in the input event that follows. */
export function setNative(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const set = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (set) set.call(input, value);
  else input.value = value;
}

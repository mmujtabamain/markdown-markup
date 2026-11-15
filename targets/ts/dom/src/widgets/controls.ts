// Drawing and input: label, image, icon, press, field, slider and overlay, as the native controls
// they are, with their roles and states, so a screen reader and the keyboard get them for free.

import { Num, Value as V, type Drawn, type Page, type ir } from "@mkp/runtime";
import type { Action, Widget, WidgetView } from "../api.js";
import { FILLED, GLYPHS } from "../icons.js";
import { attr, claim, css, h, kit, s, text } from "../kit.js";
import { safeSrc } from "../rich.js";
import { exact, flag, inner, kase, str } from "../values.js";

const ALIGN: Record<string, string> = { START: "start", CENTER: "center", END: "end", STRETCH: "justify", BASELINE: "start" };

// ---- label, image, icon

export const label: Widget = (d, ctx) => {
  const el = h("span", "label");
  const view: WidgetView = {
    el,
    update(d) {
      const p = (k: string) => d.props.get(k);
      const tokens = kit(ctx).tokens;
      text(el, str(p("value")));
      css(el, "color", tokens.color(p("tone")));
      el.dataset.size = (kase(p("size")) ?? "NORMAL").toLowerCase();
      el.dataset.weight = (kase(p("weight")) ?? "REGULAR").toLowerCase();
      const font = kase(p("font"));
      attr(el, "data-font", font ? font.toLowerCase() : undefined);
      const a = kase(p("align")) ?? "START";
      css(el, "text-align", a === "START" ? undefined : ALIGN[a]);
      el.classList.toggle("mkp-nowrap", !flag(p("wrap"), true));
      el.classList.toggle("mkp-clip", flag(p("clip")));
      el.classList.toggle("mkp-halo", flag(p("halo")));
      // a clipped label still says all of itself
      attr(el, "title", flag(p("clip")) ? str(p("value")) : undefined);
    },
  };
  view.update(d);
  return view;
};

export const image: Widget = (d, ctx) => {
  const el = h("img", "image", { loading: "lazy", decoding: "async" });
  const view: WidgetView = {
    el,
    update(d) {
      const src = str(d.props.get("src"));
      const safe = safeSrc(src);
      attr(el, "alt", str(d.props.get("alt")));
      attr(el, "src", safe);
      attr(el, "data-unsafe-src", safe ? undefined : "");
      css(el, "width", kit(ctx).tokens.length(d.props.get("width")));
    },
  };
  view.update(d);
  return view;
};

/** An icon's SVG for a glyph: drawn in the current colour, sized to the text. */
export function glyph(name: string | undefined, part = "icon"): SVGSVGElement {
  const el = s("svg", part, { viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false" });
  setGlyph(el, name);
  return el;
}

function setGlyph(el: SVGSVGElement, name: string | undefined): void {
  if (el.getAttribute("data-glyph") === (name ?? "")) return;
  el.setAttribute("data-glyph", name ?? "");
  const path = s("path", undefined, { d: GLYPHS[name ?? ""] ?? "M12 12v.01" });
  el.classList.toggle("mkp-filled", FILLED.has(name ?? ""));
  el.replaceChildren(path);
}

export const icon: Widget = (d, ctx) => {
  const el = glyph(kase(d.props.get("name")));
  const view: WidgetView = {
    el,
    update(d) {
      setGlyph(el, kase(d.props.get("name")));
      const lbl = str(d.props.get("label"));
      // labelled, it is a picture with a name; otherwise decoration
      attr(el, "role", lbl ? "img" : undefined);
      attr(el, "aria-label", lbl || undefined);
      attr(el, "aria-hidden", lbl ? undefined : "true");
      el.dataset.size = (kase(d.props.get("size")) ?? "NORMAL").toLowerCase();
      css(el, "color", kit(ctx).tokens.color(d.props.get("tone")));
    },
  };
  view.update(d);
  return view;
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

export const press: Widget = (d, ctx) => {
  const el = h("button", "press", { type: "button" });
  const indicator = h("span", "press.indicator", { "aria-hidden": "true" });
  const lbl = h("span", "press.label");
  const content = h("span", "press.content");
  el.append(indicator, lbl, content);
  let kind = "BUTTON";
  el.addEventListener("click", (e) => {
    claim(e);
    if (!el.disabled) ctx.event("click");
  });
  // tabs, options and radios move along their group with the arrow keys, as native ones do
  el.addEventListener("keydown", (e) => {
    if (!GROUPED.has(kind)) return;
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step || !el.parentElement) return;
    const group = [...el.parentElement.querySelectorAll<HTMLButtonElement>(`:scope > [data-kind="${kind.toLowerCase()}"]:not(:disabled)`)];
    const at = group.indexOf(el);
    const next = group[(at + step + group.length) % group.length];
    if (next && next !== el) {
      e.preventDefault();
      next.focus();
    }
  });
  const view: WidgetView = {
    el,
    update(d) {
      const p = (k: string) => d.props.get(k);
      kind = kase(p("kind")) ?? "BUTTON";
      const k = KINDS[kind] ?? KINDS.BUTTON;
      const selected = flag(p("selected"));
      el.dataset.kind = kind.toLowerCase();
      attr(el, "role", k.role);
      for (const a of ["aria-pressed", "aria-selected", "aria-checked"]) attr(el, a, a === k.state ? String(selected) : undefined);
      el.classList.toggle("mkp-selected", selected);
      el.disabled = flag(p("disabled"));
      const tone = kit(ctx).tokens.color(p("tone"));
      css(el, "--mkp-tone", tone);
      el.classList.toggle("mkp-toned", !!tone);
      const nodes = d.slots.get("content") ?? [];
      // with content of its own, the label is its accessible name; with none, its text
      const name = str(p("label"));
      text(lbl, nodes.length ? "" : name);
      lbl.hidden = nodes.length > 0;
      attr(el, "aria-label", nodes.length ? name : undefined);
      content.hidden = nodes.length === 0;
      ctx.children(content, nodes);
    },
    act(a: Action) {
      if (!("event" in a) || a.event !== "click") return false;
      el.click();
      return true;
    },
  };
  view.update(d);
  return view;
};

// ---- field

export const field: Widget = (d, ctx) => {
  const el = h("label", "field");
  const lbl = h("span", "field.label");
  el.append(lbl);
  let input: HTMLInputElement | HTMLTextAreaElement = h("input", "field.input", { type: "text" });
  el.append(input);
  let composing = false;
  const write = () => {
    if (!composing) ctx.write("value", V.text(input.value));
  };
  const wire = (i: HTMLInputElement | HTMLTextAreaElement) => {
    i.addEventListener("input", write);
    i.addEventListener("compositionstart", () => (composing = true));
    i.addEventListener("compositionend", () => {
      composing = false;
      write();
    });
    i.addEventListener("keydown", (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key !== "Enter" || composing || ke.isComposing) return;
      // Enter submits a one-line field; a longer one takes Ctrl or Cmd with it
      if (i instanceof HTMLTextAreaElement && !(ke.ctrlKey || ke.metaKey)) return;
      ke.preventDefault();
      ctx.event("submit");
    });
    i.addEventListener("click", claim);
  };
  wire(input);
  const view: WidgetView = {
    el,
    update(d) {
      const p = (k: string) => d.props.get(k);
      const lines = Math.max(1, Math.min(20, Math.round(Number(str(p("lines"))) || 1)));
      const multi = lines > 1;
      if (multi !== input instanceof HTMLTextAreaElement) {
        const next = multi ? h("textarea", "field.input") : h("input", "field.input", { type: "text" });
        next.value = input.value;
        input.replaceWith(next);
        input = next;
        wire(input);
      }
      if (input instanceof HTMLTextAreaElement) attr(input, "rows", String(lines));
      text(lbl, str(p("label")));
      attr(input, "placeholder", str(p("placeholder")) || undefined);
      const value = str(p("value"));
      // the page's value wins, but typing in progress is left alone, and the caret stays put
      if (input.value !== value && !composing) {
        const focused = input.ownerDocument.activeElement === input;
        const [a, b] = [input.selectionStart, input.selectionEnd];
        input.value = value;
        if (focused && a !== null && b !== null) input.setSelectionRange(Math.min(a, value.length), Math.min(b, value.length));
      }
    },
    act(a: Action) {
      if ("event" in a) {
        if (a.event !== "submit") return false;
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ctrlKey: input instanceof HTMLTextAreaElement }));
        return true;
      }
      if (a.write !== "value" || a.value.kind !== "text") return false;
      // a one-line input can't hold a line break: that write goes through the page
      if (input instanceof HTMLInputElement && /[\r\n]/.test(a.value.s)) return false;
      input.focus();
      input.value = a.value.s;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
  };
  view.update(d);
  return view;
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
function endsOf(d: Drawn, page: Page): Ends {
  const r = inner(d.props.get("range"));
  const given = r && r.kind === "range" ? { low: exact(r.low ?? undefined), high: exact(r.high ?? undefined), step: exact(r.step ?? undefined) } : {};
  let c: { low?: Num; high?: Num; step?: Num } = {};
  try {
    c = contractEnds(page, page.writeType(d, "value"));
  } catch {
    // a page without the helper, or a type it can't read: the defaults
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
function snap(x: Num, e: Ends): Num {
  let k = x.sub(e.low).div(e.step).round();
  if (k.isNegative()) k = Num.zero();
  let v = e.low.add(k.mul(e.step));
  if (v.gt(e.high)) v = e.low.add(e.high.sub(e.low).div(e.step).floor().mul(e.step));
  return v;
}

export const slider: Widget = (d, ctx) => {
  const el = h("div", "slider");
  const id = `${kit(ctx).uid}slider-${++sliders}`;
  const lbl = h("label", "slider.label", { for: id });
  const input = h("input", "slider.input", { type: "range", id });
  const out = h("output", "slider.value", { for: id, "aria-hidden": "true" });
  el.append(lbl, input, out);
  let ends: Ends = endsOf(d, ctx.page);
  let value: Num | undefined;
  input.addEventListener("input", () => {
    const x = Num.parse(input.value);
    if (!x) return;
    const v = snap(x, ends);
    if (value && v.equals(value)) return;
    ctx.write("value", { kind: "num", n: v });
  });
  input.addEventListener("click", claim);
  const view: WidgetView = {
    el,
    update(d) {
      ends = endsOf(d, ctx.page);
      value = exact(d.props.get("value"));
      text(lbl, str(d.props.get("label")));
      attr(input, "min", ends.low.show());
      attr(input, "max", ends.high.show());
      attr(input, "step", ends.step.show());
      const shown = value?.show() ?? "";
      if (value && input.value !== shown) input.value = shown;
      attr(input, "aria-valuemin", ends.low.show());
      attr(input, "aria-valuemax", ends.high.show());
      attr(input, "aria-valuenow", shown || undefined);
      attr(input, "aria-valuetext", shown || undefined);
      text(out, shown);
      input.disabled = flag(d.props.get("disabled"));
    },
    act(a: Action) {
      if (!("write" in a) || a.write !== "value") return false;
      const x = a.value.kind === "num" ? a.value.n : undefined;
      // only what a drag can reach: on the grid, between the ends
      if (!x || x.lt(ends.low) || x.gt(ends.high) || !snap(x, ends).equals(x)) return false;
      if (input.disabled) return true;
      input.value = x.show();
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
  };
  view.update(d);
  return view;
};

let sliders = 0;

// ---- overlay

const FOCUSABLE = "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";

export const overlay: Widget = (d, ctx) => {
  const el = h("div", "overlay");
  const anchor = h("span", "overlay.anchor");
  const uid = kit(ctx).uid;
  const id = `${uid}overlay-${++overlays}`;
  el.append(anchor);
  anchor.style.setProperty("anchor-name", `--${id}`);
  let mode = "";
  let body: HTMLElement = h("div");
  let open = false;
  let trigger: HTMLElement = anchor;
  let pressedWhileOpen = false;
  // a body closed as the overlay leaves the page tells nobody: its toggle event comes later
  let gone = false;

  const showing = () => (body instanceof HTMLDialogElement ? body.open : body.matches(":popover-open"));

  /** The reader opening or closing it: written to `open`, then told as `open_changed`. */
  const setOpen = (want: boolean) => {
    if (gone || want === open) return;
    ctx.write("open", V.bool(want));
    ctx.event("open_changed");
  };

  /** The body follows `open`: shown, or hidden but still on the page. */
  const sync = () => {
    if (!el.isConnected) {
      queueMicrotask(() => el.isConnected && sync());
      return;
    }
    try {
      if (open && !showing()) {
        if (body instanceof HTMLDialogElement) body.showModal();
        else body.showPopover();
      } else if (!open && showing()) {
        if (body instanceof HTMLDialogElement) body.close();
        else body.hidePopover();
      }
    } catch {
      // a body that can't be shown here (not connected yet): the next redraw tries again
    }
    attr(trigger, "aria-expanded", mode === "TOOLTIP" ? undefined : String(open));
  };

  const makeBody = (m: string) => {
    kit(ctx).release(body);
    body.remove();
    if (m === "DIALOG") {
      const dlg = h("dialog", "overlay.body");
      dlg.addEventListener("close", () => open && setOpen(false));
      // a click on the backdrop closes it, as Escape does
      dlg.addEventListener("click", (e) => e.target === dlg && setOpen(false));
      body = dlg;
    } else {
      body = h("div", "overlay.body", { popover: m === "TOOLTIP" ? "manual" : "auto" });
      body.addEventListener("toggle", (e) => {
        if ((e as ToggleEvent).newState === "closed" && open) setOpen(false);
      });
      body.style.setProperty("position-anchor", `--${id}`);
    }
    body.id = id;
    body.dataset.mode = m.toLowerCase();
    // a menu's items are whatever the body holds, not menuitems, so it is a dialog moved through
    // with the arrow keys
    attr(body, "role", m === "TOOLTIP" ? "tooltip" : "dialog");
    if (m === "MENU") {
      body.addEventListener("keydown", (e) => {
        const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
        if (!step) return;
        const items = [...body.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => !x.matches(":disabled"));
        const at = items.indexOf(body.ownerDocument.activeElement as HTMLElement);
        items[(at + step + items.length) % items.length]?.focus();
        e.preventDefault();
      });
      body.addEventListener("toggle", (e) => {
        if ((e as ToggleEvent).newState === "open") body.querySelector<HTMLElement>(FOCUSABLE)?.focus();
      });
    }
    el.append(body);
  };

  anchor.addEventListener("pointerdown", () => (pressedWhileOpen = open && showing()));
  anchor.addEventListener("click", () => {
    if (mode === "TOOLTIP") return;
    // a press on the anchor while it is open closes it, even after a light dismiss closed it first
    const want = pressedWhileOpen ? false : !open;
    pressedWhileOpen = false;
    setOpen(want);
  });
  anchor.addEventListener("keydown", (e) => {
    if (trigger !== anchor || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    anchor.click();
  });
  for (const [type, want] of [["pointerenter", true], ["pointerleave", false], ["focusin", true], ["focusout", false]] as const) {
    anchor.addEventListener(type, () => mode === "TOOLTIP" && setOpen(want));
  }

  const view: WidgetView = {
    el,
    update(d) {
      const m = kase(d.props.get("mode")) ?? "POPOVER";
      if (m !== mode) {
        mode = m;
        makeBody(m);
      }
      open = flag(d.props.get("open"));
      const name = str(d.props.get("label"));
      attr(body, "aria-label", name || undefined);
      ctx.children(anchor, d.slots.get("anchor") ?? []);
      ctx.children(body, d.slots.get("body") ?? []);
      // the anchor's own control is the trigger; with none, the anchor becomes a button
      const inside = anchor.querySelector<HTMLElement>(FOCUSABLE);
      if (inside !== trigger) {
        for (const a of ["aria-expanded", "aria-haspopup", "aria-controls", "aria-describedby"]) trigger.removeAttribute(a);
        trigger = inside ?? anchor;
      }
      // a tooltip's anchor only needs to take the focus, so the keyboard shows it too
      attr(anchor, "role", trigger === anchor && mode !== "TOOLTIP" ? "button" : undefined);
      attr(anchor, "tabindex", trigger === anchor ? "0" : undefined);
      attr(anchor, "aria-label", trigger === anchor && name && !anchor.textContent?.trim() ? name : undefined);
      attr(trigger, "aria-haspopup", mode === "TOOLTIP" ? undefined : "dialog");
      attr(trigger, "aria-controls", mode === "TOOLTIP" ? undefined : id);
      attr(trigger, "aria-describedby", mode === "TOOLTIP" ? id : undefined);
      sync();
    },
    act(a: Action) {
      if (!("write" in a) || a.write !== "open" || a.value.kind !== "bool") return false;
      if (a.value.b === open) return true;
      if (mode === "TOOLTIP") anchor.dispatchEvent(new FocusEvent(a.value.b ? "focusin" : "focusout", { bubbles: true }));
      else if (a.value.b || !showing()) trigger.click();
      else if (body instanceof HTMLDialogElement) body.close();
      else body.hidePopover();
      return true;
    },
    destroy() {
      gone = true;
      try {
        if (showing()) {
          if (body instanceof HTMLDialogElement) body.close();
          else body.hidePopover();
        }
      } catch {
        // already gone
      }
    },
  };
  view.update(d);
  return view;
};

let overlays = 0;

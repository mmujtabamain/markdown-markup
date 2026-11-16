// A page drawn into an element: its tree reconciled by key after every change, so each widget's
// element lives as long as the widget does, and focus, the caret and what is being typed survive
// a redraw. The plane's layout runs after every change, with sizes read from the DOM.

import { Num, Page, layout as runLayout, type Drawn, type Measure, type PageOptions, type ir } from "@mkp/runtime";
import type { Action, Mounted, MountOptions, Widget, WidgetContext, WidgetView } from "./api.js";
import { giveKit, newUid, tokensOf, type Kit } from "./kit.js";
import { webFns } from "./fns.js";
import { css as styleText } from "./style.js";
import { widgets as ours } from "./widgets/index.js";
import { broken, failedView, unknownWidget } from "./widgets/notice.js";

interface Entry {
  key: string;
  widget: string;
  path: string;
  d: Drawn;
  view: WidgetView;
  ctx: WidgetContext;
}

const styled = new WeakSet<Node>();

/** Puts the stylesheet in once: in the document's head, or in the shadow root the page is in. */
function injectStyle(root: HTMLElement): void {
  const host = root.getRootNode();
  const target: Node = host instanceof ShadowRoot ? host : root.ownerDocument;
  if (styled.has(target)) return;
  styled.add(target);
  const parent = host instanceof ShadowRoot ? host : root.ownerDocument.head;
  if (parent.querySelector?.("style[data-mkp-dom]")) return;
  const style = root.ownerDocument.createElement("style");
  style.setAttribute("data-mkp-dom", "");
  style.textContent = styleText;
  parent.prepend(style);
}

/** What has focus inside the page, and the caret in it, before a redraw moves anything. */
function focusOf(root: HTMLElement): (() => void) | undefined {
  const a = root.ownerDocument.activeElement as HTMLElement | null;
  if (!a || a === root || !root.contains(a)) return undefined;
  const typed = a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement ? a : undefined;
  let sel: [number | null, number | null, "forward" | "backward" | "none" | null] | undefined;
  try {
    if (typed) sel = [typed.selectionStart, typed.selectionEnd, typed.selectionDirection];
  } catch {
    // a range input has no caret
  }
  return () => {
    if (!a.isConnected || root.ownerDocument.activeElement === a) return;
    a.focus({ preventScroll: true });
    if (typed && sel && sel[0] !== null && sel[1] !== null) {
      try {
        typed.setSelectionRange(sel[0], sel[1], sel[2] ?? undefined);
      } catch {
        // not every input keeps a caret
      }
    }
  };
}

export function mount(page: Page, root: HTMLElement, opts: MountOptions = {}): Mounted {
  injectStyle(root);
  const registry: Record<string, Widget> = { ...ours, ...(opts.widgets ?? {}) };
  // an extern widget nobody registered shows its Markdown instead (page 6): the page draws it
  // with the blocks we do draw, and reports it in page.missing()
  page.setSupplies((widget) => Object.hasOwn(registry, widget));
  const tokens = tokensOf(page);
  const uid = newUid();
  const containers = new Map<Element, Map<string, Entry>>();
  const byPath = new Map<string, Entry>();
  let live = true;
  let rendering = false;
  let again = false;
  let settling = false;

  root.classList.add("mkp-root");
  root.setAttribute("data-mkp-root", "");
  root.replaceChildren();

  const kitFor: Kit = {
    tokens,
    uid,
    layout: () => settle(),
    view: (path) => byPath.get(path)?.view,
    release: (el) => release(el),
  };

  function setPath(e: Entry, d: Drawn): void {
    if (e.path !== d.path && byPath.get(e.path) === e) byPath.delete(e.path);
    e.path = d.path;
    byPath.set(d.path, e);
    const el = e.view.el;
    if (el.getAttribute("data-mkp-site") !== d.path) el.setAttribute("data-mkp-site", d.path);
    if (el.getAttribute("data-mkp-widget") !== d.widget) el.setAttribute("data-mkp-widget", d.widget);
  }

  function make(d: Drawn): Entry {
    const e = { key: d.key, widget: d.widget, path: d.path, d } as Entry;
    e.ctx = {
      page,
      event: (name, args = []) => page.event(e.d.path, name, args),
      write: (input, value) => page.write(e.d.path, input, value),
      children,
      token: (v) => tokens.value(v),
    };
    giveKit(e.ctx, kitFor);
    const maker = registry[d.widget] ?? (d.widget.startsWith("#") && registry["#notice"] ? registry["#notice"] : unknownWidget);
    try {
      e.view = maker(d, e.ctx);
    } catch (f) {
      page.errors.push(f);
      e.view = failedView(d, f);
    }
    return e;
  }

  function update(e: Entry, d: Drawn): void {
    // the page reused this node: nothing it shows changed, unless the theme its colours follow did
    if (e.d === d && !restyle) return;
    e.d = d;
    try {
      e.view.update(d);
    } catch (f) {
      page.errors.push(f);
      const failed = failedView(d, f);
      drop(e, true);
      e.view = failed;
    }
  }

  /** Forgets the views drawn into every container inside an element, the element's own included. */
  function release(el: Element): void {
    for (const [c, m] of [...containers]) {
      if (!containers.has(c) || !el.contains(c)) continue;
      containers.delete(c);
      for (const e of m.values()) forget(e);
    }
  }

  function forget(e: Entry): void {
    release(e.view.el);
    try {
      e.view.destroy?.();
    } catch (f) {
      page.errors.push(f);
    }
    if (byPath.get(e.path) === e) byPath.delete(e.path);
  }

  /** Takes a widget off the page: its element, its slots' views, and whatever it holds. */
  function drop(e: Entry, keepEl = false): void {
    forget(e);
    if (!keepEl) e.view.el.remove();
  }

  function children(container: Element, nodes: Drawn[]): void {
    let map = containers.get(container);
    if (!map) containers.set(container, (map = new Map()));
    const seen = new Map<string, Entry>();
    const els: Element[] = [];
    for (const d of nodes) {
      let key = d.key;
      for (let k = 2; seen.has(key); k++) key = `${d.key}#${k}`;
      let e = map.get(key);
      if (e && (e.widget !== d.widget || broken.has(e.view))) {
        drop(e);
        map.delete(key);
        e = undefined;
      }
      if (e) {
        // a widget may change its element (h2 to h3): the new one takes the old one's place
        const before = e.view.el;
        update(e, d);
        if (e.view.el !== before) before.replaceWith(e.view.el);
      } else e = make(d);
      e.key = key;
      setPath(e, d);
      seen.set(key, e);
      els.push(e.view.el);
    }
    for (const [k, e] of map) if (!seen.has(k)) drop(e);
    containers.set(container, seen);
    // in the tree's order, moving only what is out of place, so a focused field stays put
    let cursor = container.firstChild;
    for (const el of els) {
      if (el === cursor) cursor = cursor.nextSibling;
      else container.insertBefore(el, cursor);
    }
  }

  /** The theme last drawn with: when it changes, every widget is updated, reused or not. */
  let theme: string | undefined;
  let restyle = false;

  function render(): void {
    if (!live) return;
    if (rendering) {
      again = true;
      return;
    }
    rendering = true;
    const refocus = focusOf(root);
    try {
      const now = page.externsNow().get("core/page.theme");
      const name = now?.kind === "case" ? now.name : undefined;
      restyle = name !== theme;
      theme = name;
      for (let k = 0; k < 4; k++) {
        again = false;
        tokens.apply(root);
        children(root, page.tree());
        if (!again) break;
      }
    } finally {
      rendering = false;
      restyle = false;
    }
    refocus?.();
  }

  /** The default measure: each spot's box on the page, which the plane's transform never changes. */
  const measure: Measure = opts.measure ?? {
    spot(s) {
      const el = byPath.get(s.path)?.view.el as HTMLElement | undefined;
      return { width: Num.int(Math.max(0, el?.offsetWidth ?? 0)), height: Num.int(Math.max(0, el?.offsetHeight ?? 0)) };
    },
    planeWidth(p) {
      const el = byPath.get(p.path)?.view.el as HTMLElement | undefined;
      const view = el?.querySelector?.("[data-part='plane.view']") as HTMLElement | null | undefined;
      return Num.int(Math.max(0, Math.round((view ?? el)?.clientWidth ?? 0)));
    },
  };

  function settle(): void {
    if (!live || settling) return;
    settling = true;
    try {
      runLayout(page, measure);
    } catch (f) {
      page.errors.push(f);
    } finally {
      settling = false;
    }
  }

  const off = page.onChange(() => {
    render();
    settle();
  });
  render();
  settle();

  return {
    page,
    root,
    view: (path) => byPath.get(path)?.view,
    act(path: string, action: Action): void {
      const e = byPath.get(path);
      if (e?.view.act) {
        try {
          if (e.view.act(action)) return;
        } catch (f) {
          page.errors.push(f);
        }
      }
      if ("event" in action) page.event(path, action.event, action.args ?? []);
      else page.write(path, action.write, action.value);
    },
    layout: settle,
    unmount(): void {
      if (!live) return;
      off();
      for (const m of [...containers.values()]) for (const e of m.values()) drop(e);
      containers.clear();
      byPath.clear();
      live = false;
      tokens.clear(root);
      root.classList.remove("mkp-root");
      root.removeAttribute("data-mkp-root");
      root.replaceChildren();
    },
  };
}

/** Makes the page from an IR file, with the web's value fns under the app's own, and mounts it. */
export function run(irFile: ir.File | ir.Module | string, root: HTMLElement, opts: PageOptions & MountOptions = {}): Mounted {
  const { widgets, measure, ...pageOpts } = opts;
  const file = typeof irFile === "string" ? (JSON.parse(irFile) as ir.File) : irFile;
  const page = new Page(file, { ...pageOpts, fns: { ...webFns(), ...(pageOpts.fns ?? {}) } });
  return mount(page, root, { widgets, measure });
}

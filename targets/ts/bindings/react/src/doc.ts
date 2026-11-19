"use client";
// <XtmdDoc>: an Extended Mark page drawn by React itself. @extended-mark/view runs the document and gives the page as
// plain elements; this renders them with React's own elements, so the page is part of the app's
// React tree: rendered on a server as it is on the client, and kept by key across redraws, so
// focus and what is being typed survive a change. Listeners, live DOM properties and the hooks of
// widgets that draw on their element (a canvas, a plane) are attached to the real elements.

import { createElement, useLayoutEffect, useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactElement, type ReactNode, type Ref } from "react";
import { Doc, type Child, type DocProps, type Restored, type Snapshot, type VNode, type Value, type ir } from "@extended-mark/view";

/** What the app holds to reach the page: `ref` on <XtmdDoc>. */
export interface XtmdDocHandle {
  /** The running document. */
  readonly doc: Doc;
  /** Writes `$state` fields as one change, checked: refused whole (and told to `onError`), or done. */
  set(changes: Record<string, ir.Expr | Value>): void;
  /** `$state` now. */
  state(): Record<string, ir.Expr>;
  /** The page as Markdown, with the values it has now. */
  markdown(): string;
  /** Calls a fn the document exposes: `expose("tracker", "clear_done")`. */
  expose(channel: string, name: string, ...args: (ir.Expr | Value)[]): void;
  /** Everything the page holds now: `$state` and every widget's own variables. */
  snapshot(): Snapshot;
  /** Puts a snapshot back: all of it with the same IR, `$state` only with another. */
  restore(snap: Snapshot): Restored;
}

export interface XtmdDocProps extends DocProps {
  ref?: Ref<XtmdDocHandle | null>;
  id?: string;
  className?: string;
  style?: CSSProperties;
}

// ---- elements, the React way

/** Attributes React spells in camelCase. */
const ATTRS: Record<string, string> = { class: "className", for: "htmlFor", tabindex: "tabIndex", readonly: "readOnly", colspan: "colSpan", rowspan: "rowSpan", maxlength: "maxLength", spellcheck: "spellCheck", autocomplete: "autoComplete", contenteditable: "contentEditable", popover: "popover" };

function camel(s: string): string {
  return s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** An attribute's React name: data- and aria- as they are, SVG's kebab-case attributes camelCase. */
function attrName(k: string, svg: boolean): string {
  if (ATTRS[k]) return ATTRS[k];
  if (k.startsWith("data-") || k.startsWith("aria-")) return k;
  return svg && k.includes("-") ? camel(k) : k;
}

/** A CSS property's React name: custom properties as they are, the rest camelCase. */
function styleName(k: string): string {
  return k.startsWith("--") ? k : camel(k);
}

const FORM = new Set(["input", "textarea", "select"]);

/** Whether an element needs a component of its own: listeners, live properties, or a hook. */
function live(v: VNode): boolean {
  return !!(v.hook || (v.on && Object.keys(v.on).length) || (v.props && ("value" in v.props || "checked" in v.props || "indeterminate" in v.props)));
}

function reactProps(v: VNode, ref?: Ref<Element>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v.attrs)) out[attrName(k, !!v.svg)] = x;
  if (v.style) out.style = Object.fromEntries(Object.entries(v.style).map(([k, x]) => [styleName(k), x]));
  for (const [k, x] of Object.entries(v.props ?? {})) {
    // a form control's value and checked are the live element's: React only writes the first
    if (k === "value" && FORM.has(v.tag)) out.defaultValue = x;
    else if (k === "checked") out.defaultChecked = x;
    else if (k !== "indeterminate") out[k] = x;
  }
  if (v.key !== undefined) out.key = v.key;
  if (ref) out.ref = ref;
  // a style element's text is the stylesheet, not a child to escape
  if (v.tag === "style") out.dangerouslySetInnerHTML = { __html: v.children.map((c) => (typeof c === "string" ? c : "")).join("") };
  return out;
}

function kids(v: VNode): ReactNode[] {
  if (v.tag === "style" || (v.tag === "textarea" && v.props && "value" in v.props)) return [];
  return v.children.map(toReact);
}

/** An element with listeners, live properties or a hook: a component, so it can reach its DOM node. */
function Live({ v }: { v: VNode }): ReactElement {
  const ref = useRef<Element>(null);
  const latest = useRef(v);
  latest.current = v;
  const mounted = useRef(false);
  const names = Object.keys(v.on ?? {}).sort().join(" ");
  // listeners on the element itself, as the DOM gives them, each calling the latest render's
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !names) return;
    const added = names.split(" ").map((n) => {
      const f = (e: Event) => latest.current.on?.[n]?.(e);
      el.addEventListener(n, f);
      return [n, f] as const;
    });
    return () => added.forEach(([n, f]) => el.removeEventListener(n, f));
  }, [names]);
  // live properties: what the page shows wins, except while a person is composing text in it
  useLayoutEffect(() => {
    const el = ref.current as (HTMLInputElement & HTMLTextAreaElement) | null;
    const p = v.props;
    if (!el || !p) return;
    if ("value" in p && el.value !== String(p.value ?? "")) {
      const focused = el.ownerDocument.activeElement === el;
      let sel: [number | null, number | null] = [null, null];
      try {
        sel = [el.selectionStart, el.selectionEnd];
      } catch {
        // a range input has no caret
      }
      el.value = String(p.value ?? "");
      if (focused && sel[0] !== null && sel[1] !== null) {
        try {
          el.setSelectionRange(Math.min(sel[0], el.value.length), Math.min(sel[1], el.value.length));
        } catch {
          // not every input keeps a caret
        }
      }
    }
    if ("checked" in p) el.checked = !!p.checked;
    if ("indeterminate" in p) el.indeterminate = !!p.indeterminate;
  });
  // the widget's hook: once in the document, after each render it stays through, and as it leaves
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!mounted.current) {
      mounted.current = true;
      latest.current.hook?.mount?.(el);
    } else latest.current.hook?.update?.(el);
  });
  useLayoutEffect(() => {
    const el = ref.current;
    return () => {
      mounted.current = false;
      if (el) latest.current.hook?.unmount?.(el);
    };
  }, []);
  return createElement(v.tag, reactProps(v, ref), ...kids(v));
}

/** One of @extended-mark/view's elements as React's. */
export function toReact(c: Child): ReactNode {
  if (typeof c === "string") return c;
  if (live(c)) return createElement(Live, { v: c, key: c.key });
  return createElement(c.tag, reactProps(c), ...kids(c));
}

// ---- the component

/**
 * An Extended Mark page. `src` is where its IR is fetched from, or `ir` the IR in hand. `state` with
 * `onStateChange` controls `$state`, or `defaultState` starts it; every write is checked by xtmd,
 * and what it refuses reaches `onError`. Its `ref` is the handle: `snapshot`, `restore`, `set`,
 * `state`, `markdown` and `expose`.
 */
export function XtmdDoc({ ref, id, className, style, ...props }: XtmdDocProps): ReactElement {
  const [doc] = useState(() => new Doc(props));
  useSyncExternalStore(
    (f) => doc.subscribe(f),
    () => doc.version,
    () => doc.version,
  );
  // after every render: the document follows its props
  useEffect(() => {
    doc.update(props);
  });
  useImperativeHandle<XtmdDocHandle | null, XtmdDocHandle | null>(
    ref,
    () => ({
      doc,
      set: (c) => doc.set(c),
      state: () => doc.state(),
      markdown: () => doc.markdown(),
      expose: (c, n, ...a) => doc.expose(c, n, ...a),
      snapshot: () => doc.snapshot(),
      restore: (s) => doc.restore(s),
    }),
    [doc],
  );
  const root = doc.render();
  if (id) root.attrs.id = id;
  if (className) root.attrs.class = `${root.attrs.class} ${className}`;
  const el = toReact(root) as ReactElement;
  return style ? createElement("div", { style }, el) : el;
}

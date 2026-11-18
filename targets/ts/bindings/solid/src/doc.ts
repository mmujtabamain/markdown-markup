// <MkpDoc>: an MKP page drawn by Solid itself. @mkp/view runs the document and gives the page as
// plain elements after every change; this follows them with Solid's own fine-grained rendering:
// each element is made once, kept by key among its siblings while its tag stays, and only what
// changed is set on it, so focus and what is being typed survive a change. On a server the same
// components render the page's HTML. Written without JSX, so it needs no Solid compiler.

import { createComponent, createEffect, createMemo, createSignal, mapArray, mergeProps, onCleanup, onMount, untrack, type Accessor, type JSX } from "solid-js";
import { Dynamic, isServer } from "solid-js/web";
import { Doc, type Child, type DocProps, type Restored, type Snapshot, type VNode, type Value, type ir } from "@mkp/view";

/** A child's key among its siblings: its own, or its place, with its tag (a new tag is a new element). */
function keyOf(c: Child, i: number): string {
  return typeof c === "string" ? `#t${i}` : `${c.key ?? `#${i}`}:${c.tag}`;
}

/** An element's props in Solid's spelling: attributes, style, live DOM properties (`prop:`), and
 * native listeners (`on:`, the DOM's own events with their currentTarget). */
function solidProps(v: VNode): Record<string, unknown> {
  const out: Record<string, unknown> = { ...v.attrs };
  if (v.style) out.style = { ...v.style };
  for (const [k, x] of Object.entries(v.props ?? {})) {
    if (isServer) {
      // a server writes what the property starts as
      if (k === "value" && v.tag !== "textarea") out.value = String(x);
      else if (x === true) out[k] = "";
    } else out[`prop:${k}`] = x;
  }
  if (!isServer) for (const [k, f] of Object.entries(v.on ?? {})) out[`on:${k}`] = f;
  return out;
}

/** Children followed by key: each kept while its key is, its element told what changed. */
function children(list: Accessor<Child[]>): JSX.Element {
  const byKey = createMemo(() => new Map(list().map((c, i) => [keyOf(c, i), c] as const)));
  const keys = createMemo(() => [...byKey().keys()], undefined, { equals: (a, b) => a.length === b.length && a.every((k, i) => k === b[i]) });
  return mapArray(keys, (key) => {
    const item = createMemo(() => byKey().get(key)!);
    const first = untrack(item);
    if (typeof first === "string") return (() => item() as string) as unknown as JSX.Element;
    return createComponent(Node, { v: item as Accessor<VNode> });
  }) as unknown as JSX.Element;
}

/** One element: made once with its tag, then followed. Its hook is the latest render's, as one
 * may come later (a page's root has none while its IR is on its way). */
function Node(props: { v: Accessor<VNode> }): JSX.Element {
  const first = untrack(props.v);
  let el: Element | undefined;
  if (!isServer) {
    // the last render this element had: its key's gone by the time it is cleaned up
    let last = first;
    onMount(() => {
      if (el) last.hook?.mount?.(el);
    });
    let started = false;
    createEffect(() => {
      const v = props.v();
      if (!v) return;
      last = v;
      if (!started) {
        started = true;
        return;
      }
      if (el) v.hook?.update?.(el);
    });
    onCleanup(() => {
      if (el) last.hook?.unmount?.(el);
    });
  }
  if (first.tag === "style") {
    return createComponent(Dynamic, { component: "style", ...first.attrs, get innerHTML() {
      return props.v().children.join("");
    } } as never);
  }
  const textarea = first.tag === "textarea";
  return createComponent(
    Dynamic,
    mergeProps(
      { component: first.tag, ref: (e: Element) => (el = e) },
      () => solidProps(props.v()),
      textarea ? {} : { get children() {
        return children(() => props.v().children);
      } },
    ) as never,
  );
}

/** One of @mkp/view's elements, followed by Solid: give it an accessor to the latest render. */
export function MkpNode(props: { v: Accessor<VNode> }): JSX.Element {
  return createComponent(Node, props);
}

/** What `ref` on <MkpDoc> is given. */
export interface MkpDocHandle {
  readonly doc: Doc;
  set(changes: Record<string, ir.Expr | Value>): void;
  state(): Record<string, ir.Expr>;
  markdown(): string;
  expose(channel: string, name: string, ...args: (ir.Expr | Value)[]): void;
  snapshot(): Snapshot;
  restore(snap: Snapshot): Restored;
}

export interface MkpDocProps extends DocProps {
  ref?: (handle: MkpDocHandle) => void;
  id?: string;
  class?: string;
}

function current(p: MkpDocProps): DocProps {
  return {
    ir: p.ir,
    src: p.src,
    state: p.state,
    defaultState: p.defaultState,
    defaultSnapshot: p.defaultSnapshot,
    page: p.page,
    externs: p.externs,
    fns: p.fns,
    widgets: p.widgets,
    measure: p.measure,
    onStateChange: p.onStateChange,
    onError: p.onError,
    onCalls: p.onCalls,
  };
}

/**
 * An MKP page. `src` is where its IR is fetched from, or `ir` the IR in hand. `state` with
 * `onStateChange` controls `$state`, or `defaultState` starts it; every write is checked by mkp,
 * and what it refuses reaches `onError`. `ref` is given the handle: `snapshot`, `restore`, `set`,
 * `state`, `markdown` and `expose`.
 */
export function MkpDoc(props: MkpDocProps): JSX.Element {
  const doc = untrack(() => new Doc(current(props)));
  const [version, setVersion] = createSignal(0);
  onCleanup(doc.subscribe(() => setVersion((v) => v + 1)));
  // reads every prop, so it runs again when any changes
  createEffect(() => doc.update(current(props)));
  untrack(() =>
    props.ref?.({
      doc,
      set: (c) => doc.set(c),
      state: () => doc.state(),
      markdown: () => doc.markdown(),
      expose: (c, n, ...a) => doc.expose(c, n, ...a),
      snapshot: () => doc.snapshot(),
      restore: (s) => doc.restore(s),
    }),
  );
  const root = createMemo(() => {
    version();
    const r = doc.render();
    if (props.id) r.attrs.id = props.id;
    if (props.class) r.attrs.class = `${r.attrs.class} ${props.class}`;
    return r;
  });
  return createComponent(Node, { v: root });
}

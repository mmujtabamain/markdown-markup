// <XtmdDoc>: an Extended Mark page drawn by Vue itself. @extended-mark/view runs the document and gives the page as
// plain elements; this renders them with Vue's own `h`, so the page is part of the app's tree,
// rendered on a server as on the client and patched by key, so focus and what is being typed
// survive a change. Listeners are native ones on the elements; the hooks of widgets that draw on
// their element (a canvas, a plane) run as a directive. Listeners for the app are callback props:
// `@state-change="…"` is `onStateChange`.

import { defineComponent, h, markRaw, onBeforeUnmount, shallowRef, watch, withDirectives, type Directive, type PropType, type VNode as VueNode } from "vue";
import { Doc, type Child, type DocProps, type Restored, type Snapshot, type VNode, type Value, type ir } from "@extended-mark/view";

/** A widget's hook, run as a directive on its element: the latest render's hook each time. */
const hooked: Directive<Element, VNode["hook"]> = {
  mounted: (el, b) => b.value?.mount?.(el),
  updated: (el, b) => b.value?.update?.(el),
  beforeUnmount: (el, b) => b.value?.unmount?.(el),
};

/** One of @extended-mark/view's elements as Vue's. */
export function toVue(c: Child): VueNode | string {
  if (typeof c === "string") return c;
  const props: Record<string, unknown> = { ...c.attrs };
  if (c.key !== undefined) props.key = c.key;
  if (c.style) props.style = { ...c.style };
  // DOM properties, as Vue sets them on the live element
  for (const [k, x] of Object.entries(c.props ?? {})) props[k] = x;
  // native listeners: `onCompositionstart` is the DOM's `compositionstart`, with its currentTarget
  for (const [k, f] of Object.entries(c.on ?? {})) props[`on${k[0].toUpperCase()}${k.slice(1)}`] = f;
  if (c.tag === "style") return h("style", { ...props, innerHTML: c.children.join("") });
  const v = h(c.tag, props, c.tag === "textarea" ? undefined : c.children.map(toVue));
  return c.hook ? withDirectives(v, [[hooked, c.hook]]) : v;
}

/** <XtmdDoc>'s props, for a component that wraps it (@extended-mark/vue-live). */
export const docProps = {
  /** The page's IR, in hand. Kept as given: Vue doesn't make it reactive. */
  ir: Object as PropType<DocProps["ir"]>,
  /** Where to fetch the page's IR from. */
  src: String,
  state: Object as PropType<DocProps["state"]>,
  defaultState: Object as PropType<DocProps["defaultState"]>,
  defaultSnapshot: Object as PropType<DocProps["defaultSnapshot"]>,
  page: Object as PropType<DocProps["page"]>,
  externs: Object as PropType<DocProps["externs"]>,
  fns: Object as PropType<DocProps["fns"]>,
  widgets: Object as PropType<DocProps["widgets"]>,
  /** How the plane's spots are measured: left out, from their elements. */
  measure: Function as PropType<DocProps["measure"]>,
  onStateChange: Function as PropType<DocProps["onStateChange"]>,
  onError: Function as PropType<DocProps["onError"]>,
  onCalls: Function as PropType<DocProps["onCalls"]>,
};

/** What a template ref to <XtmdDoc> holds. */
export interface XtmdDocRef {
  doc: Doc;
  set(changes: Record<string, ir.Expr | Value>): void;
  state(): Record<string, ir.Expr>;
  markdown(): string;
  expose(channel: string, name: string, ...args: (ir.Expr | Value)[]): void;
  snapshot(): Snapshot;
  restore(snap: Snapshot): Restored;
}

/**
 * An Extended Mark page. `src` is where its IR is fetched from, or `ir` the IR in hand. `state` with
 * `@state-change` controls `$state`, or `default-state` starts it; every write is checked by xtmd,
 * and what it refuses reaches `@error`. A template ref holds `snapshot`, `restore`, `set`,
 * `state`, `markdown` and `expose`.
 */
export const XtmdDoc = defineComponent({
  name: "XtmdDoc",
  props: docProps,
  setup(p, { expose }) {
    const current = (): DocProps => ({
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
      onStateChange: (s) => p.onStateChange?.(s),
      onError: (e) => p.onError?.(e),
      onCalls: (c) => p.onCalls?.(c),
    });
    const doc = markRaw(new Doc(current()));
    const tick = shallowRef(0);
    const off = doc.subscribe(() => tick.value++);
    watch(current, (next) => doc.update(next), { flush: "post" });
    onBeforeUnmount(off);
    const ref: XtmdDocRef = {
      doc,
      set: (c) => doc.set(c),
      state: () => doc.state(),
      markdown: () => doc.markdown(),
      expose: (c, n, ...a) => doc.expose(c, n, ...a),
      snapshot: () => doc.snapshot(),
      restore: (s) => doc.restore(s),
    };
    expose(ref);
    return () => {
      void tick.value;
      return toVue(doc.render());
    };
  },
});

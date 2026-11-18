// What <MkpNode> needs to render one of @mkp/view's elements as Svelte's own: its attributes,
// live properties and listeners in Svelte 5's spelling, its children's keys, and its hook as an
// action on the real element.

import type { Child, VNode } from "@mkp/view";

/** The attributes Svelte spreads on the element: attributes, style, DOM properties and listeners
 * (`onclick`, `oncompositionstart`: the DOM's own events, with their currentTarget). */
export function attrsOf(v: VNode): Record<string, unknown> {
  const out: Record<string, unknown> = { ...v.attrs };
  if (v.style) out.style = Object.entries(v.style).map(([k, x]) => `${k}:${x}`).join(";");
  for (const [k, x] of Object.entries(v.props ?? {})) out[k] = x;
  for (const [k, f] of Object.entries(v.on ?? {})) out[`on${k}`] = f;
  return out;
}

/** A child's key among its siblings: its own, or its place. */
export function keyOf(c: Child, i: number): string {
  return typeof c === "string" ? `#t${i}` : (c.key ?? `#${i}:${c.tag}`);
}

/** A widget's hook, as an action: once in the document, after each render it stays through, and as it leaves. */
export function hook(el: Element, v: VNode): { update(v: VNode): void; destroy(): void } {
  let latest = v;
  latest.hook?.mount?.(el);
  return {
    update(next: VNode) {
      latest = next;
      next.hook?.update?.(el);
    },
    destroy() {
      latest.hook?.unmount?.(el);
    },
  };
}

// Elements followed onto a live tree through a renderer's own API: for a framework that has no
// virtual tree of its own (Angular, whose Renderer2 is how it makes and changes elements, on a
// server too). Each element is made once, kept by key among its siblings while its tag stays, and
// only what changed is set on it, so focus and what is being typed survive a change.

import type { Child, VNode } from "./vnode.js";

/** What the patcher asks of a renderer: Angular's Renderer2 has each of these. */
export interface Host<N> {
  createElement(tag: string, svg: boolean): N;
  createText(text: string): N;
  setText(node: N, text: string): void;
  setAttribute(el: N, name: string, value: string): void;
  removeAttribute(el: N, name: string): void;
  setStyle(el: N, prop: string, value: string): void;
  removeStyle(el: N, prop: string): void;
  setProperty(el: N, name: string, value: unknown): void;
  listen(el: N, event: string, f: (e: Event) => void): () => void;
  insertBefore(parent: N, child: N, before: N | null): void;
  removeChild(parent: N, child: N): void;
  /** Whether hooks run: false on a server. */
  readonly live: boolean;
}

interface Made<N> {
  node: N;
  v: Child;
  /** Each event's listener: one per name, calling the latest render's handler. */
  off: Map<string, () => void>;
  kids: Map<string, Made<N>>;
  order: string[];
}

function keyOf(c: Child, i: number): string {
  return typeof c === "string" ? `#t${i}` : `${c.key ?? `#${i}`}:${c.tag}`;
}

/** Which of the children keep their place: the longest run whose old places (-1 for a new one)
 * rise, by patience sorting. */
function staying(was: number[]): Set<number> {
  const tails: number[] = [];
  const prev: number[] = was.map(() => -1);
  was.forEach((p, i) => {
    if (p < 0) return;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (was[tails[mid]] < p) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  });
  const out = new Set<number>();
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) out.add(i);
  return out;
}

/** Follows renders of one root element onto a parent node. */
export class Patcher<N> {
  private root: Made<N> | undefined;

  constructor(private readonly host: Host<N>, private readonly parent: N) {}

  /** The root element made, or undefined before the first render. */
  get node(): N | undefined {
    return this.root?.node;
  }

  render(v: VNode): void {
    if (this.root && typeof this.root.v !== "string" && this.root.v.tag === v.tag) this.update(this.root, v);
    else {
      if (this.root) this.remove(this.parent, this.root);
      this.root = this.make(v);
      this.host.insertBefore(this.parent, this.root.node, null);
      this.mounted(this.root);
    }
  }

  /** Takes the tree away: its hooks told, its listeners off. */
  destroy(): void {
    if (this.root) this.remove(this.parent, this.root);
    this.root = undefined;
  }

  private make(c: Child): Made<N> {
    if (typeof c === "string") return { node: this.host.createText(c), v: c, off: new Map(), kids: new Map(), order: [] };
    const m: Made<N> = { node: this.host.createElement(c.tag, !!c.svg), v: c, off: new Map(), kids: new Map(), order: [] };
    this.set(m, undefined, c);
    if (c.tag === "style" || c.tag === "textarea") {
      if (c.tag === "style") this.host.setProperty(m.node, "textContent", c.children.join(""));
      return m;
    }
    c.children.forEach((k, i) => {
      const key = keyOf(k, i);
      const child = this.make(k);
      m.kids.set(key, child);
      m.order.push(key);
      this.host.insertBefore(m.node, child.node, null);
    });
    return m;
  }

  /** Attributes, style, properties and listeners: what changed from `prev`. */
  private set(m: Made<N>, prev: VNode | undefined, v: VNode): void {
    const h = this.host;
    for (const [k, x] of Object.entries(v.attrs)) if (prev?.attrs[k] !== x) h.setAttribute(m.node, k, x);
    for (const k of Object.keys(prev?.attrs ?? {})) if (!(k in v.attrs)) h.removeAttribute(m.node, k);
    const st = v.style ?? {};
    for (const [k, x] of Object.entries(st)) if (prev?.style?.[k] !== x) h.setStyle(m.node, k, x);
    for (const k of Object.keys(prev?.style ?? {})) if (!(k in st)) h.removeStyle(m.node, k);
    // live properties are set every time: what the page shows wins over what the element has
    for (const [k, x] of Object.entries(v.props ?? {})) h.setProperty(m.node, k, x);
    if (h.live) {
      for (const name of Object.keys(v.on ?? {})) {
        if (!m.off.has(name)) m.off.set(name, h.listen(m.node, name, (e) => (m.v as VNode).on?.[name]?.(e)));
      }
      for (const [name, off] of m.off) {
        if (!v.on?.[name]) {
          off();
          m.off.delete(name);
        }
      }
    }
  }

  private update(m: Made<N>, v: Child): void {
    const prev = m.v;
    m.v = v;
    if (typeof v === "string") {
      if (prev !== v) this.host.setText(m.node, v);
      return;
    }
    this.set(m, prev as VNode, v);
    if (v.tag === "style") {
      if (JSON.stringify((prev as VNode).children) !== JSON.stringify(v.children)) this.host.setProperty(m.node, "textContent", v.children.join(""));
    } else if (v.tag !== "textarea") this.children(m, v.children);
    if (this.host.live) v.hook?.update?.(m.node as unknown as Element);
  }

  /** Children by key: kept and told what changed, made, or removed; moved only when out of place. */
  private children(m: Made<N>, next: Child[]): void {
    const keys = next.map(keyOf);
    const made: Made<N>[] = [];
    const fresh: Made<N>[] = [];
    next.forEach((c, i) => {
      const old = m.kids.get(keys[i]);
      if (old) {
        this.update(old, c);
        made.push(old);
      } else {
        const n = this.make(c);
        made.push(n);
        fresh.push(n);
      }
    });
    const keep = new Set(keys);
    for (const [k, old] of m.kids) if (!keep.has(k)) this.remove(m.node, old);
    // in order, moving only what is out of place, so a focused field stays put: the longest run
    // already in order stays, and each of the rest goes in before what follows it
    const was = m.order.filter((k) => keep.has(k));
    const stay = staying(keys.map((k, i) => (fresh.includes(made[i]) ? -1 : was.indexOf(k))));
    for (let i = made.length - 1, after: N | null = null; i >= 0; i--) {
      if (!stay.has(i)) this.host.insertBefore(m.node, made[i].node, after);
      after = made[i].node;
    }
    m.kids = new Map(keys.map((k, i) => [k, made[i]]));
    m.order = keys;
    for (const n of fresh) this.mounted(n);
  }

  /** Hooks of a tree just put in the document, children first. */
  private mounted(m: Made<N>): void {
    if (!this.host.live || typeof m.v === "string") return;
    for (const k of m.order) this.mounted(m.kids.get(k)!);
    m.v.hook?.mount?.(m.node as unknown as Element);
  }

  private remove(parent: N, m: Made<N>): void {
    this.forget(m);
    this.host.removeChild(parent, m.node);
  }

  private forget(m: Made<N>): void {
    for (const k of m.order) this.forget(m.kids.get(k)!);
    for (const off of m.off.values()) off();
    m.off.clear();
    if (this.host.live && typeof m.v !== "string") m.v.hook?.unmount?.(m.node as unknown as Element);
  }
}

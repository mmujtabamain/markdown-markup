<!--
  <XtmdDoc src={url} /> or <XtmdDoc ir={page} />: an Extended Mark page drawn by Svelte itself, on a server
  as on the client. `state` with `onStateChange` controls $state, or `defaultState` starts it;
  every write is checked by xtmd, and what it refuses reaches `onError`. bind:this gives
  snapshot(), restore(), set(), getState(), markdown() and expose().
-->
<script lang="ts">
  import { onDestroy } from "svelte";
  import { Doc, type DocProps, type Restored, type Snapshot, type Value, type ir } from "@extended-mark/view";
  import XtmdNode from "./XtmdNode.svelte";

  let { class: className = undefined, id = undefined, ...props }: DocProps & { class?: string; id?: string } = $props();

  // made once, from the props it starts with; the $effect below follows them after
  // svelte-ignore state_referenced_locally
  const doc = new Doc({ ...props });
  let version = $state(0);
  onDestroy(doc.subscribe(() => version++));
  // the document follows its props
  $effect(() => {
    doc.update({ ...props });
  });
  const root = $derived.by(() => {
    void version;
    const r = doc.render();
    if (id) r.attrs.id = id;
    if (className) r.attrs.class = `${r.attrs.class} ${className}`;
    return r;
  });

  /** The running document. */
  export function document(): Doc {
    return doc;
  }
  export function set(changes: Record<string, ir.Expr | Value>): void {
    doc.set(changes);
  }
  /** `$state` now (`state` is a rune's name in Svelte). */
  export function getState(): Record<string, ir.Expr> {
    return doc.state();
  }
  export function markdown(): string {
    return doc.markdown();
  }
  export function expose(channel: string, name: string, ...args: (ir.Expr | Value)[]): void {
    doc.expose(channel, name, ...args);
  }
  export function snapshot(): Snapshot {
    return doc.snapshot();
  }
  export function restore(snap: Snapshot): Restored {
    return doc.restore(snap);
  }
</script>

<XtmdNode v={root} />

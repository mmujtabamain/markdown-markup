// @mkp/vue-live: <MkpLiveDoc :source="text" />, an MKP document compiled in the browser by
// @mkp/wasm as it is edited, and drawn by @mkp/vue's <MkpDoc>. A text that compiles replaces the
// page, keeping `$state` where its fields still exist; one that doesn't leaves the last page that
// did, and its errors reach `@error` ({ kind: "compile", diagnostics }). The run-time target,
// @mkp/vue, ships no WebAssembly; this one does.

import { defineComponent, h, markRaw, onBeforeUnmount, ref, shallowRef, watch, type PropType } from "vue";
import { MkpDoc, docProps as all, type MkpDocRef } from "@mkp/vue";
import { Live, type Builds, type PackFile, type WasmSource } from "@mkp/live";
import type { Doc, DocError } from "@mkp/view";

const { ir: _ir, src: _src, ...docProps } = all;

/**
 * An MKP document from its text. `wasm` is where mkp.wasm is (`@mkp/wasm/mkp.wasm` as the
 * bundler gives its URL), or `compiler` a compiler in hand; given one already loaded, the first
 * render has the page, on a server too. The rest is <MkpDoc>'s; a template ref holds its handle.
 */
export const MkpLiveDoc = defineComponent({
  name: "MkpLiveDoc",
  props: {
    ...docProps,
    /** The document's text. */
    source: { type: String, required: true },
    path: String,
    packs: Array as PropType<PackFile[]>,
    wasm: [String, Object] as PropType<WasmSource>,
    compiler: Object as PropType<Builds>,
  },
  setup(p, { expose }) {
    const ir = shallowRef<unknown>(undefined);
    const live = markRaw(new Live(() => (ir.value = live.ir)));
    const given = () => ({ source: p.source, path: p.path, packs: p.packs, wasm: p.wasm, compiler: p.compiler });
    const onError = (e: DocError) => p.onError?.(e);
    // a compiler in hand compiles now, so a server renders the page
    live.update(given(), onError);
    ir.value = live.ir;
    watch(given, (next) => live.update(next, onError), { deep: true });
    onBeforeUnmount(() => live.destroy());
    const inner = ref<MkpDocRef | null>(null);
    const handle: MkpDocRef = {
      get doc() {
        return inner.value!.doc as Doc;
      },
      set: (c) => inner.value?.set(c),
      state: () => inner.value?.state() ?? {},
      markdown: () => inner.value?.markdown() ?? "",
      expose: (c, n, ...a) => inner.value?.expose(c, n, ...a),
      snapshot: () => inner.value!.snapshot(),
      restore: (s) => inner.value!.restore(s),
    };
    expose(handle);
    return () => {
      const { source: _s, path: _p, packs: _k, wasm: _w, compiler: _c, ...rest } = p;
      return h(MkpDoc, { ...rest, ir: ir.value as never, ref: inner });
    };
  },
});

export { Compiler, compiler, type Builds, type LiveProps, type PackFile, type WasmSource } from "@mkp/live";
export type { MkpDocRef } from "@mkp/vue";
export type { DocError, Restored, Snapshot } from "@mkp/view";

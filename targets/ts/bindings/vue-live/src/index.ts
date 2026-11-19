// @extended-mark/vue-live: <XtmdLiveDoc :source="text" />, an Extended Mark document compiled in the browser by
// @extended-mark/wasm as it is edited, and drawn by @extended-mark/vue's <XtmdDoc>. A text that compiles replaces the
// page, keeping `$state` where its fields still exist; one that doesn't leaves the last page that
// did, and its errors reach `@error` ({ kind: "compile", diagnostics }). The run-time target,
// @extended-mark/vue, ships no WebAssembly; this one does.

import { defineComponent, h, markRaw, onBeforeUnmount, ref, shallowRef, watch, type PropType } from "vue";
import { XtmdDoc, docProps as all, type XtmdDocRef } from "@extended-mark/vue";
import { Live, type Builds, type PackFile, type WasmSource } from "@extended-mark/live";
import type { Doc, DocError } from "@extended-mark/view";

const { ir: _ir, src: _src, ...docProps } = all;

/**
 * An Extended Mark document from its text. `wasm` is where xtmd.wasm is (`@extended-mark/wasm/xtmd.wasm` as the
 * bundler gives its URL), or `compiler` a compiler in hand; given one already loaded, the first
 * render has the page, on a server too. The rest is <XtmdDoc>'s; a template ref holds its handle.
 */
export const XtmdLiveDoc = defineComponent({
  name: "XtmdLiveDoc",
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
    const inner = ref<XtmdDocRef | null>(null);
    const handle: XtmdDocRef = {
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
      return h(XtmdDoc, { ...rest, ir: ir.value as never, ref: inner });
    };
  },
});

export { Compiler, compiler, type Builds, type LiveProps, type PackFile, type WasmSource } from "@extended-mark/live";
export type { XtmdDocRef } from "@extended-mark/vue";
export type { DocError, Restored, Snapshot } from "@extended-mark/view";

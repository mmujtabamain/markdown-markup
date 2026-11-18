// @mkp/vue: an MKP page in a Vue 3 app. <MkpPage> renders one empty element, and @mkp/dom draws the
// page into it in onMounted, so it renders on a server too. Listeners are its callback props:
// `@calls="…"` is `onCalls`. A template ref gives the page's handle.

import { defineComponent, h, markRaw, onBeforeUnmount, onMounted, ref, shallowRef, watch, type PropType } from "vue";
import { Embed, type Handle, type PageProps } from "@mkp/embed";

const props = {
  /** The page's IR. Kept as given: Vue doesn't make it reactive. */
  ir: { type: Object as PropType<PageProps["ir"]>, required: true as const },
  state: Object as PropType<PageProps["state"]>,
  page: Object as PropType<PageProps["page"]>,
  externs: Object as PropType<PageProps["externs"]>,
  fns: Object as PropType<PageProps["fns"]>,
  widgets: Object as PropType<PageProps["widgets"]>,
  onCalls: Function as PropType<PageProps["onCalls"]>,
  onState: Function as PropType<PageProps["onState"]>,
  onOutcome: Function as PropType<PageProps["onOutcome"]>,
  onMount: Function as PropType<PageProps["onMount"]>,
  /** HTML shown until the page mounts (from @mkp/embed/html on a server). Read once. */
  html: String,
};

export const MkpPage = defineComponent({
  name: "MkpPage",
  props,
  setup(p, { expose }) {
    const root = ref<HTMLDivElement | null>(null);
    const embed = shallowRef<Embed | null>(null);
    const html = p.html;
    const current = (): PageProps => ({
      ir: p.ir,
      state: p.state,
      page: p.page,
      externs: p.externs,
      fns: p.fns,
      widgets: p.widgets,
      onCalls: p.onCalls,
      onState: p.onState,
      onOutcome: p.onOutcome,
      onMount: p.onMount,
    });

    onMounted(() => {
      embed.value = markRaw(new Embed(root.value!, current()));
    });
    watch(current, (next) => embed.value?.update(next), { flush: "post" });
    onBeforeUnmount(() => {
      embed.value?.destroy();
      embed.value = null;
    });

    const handle = (): Handle => {
      if (!embed.value) throw new Error("@mkp/vue: the page isn't mounted yet");
      return embed.value;
    };
    expose({
      handle,
      set: (...a: Parameters<Handle["set"]>) => handle().set(...a),
      expose: (...a: Parameters<Handle["expose"]>) => handle().expose(...a),
      extern: (...a: Parameters<Handle["extern"]>) => handle().extern(...a),
      state: () => handle().state(),
      markdown: () => handle().markdown(),
    });

    return () => h("div", { ref: root, "data-mkp-page": "", ...(html ? { innerHTML: html } : {}) });
  },
});

/** What a template ref to <MkpPage> holds. */
export interface MkpPageRef extends Pick<Handle, "set" | "expose" | "extern" | "state" | "markdown"> {
  /** The handle itself, once mounted: its `page` and `mounted` too. */
  handle(): Handle;
}

export type { Call, Given, Handle, Ir, Mounted, Outcome, Page, PageProps, PageValues, Value, Widget, ir } from "@mkp/embed";

export { MkpDoc, docProps, toVue, type MkpDocRef } from "./doc.js";
export type { DocError, DocProps, Restored, Snapshot } from "@mkp/view";

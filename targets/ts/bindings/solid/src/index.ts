// @mkp/solid: an MKP page in a Solid app. <MkpPage> renders one empty element, and @mkp/dom draws
// the page into it in onMount, so it renders on a server too. Written without JSX, so it needs no
// Solid compiler. `ref` gives the page's handle once it is mounted.

import { createComponent, createEffect, onCleanup, onMount, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { Embed, type Handle, type PageProps } from "@mkp/embed";

export interface MkpPageProps extends PageProps {
  /** Called with the page's handle once it is mounted. */
  ref?: (handle: Handle) => void;
  id?: string;
  class?: string;
}

function current(p: MkpPageProps): PageProps {
  return {
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
  };
}

/** An MKP page. Its props are followed as @mkp/embed says: `page` calls page.setPage, a new `ir`
 * or `widgets` remounts keeping `$state`, a changed channel in `externs` sets its values. */
export function MkpPage(props: MkpPageProps): JSX.Element {
  let root: HTMLDivElement | undefined;
  let embed: Embed | undefined;
  onMount(() => {
    embed = new Embed(root!, current(props));
    props.ref?.(embed);
  });
  // reads every prop, so it runs again when any changes
  createEffect(() => {
    const next = current(props);
    embed?.update(next);
  });
  onCleanup(() => {
    embed?.destroy();
    embed = undefined;
  });
  return createComponent(Dynamic, {
    component: "div",
    ref: (el: HTMLDivElement) => (root = el),
    get id() {
      return props.id;
    },
    get class() {
      return props.class;
    },
    "data-mkp-page": "",
  });
}

export type { Call, Given, Handle, Ir, Mounted, Outcome, Page, PageProps, PageValues, Value, Widget, ir } from "@mkp/embed";

export { MkpDoc, MkpNode, type MkpDocHandle, type MkpDocProps } from "./doc.js";
export type { DocError, DocProps, Restored, Snapshot } from "@mkp/view";

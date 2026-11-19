import { createComponent, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { XtmdDoc } from "@extended-mark/solid";
import { XtmdLiveDoc } from "@extended-mark/solid-live";
import { S, compiled, failed, onEdit, showState } from "./common.mjs";

const id = "solid";
const [state, setState] = createSignal(undefined);
let run;
render(
  () =>
    createComponent(XtmdDoc, {
      ref: (h) => (run = h),
      ir: S.ir,
      get state() {
        return state();
      },
      onStateChange: (s) => (setState(s), showState(id, s)),
    }),
  document.getElementById(`${id}-run`),
);
showState(id, run.state());

const [source, setSource] = createSignal(S.source);
let live;
render(
  () =>
    createComponent(XtmdLiveDoc, {
      ref: (h) => (live = h),
      get source() {
        return source();
      },
      wasm: S.wasm,
      onError: failed(id),
    }),
  document.getElementById(`${id}-live`),
);
onEdit(id, setSource);
compiled(id, live.doc);

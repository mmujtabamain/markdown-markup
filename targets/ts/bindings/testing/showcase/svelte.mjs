import { flushSync, mount } from "svelte";
import { XtmdDoc } from "@extended-mark/svelte";
import LiveSvelte from "./LiveSvelte.svelte";
import { S, compiled, failed, onEdit, showState } from "./common.mjs";

const id = "svelte";
const run = mount(XtmdDoc, { target: document.getElementById(`${id}-run`), props: { ir: S.ir, onStateChange: (s) => showState(id, s) } });
const live = mount(LiveSvelte, { target: document.getElementById(`${id}-live`), props: { first: S.source, wasm: S.wasm, onError: failed(id) } });
flushSync();
showState(id, run.getState());
onEdit(id, (t) => live.setSource(t));
compiled(id, live.doc());

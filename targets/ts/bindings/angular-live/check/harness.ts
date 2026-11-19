// The Angular real-time target's check harness: <xtmd-live-doc> made by Angular, zoneless, driven by the checks.
import "@angular/compiler";
import { createComponent, provideZonelessChangeDetection, type ApplicationRef } from "@angular/core";
import { createApplication } from "@angular/platform-browser";
import { XtmdLiveDoc } from "../dist/index.js";
import { install } from "../../testing/view_harness.mjs";

// made once, at the first load: a browser bundle can't wait at its top level
let started: Promise<ApplicationRef> | undefined;

install(async (root: HTMLElement, props: any) => {
  const app = await (started ??= createApplication({ providers: [provideZonelessChangeDetection()] }));
  const ref = createComponent(XtmdLiveDoc, { environmentInjector: app.injector, hostElement: root.appendChild(document.createElement("xtmd-live-doc")) });
  // the case's text, compiled in the tab by the xtmd.wasm the adapter serves
  const { source } = props;
  for (const [k, v] of Object.entries({ source: source.text, path: source.path, packs: source.packs, wasm: (window as any).__WASM_URL })) ref.setInput(k, v);
  for (const k of ["page", "defaultState", "externs", "fns", "widgets", "measure"]) ref.setInput(k, props[k]);
  ref.instance.calls.subscribe((c) => props.onCalls?.(c));
  ref.instance.error.subscribe((e) => props.onError?.(e));
  app.attachView(ref.hostView);
  ref.changeDetectorRef.detectChanges();
  return { doc: () => ref.instance.document, unmount: () => ref.destroy() };
});

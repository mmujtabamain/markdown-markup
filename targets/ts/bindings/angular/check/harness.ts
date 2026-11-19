// The Angular target's check harness: <xtmd-doc> made by Angular, zoneless, driven by the checks.
import "@angular/compiler";
import { createComponent, provideZonelessChangeDetection, type ApplicationRef } from "@angular/core";
import { createApplication } from "@angular/platform-browser";
import { XtmdDoc } from "../dist/index.js";
import { install } from "../../testing/view_harness.mjs";

// made once, at the first load: a browser bundle can't wait at its top level
let started: Promise<ApplicationRef> | undefined;

install(async (root: HTMLElement, props: any) => {
  const app = await (started ??= createApplication({ providers: [provideZonelessChangeDetection()] }));
  const ref = createComponent(XtmdDoc, { environmentInjector: app.injector, hostElement: root.appendChild(document.createElement("xtmd-doc")) });
  for (const k of ["ir", "page", "defaultState", "externs", "fns", "widgets", "measure"]) ref.setInput(k, props[k]);
  ref.instance.calls.subscribe((c) => props.onCalls?.(c));
  ref.instance.error.subscribe((e) => props.onError?.(e));
  app.attachView(ref.hostView);
  ref.changeDetectorRef.detectChanges();
  return { doc: () => ref.instance.document, unmount: () => ref.destroy() };
});

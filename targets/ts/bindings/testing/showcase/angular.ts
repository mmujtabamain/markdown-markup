import "@angular/compiler";
import { createComponent, provideZonelessChangeDetection } from "@angular/core";
import { createApplication } from "@angular/platform-browser";
import { XtmdDoc } from "@extended-mark/angular";
import { XtmdLiveDoc } from "@extended-mark/angular-live";
import { S, compiled, failed, onEdit, showState } from "./common.mjs";

const id = "angular";

createApplication({ providers: [provideZonelessChangeDetection()] }).then((app) => {
  const host = (where: string, tag: string) => document.getElementById(where)!.appendChild(document.createElement(tag));
  const run = createComponent(XtmdDoc, { environmentInjector: app.injector, hostElement: host(`${id}-run`, "xtmd-doc") });
  run.setInput("ir", S.ir);
  run.instance.stateChange.subscribe((s: any) => showState(id, s));
  app.attachView(run.hostView);
  run.changeDetectorRef.detectChanges();
  showState(id, run.instance.getState());

  const live = createComponent(XtmdLiveDoc, { environmentInjector: app.injector, hostElement: host(`${id}-live`, "xtmd-live-doc") });
  live.setInput("source", S.source);
  live.setInput("wasm", S.wasm);
  live.instance.error.subscribe(failed(id));
  app.attachView(live.hostView);
  live.changeDetectorRef.detectChanges();
  onEdit(id, (t: string) => {
    live.setInput("source", t);
    live.changeDetectorRef.detectChanges();
  });
  // the live document is there once its first text has compiled
  const watch = setInterval(() => {
    const d = live.instance.document;
    if (d) {
      clearInterval(watch);
      compiled(id, d);
    }
  }, 50);
});

// The test app for <mkp-live-doc>: its text compiled in the tab, zoneless, with the controls the
// shared live steps use (testing/browser.mjs, liveSteps).
import "@angular/compiler";
import { Component, ViewChild, provideZonelessChangeDetection, signal } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import { MkpLiveDoc } from "@mkp/angular-live";

const heard = { states: [] as unknown[], errors: [] as unknown[], calls: [] as unknown[] };

@Component({
  selector: "test-app",
  standalone: true,
  imports: [MkpLiveDoc],
  template: `<mkp-live-doc #view [source]="source()" [wasm]="wasm" [externs]="externs" (stateChange)="heard.states.push($event)" (error)="heard.errors.push($event)" (calls)="heard.calls.push($event)" />`,
})
class TestApp {
  heard = heard;
  source = signal<string>((window as any).__SRC.v1);
  wasm = (window as any).__WASM_URL;
  externs = { app: { unit: { text: "items" } } };
  @ViewChild("view") view?: MkpLiveDoc;
}

document.getElementById("app")!.append(document.createElement("test-app"));
bootstrapApplication(TestApp, { providers: [provideZonelessChangeDetection()] }).then((ref) => {
  const app = ref.components[0].instance as TestApp;
  const view = () => app.view!;
  (window as any).__test = {
    heard,
    handle: () => ({ set: (c: any) => view().set(c), state: () => view().getState(), markdown: () => view().markdown() }),
    setSource: (s: string) => app.source.set(s),
  };
});

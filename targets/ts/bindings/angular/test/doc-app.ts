// The test app for <mkp-doc>: drawn by Angular itself through Renderer2, zoneless, `$state`
// controlled by the app, with the controls the shared doc steps use (testing/browser.mjs).
import "@angular/compiler";
import { Component, ViewChild, computed, provideZonelessChangeDetection, signal } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import { MkpDoc } from "@mkp/angular";

const heard = { states: [] as unknown[], errors: [] as unknown[], calls: [] as unknown[] };
const irs = (window as any).__IR;

@Component({
  selector: "test-app",
  standalone: true,
  imports: [MkpDoc],
  template: `@if (shown()) {
    <mkp-doc #view [ir]="ir()" [state]="state()" [page]="pageValues()" [externs]="externs()" (stateChange)="changed($event)" (error)="heard.errors.push($event)" (calls)="heard.calls.push($event)" />
  }`,
})
class TestApp {
  heard = heard;
  which = signal<"v1" | "v2" | "notes">("v1");
  theme = signal<"LIGHT" | "DARK">("LIGHT");
  shown = signal(true);
  unit = signal("items");
  state = signal<any>(undefined);
  externs = computed(() => ({ app: { unit: { text: this.unit() } } }));
  ir = computed(() => irs[this.which()]);
  pageValues = computed(() => ({ theme: this.theme() }));
  @ViewChild("view") view?: MkpDoc;
  changed(s: unknown) {
    heard.states.push(s);
    this.state.set(s);
  }
}

document.getElementById("app")!.append(document.createElement("test-app"));
bootstrapApplication(TestApp, { providers: [provideZonelessChangeDetection()] }).then((ref) => {
  const app = ref.components[0].instance as TestApp;
  const view = () => app.view!;
  (window as any).__test = {
    heard,
    handle: () => ({
      set: (c: any) => view().set(c),
      state: () => view().getState(),
      markdown: () => view().markdown(),
      expose: (c: string, n: string, ...a: any[]) => view().expose(c, n, ...a),
      snapshot: () => view().snapshot(),
      restore: (s: any) => view().restore(s),
    }),
    setState: (s: unknown) => app.state.set(s),
    setTheme: (t: "LIGHT" | "DARK") => app.theme.set(t),
    setIr: (w: "v1" | "v2" | "notes") => app.which.set(w),
    setUnit: (u: string) => app.unit.set(u),
    unmount: () => app.shown.set(false),
  };
});

// The test app: <mkp-page> in Angular, zoneless and compiled just in time in the browser, with the
// controls the shared steps use (testing/browser.mjs). @mkp/angular is the library as ngc built it.
import "@angular/compiler";
import { Component, ViewChild, computed, provideZonelessChangeDetection, signal } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import { MkpPage } from "@mkp/angular";

const heard = { calls: [] as unknown[], states: [] as unknown[], outcomes: [] as unknown[], mounts: 0 };
const irs = (window as any).__IR;

@Component({
  selector: "test-app",
  standalone: true,
  imports: [MkpPage],
  template: `@if (shown()) {
    <mkp-page #view [ir]="ir()" [page]="pageValues()" [externs]="externs()" (calls)="heard.calls.push($event)" (stateChange)="heard.states.push($event)" (outcome)="heard.outcomes.push($event)" (mounted)="heard.mounts = heard.mounts + 1" />
  }`,
})
class TestApp {
  heard = heard;
  which = signal<"v1" | "v2">("v1");
  theme = signal<"LIGHT" | "DARK">("LIGHT");
  shown = signal(true);
  unit = signal("items");
  externs = computed(() => ({ app: { unit: { text: this.unit() } } }));
  ir = computed(() => irs[this.which()]);
  pageValues = computed(() => ({ theme: this.theme() }));
  @ViewChild("view") view?: MkpPage;
}

document.getElementById("app")!.append(document.createElement("test-app"));
bootstrapApplication(TestApp, { providers: [provideZonelessChangeDetection()] }).then((ref) => {
  const app = ref.components[0].instance as TestApp;
  (window as any).__test = {
    heard,
    handle: () => app.view?.handle,
    setTheme: (t: "LIGHT" | "DARK") => app.theme.set(t),
    setIr: (w: "v1" | "v2") => app.which.set(w),
    setUnit: (u: string) => app.unit.set(u),
    unmount: () => app.shown.set(false),
  };
});

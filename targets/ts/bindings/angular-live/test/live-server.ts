// The live page rendered by Angular on a server, given a compiler: compiled and drawn, no browser.
import "@angular/compiler";
import { Component, provideZonelessChangeDetection } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import { provideServerRendering, renderApplication } from "@angular/platform-server";
import { XtmdLiveDoc, type Builds } from "@extended-mark/angular-live";

export async function render(source: string, compiler: Builds): Promise<string> {
  @Component({
    selector: "test-app",
    standalone: true,
    imports: [XtmdLiveDoc],
    template: `<xtmd-live-doc [source]="source" [compiler]="compiler" [defaultState]="start" [externs]="externs" />`,
  })
  class ServerApp {
    source = source;
    compiler = compiler;
    start = { n: { num: "2" } };
    externs = { app: { unit: { text: "items" } } };
  }
  return renderApplication((context) => bootstrapApplication(ServerApp, { providers: [provideServerRendering(), provideZonelessChangeDetection()] }, context), {
    document: "<!doctype html><html><head></head><body><test-app></test-app></body></html>",
  });
}

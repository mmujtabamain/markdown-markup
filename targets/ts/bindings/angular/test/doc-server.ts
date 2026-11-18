// The same page rendered by Angular on a server: platform-server's DOM, Renderer2, no browser.
import "@angular/compiler";
import { Component, provideZonelessChangeDetection } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import { provideServerRendering, renderApplication } from "@angular/platform-server";
import { MkpDoc } from "@mkp/angular";

export async function render(ir: unknown): Promise<string> {
  @Component({
    selector: "test-app",
    standalone: true,
    imports: [MkpDoc],
    template: `<mkp-doc [ir]="ir" [defaultState]="start" [externs]="externs" />`,
  })
  class ServerApp {
    ir = ir as any;
    start = { n: { num: "2" } };
    externs = { app: { unit: { text: "items" } } };
  }
  return renderApplication((context) => bootstrapApplication(ServerApp, { providers: [provideServerRendering(), provideZonelessChangeDetection()] }, context), {
    document: "<!doctype html><html><head></head><body><test-app></test-app></body></html>",
  });
}

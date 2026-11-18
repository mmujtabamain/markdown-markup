// @mkp/angular-live: <mkp-live-doc [source]="text" />, an MKP document compiled in the browser by
// @mkp/wasm as it is edited, and drawn by @mkp/angular's <mkp-doc>. A text that compiles replaces
// the page, keeping `$state` where its fields still exist; one that doesn't leaves the last page
// that did, and its errors come out of (error) ({ kind: "compile", diagnostics }). The run-time
// target, @mkp/angular, ships no WebAssembly; this one does.

import { ChangeDetectorRef, Component, EventEmitter, Input, Output, ViewChild, inject, type OnChanges, type OnDestroy } from "@angular/core";
import { MkpDoc } from "@mkp/angular";
import { Live, type Builds, type PackFile, type WasmSource } from "@mkp/live";
import type { Call, DocError, DocProps, Restored, Snapshot, Value, ir } from "@mkp/view";

@Component({
  selector: "mkp-live-doc",
  standalone: true,
  imports: [MkpDoc],
  host: { style: "display: contents" },
  template: `<mkp-doc [ir]="ir" [state]="state" [defaultState]="defaultState" [defaultSnapshot]="defaultSnapshot" [page]="page" [externs]="externs" [fns]="fns" [widgets]="widgets" [measure]="measure" (stateChange)="stateChange.emit($event)" (error)="error.emit($event)" (calls)="calls.emit($event)" />`,
})
export class MkpLiveDoc implements OnChanges, OnDestroy {
  /** The document's text. */
  @Input({ required: true }) source!: string;
  /** Its path, for diagnostics: `page.mkp.md` when left out. */
  @Input() path?: string;
  /** The files of the packs it uses. */
  @Input() packs?: PackFile[];
  /** Where mkp.wasm is, when `compiler` isn't given. */
  @Input() wasm?: WasmSource;
  /** A compiler in hand: given one already loaded, the first render has the page, on a server too. */
  @Input() compiler?: Builds;
  @Input() state?: DocProps["state"];
  @Input() defaultState?: DocProps["defaultState"];
  @Input() defaultSnapshot?: DocProps["defaultSnapshot"];
  @Input() page?: DocProps["page"];
  @Input() externs?: DocProps["externs"];
  @Input() fns?: DocProps["fns"];
  @Input() widgets?: DocProps["widgets"];
  @Input() measure?: DocProps["measure"];

  @Output() readonly stateChange = new EventEmitter<Record<string, ir.Expr>>();
  /** A text that didn't compile, as well as everything <mkp-doc>'s (error) says. */
  @Output() readonly error = new EventEmitter<DocError>();
  @Output() readonly calls = new EventEmitter<Call[]>();

  /** The IR drawn: the last text that compiled. */
  ir: DocProps["ir"];
  @ViewChild(MkpDoc) private inner?: MkpDoc;
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly live = new Live(() => {
    this.ir = this.live.ir;
    this.cdr.markForCheck();
  });

  ngOnChanges(): void {
    this.live.update({ source: this.source, path: this.path, packs: this.packs, wasm: this.wasm, compiler: this.compiler }, (e) => this.error.emit(e));
    this.ir = this.live.ir;
  }

  ngOnDestroy(): void {
    this.live.destroy();
  }

  // ---- the handle: <mkp-doc>'s

  get document() {
    return this.inner?.document;
  }
  set(changes: Record<string, ir.Expr | Value>): void {
    this.inner?.set(changes);
  }
  getState(): Record<string, ir.Expr> {
    return this.inner?.getState() ?? {};
  }
  markdown(): string {
    return this.inner?.markdown() ?? "";
  }
  expose(channel: string, name: string, ...args: (ir.Expr | Value)[]): void {
    this.inner?.expose(channel, name, ...args);
  }
  snapshot(): Snapshot {
    return this.inner!.snapshot();
  }
  restore(snap: Snapshot): Restored {
    return this.inner!.restore(snap);
  }
}

export { Compiler, compiler, type Builds, type LiveProps, type PackFile, type WasmSource } from "@mkp/live";

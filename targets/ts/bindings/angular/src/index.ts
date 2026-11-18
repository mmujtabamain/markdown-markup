// @mkp/angular: an MKP page in an Angular app. <mkp-page [ir]="page" /> is a standalone component
// whose own element @mkp/dom draws the page into, after its view is ready and only in a browser, so
// it renders on a server too (as its empty element). What the page does comes out as outputs:
// (calls), (stateChange), (outcome) and (mounted). `handle` gives the page's handle once mounted.

import { Component, ElementRef, EventEmitter, Input, Output, PLATFORM_ID, inject, type AfterViewInit, type OnChanges, type OnDestroy } from "@angular/core";
import { isPlatformBrowser } from "@angular/common";
import { Embed, type Call, type Handle, type Mounted, type Outcome, type PageProps, type ir } from "@mkp/embed";

@Component({
  selector: "mkp-page",
  standalone: true,
  template: "",
  host: { "data-mkp-page": "", style: "display: block" },
})
export class MkpPage implements AfterViewInit, OnChanges, OnDestroy {
  /** The page's IR. A new one remounts the page, keeping `$state` where its fields still exist. */
  @Input({ required: true }) ir!: PageProps["ir"];
  /** `$state` to start from, in the IR's form: read when the page is mounted. */
  @Input() state?: PageProps["state"];
  @Input() page?: PageProps["page"];
  @Input() externs?: PageProps["externs"];
  @Input() fns?: PageProps["fns"];
  @Input() widgets?: PageProps["widgets"];

  /** The app's extern fns the page called, after each change that called any. */
  @Output() readonly calls = new EventEmitter<Call[]>();
  /** `$state` after each change to it: `[(state)]` keeps a field of the app's in step. */
  @Output() readonly stateChange = new EventEmitter<Record<string, ir.Expr>>();
  /** Writes that were refused and failures, after each change that had any. */
  @Output() readonly outcome = new EventEmitter<Outcome>();
  /** The page was drawn: when it is mounted, and again after each remount. */
  @Output() readonly mounted = new EventEmitter<Mounted>();

  private readonly el: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private embed: Embed | undefined;

  /** The page's handle, once it is mounted: `set`, `expose`, `extern`, `state`, `markdown`. */
  get handle(): Handle | undefined {
    return this.embed;
  }

  ngAfterViewInit(): void {
    if (this.browser) this.embed = new Embed(this.el.nativeElement, this.props());
  }

  ngOnChanges(): void {
    this.embed?.update(this.props());
  }

  ngOnDestroy(): void {
    this.embed?.destroy();
    this.embed = undefined;
  }

  private props(): PageProps {
    return {
      ir: this.ir,
      state: this.state,
      page: this.page,
      externs: this.externs,
      fns: this.fns,
      widgets: this.widgets,
      onCalls: (c) => this.calls.emit(c),
      onState: (s) => this.stateChange.emit(s),
      onOutcome: (o) => this.outcome.emit(o),
      onMount: (m) => this.mounted.emit(m),
    };
  }
}

export type { Call, Given, Handle, Ir, Mounted, Outcome, Page, PageProps, PageValues, Value, Widget, ir } from "@mkp/embed";

export { MkpDoc } from "./doc.js";
export type { DocError, DocProps, Restored, Snapshot } from "@mkp/view";

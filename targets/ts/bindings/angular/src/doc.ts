// <xtmd-doc>: an Extended Mark page drawn by Angular itself. @extended-mark/view runs the document and gives the page as
// plain elements after every change; they are followed onto the component's element through
// Angular's Renderer2, the same way Angular makes and changes every element, on a server as in the
// browser: each element made once, kept by key, and only what changed set on it. What the page does
// comes out as outputs: (stateChange), (error) and (calls).

import { Component, ElementRef, EventEmitter, Input, NgZone, Output, PLATFORM_ID, Renderer2, RendererStyleFlags2, inject, type OnChanges, type OnDestroy, type OnInit } from "@angular/core";
import { isPlatformBrowser } from "@angular/common";
import { Doc, Patcher, type Call, type DocError, type DocProps, type Host, type Restored, type Snapshot, type Value, type ir } from "@extended-mark/view";

const SVG = "svg";

@Component({
  selector: "xtmd-doc",
  standalone: true,
  template: "",
  host: { style: "display: contents" },
})
export class XtmdDoc implements OnInit, OnChanges, OnDestroy {
  /** The page's IR, in hand. */
  @Input() ir?: DocProps["ir"];
  /** Where to fetch the page's IR from. */
  @Input() src?: string;
  /** `$state`, controlled: `[(state)]` keeps a field of the app's in step. */
  @Input() state?: DocProps["state"];
  @Input() defaultState?: DocProps["defaultState"];
  @Input() defaultSnapshot?: DocProps["defaultSnapshot"];
  @Input() page?: DocProps["page"];
  @Input() externs?: DocProps["externs"];
  @Input() fns?: DocProps["fns"];
  @Input() widgets?: DocProps["widgets"];
  /** How the plane's spots are measured: left out, from their elements. */
  @Input() measure?: DocProps["measure"];

  /** `$state` after each change to it. */
  @Output() readonly stateChange = new EventEmitter<Record<string, ir.Expr>>();
  /** A write xtmd refused, a widget that failed, or an IR that couldn't be had. */
  @Output() readonly error = new EventEmitter<DocError>();
  /** The app's extern fns the page called, after each change that called any. */
  @Output() readonly calls = new EventEmitter<Call[]>();

  private readonly el: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly renderer = inject(Renderer2);
  private readonly zone = inject(NgZone);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private doc!: Doc;
  private patcher!: Patcher<unknown>;
  private off: (() => void) | undefined;

  /** The running document. */
  get document(): Doc {
    return this.doc;
  }

  ngOnInit(): void {
    const r = this.renderer;
    const host: Host<unknown> = {
      live: this.browser,
      createElement: (tag, svg) => r.createElement(tag, svg ? SVG : undefined),
      createText: (text) => r.createText(text),
      setText: (node, text) => r.setValue(node, text),
      setAttribute: (el, name, value) => r.setAttribute(el, name, value),
      removeAttribute: (el, name) => r.removeAttribute(el, name),
      setStyle: (el, prop, value) => r.setStyle(el, prop, value, RendererStyleFlags2.DashCase),
      removeStyle: (el, prop) => r.removeStyle(el, prop, RendererStyleFlags2.DashCase),
      setProperty: (el, name, value) => r.setProperty(el, name, value),
      // the page's listeners run inside Angular's zone, so what they change is checked
      listen: (el, event, f) => r.listen(el, event, (e: Event) => this.zone.run(() => f(e))),
      insertBefore: (parent, child, before) => r.insertBefore(parent, child, before),
      removeChild: (parent, child) => r.removeChild(parent, child),
    };
    this.doc = new Doc(this.props());
    this.patcher = new Patcher(host, this.el.nativeElement);
    this.off = this.doc.subscribe(() => this.render());
    this.render();
  }

  ngOnChanges(): void {
    this.doc?.update(this.props());
  }

  ngOnDestroy(): void {
    this.off?.();
    this.patcher?.destroy();
  }

  // ---- the handle: a template reference variable or @ViewChild

  set(changes: Record<string, ir.Expr | Value>): void {
    this.doc.set(changes);
  }

  getState(): Record<string, ir.Expr> {
    return this.doc.state();
  }

  markdown(): string {
    return this.doc.markdown();
  }

  expose(channel: string, name: string, ...args: (ir.Expr | Value)[]): void {
    this.doc.expose(channel, name, ...args);
  }

  snapshot(): Snapshot {
    return this.doc.snapshot();
  }

  restore(snap: Snapshot): Restored {
    return this.doc.restore(snap);
  }

  private render(): void {
    this.patcher.render(this.doc.render());
  }

  private props(): DocProps {
    return {
      ir: this.ir,
      src: this.src,
      state: this.state,
      defaultState: this.defaultState,
      defaultSnapshot: this.defaultSnapshot,
      page: this.page,
      externs: this.externs,
      fns: this.fns,
      widgets: this.widgets,
      measure: this.measure,
      onStateChange: (s) => this.stateChange.emit(s),
      onError: (e) => this.error.emit(e),
      onCalls: (c) => this.calls.emit(c),
    };
  }
}

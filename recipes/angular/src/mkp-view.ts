// MkpView: an MKP document in an Angular app. Copy this file; it needs the release's web files in ./vendor/mkp.
import { afterNextRender, Component, DestroyRef, effect, ElementRef, inject, input, output, viewChild } from '@angular/core';
import { mount, type IRBundle, type MountedDocument, type SignalEvent } from './vendor/mkp/mkp-dom.js';

@Component({ selector: 'mkp-view', template: '<div #host></div>' })
export class MkpView {
  readonly bundle = input.required<IRBundle>();
  readonly theme = input<'light' | 'dark' | 'auto'>('auto');
  readonly signal = output<SignalEvent>();
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private view?: MountedDocument;

  constructor() {
    afterNextRender(() => {
      this.view = mount(this.host().nativeElement, this.bundle(), { theme: this.theme(), onSignal: (e) => this.signal.emit(e) });
    });
    // a new theme keeps the reader's place; a new bundle starts the document again
    effect(() => {
      const theme = this.theme();
      this.view?.update({ theme });
    });
    effect(() => {
      const bundle = this.bundle();
      if (this.view) this.view.setBundle(bundle);
    });
    inject(DestroyRef).onDestroy(() => this.view?.unmount());
  }
}

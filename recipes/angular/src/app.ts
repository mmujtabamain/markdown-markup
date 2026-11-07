import { Component, signal } from '@angular/core';
import source from './lesson.mkp.md';
import { MkpView } from './mkp-view';
import { compile, type IRBundle, type SignalEvent } from './vendor/mkp/mkp.js';

@Component({
  selector: 'mkp-recipe',
  imports: [MkpView],
  template: `
    <header>
      <h2>MKP in Angular</h2>
      <button (click)="dark.set(!dark())">{{ dark() ? 'Light' : 'Dark' }}</button>
      <button (click)="shown.set(!shown())">{{ shown() ? 'Hide' : 'Show' }}</button>
      <output data-said>{{ said() }}</output>
    </header>
    @if (shown()) {
      <mkp-view [bundle]="bundle" [theme]="dark() ? 'dark' : 'light'" (signal)="onSignal($event)" />
    }
  `,
})
export class App {
  readonly bundle: IRBundle = compile({ packs: [] }).document(source, 'lesson.mkp.md')!;
  readonly dark = signal(false);
  readonly shown = signal(true);
  readonly said = signal('');
  onSignal(e: SignalEvent): void {
    const p = e.payload as { value: string; correct: boolean };
    this.said.set(`${e.name}: ${p.value} (${p.correct ? 'right' : 'wrong'})`);
  }
}

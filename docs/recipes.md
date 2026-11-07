# Recipes

MKP in Vue, Svelte, Solid, Angular, Astro and a page with no framework. Each recipe is a small,
tested app in the repository's `recipes/` folder; the component below is the part to copy. React
apps use `mkp-react.js` instead (see the integration guide).

## What every recipe needs

The release's web files, unzipped together, and `mkp-dom.js`'s `mount()`:

```sh
mkdir -p src/vendor/mkp && unzip -j mkp-web-0.1.2.zip -d src/vendor/mkp
```

```ts
import { compile } from './vendor/mkp/mkp.js';
import { mount } from './vendor/mkp/mkp-dom.js';

const bundle = compile({ packs: [] }).document(source, 'lesson.mkp.md');
const view = mount(el, bundle, { theme: 'auto', onSignal: (e) => console.log(e.name, e.payload) });
view.update({ theme: 'dark' });   // the reader's place stays
view.setBundle(next);             // another document: its state starts again
view.unmount();
```

`mount()` draws MKP's own look with a React kept inside `mkp-dom.js`: the app needs no React of its
own. It loads the maths engine (`maths-engine.js`, beside it) the first time; `view.ready` resolves
once the document is drawn. A document's signals (an answer checked, a step reached) reach
`onSignal`; each recipe shows the last one in the app.

A document can also be compiled ahead of time, so the page ships no compiler: `mkp build
lesson.mkp.md --target ir` writes `lesson.ir.json`, which `mount()` takes as it is. The Astro
recipe does this when the site is built.

## Vue

<!-- recipe vue/src/MkpView.vue -->
```vue
<!-- MkpView: an MKP document in a Vue app. Copy this file; it needs the release's web files in ./vendor/mkp. -->
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { mount, type IRBundle, type MountedDocument, type SignalEvent } from './vendor/mkp/mkp-dom.js';

const props = defineProps<{ bundle: IRBundle; theme?: 'light' | 'dark' | 'auto' }>();
const emit = defineEmits<{ signal: [e: SignalEvent] }>();
const el = ref<HTMLElement>();
let view: MountedDocument | undefined;

onMounted(() => {
  view = mount(el.value!, props.bundle, { theme: props.theme, onSignal: (e) => emit('signal', e) });
});
// a new theme keeps the reader's place; a new bundle starts the document again
watch(() => props.theme, (theme) => view?.update({ theme }));
watch(() => props.bundle, (bundle) => view?.setBundle(bundle));
onBeforeUnmount(() => view?.unmount());
</script>

<template><div ref="el" /></template>
```

Used as `<MkpView :bundle="bundle" :theme="dark ? 'dark' : 'light'" @signal="onSignal" />`.

## Svelte

<!-- recipe svelte/src/MkpView.svelte -->
```svelte
<!-- MkpView: an MKP document in a Svelte 5 app. Copy this file; it needs the release's web files in ./vendor/mkp. -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { mount, type IRBundle, type MountedDocument, type SignalEvent } from './vendor/mkp/mkp-dom.js';

  let { bundle, theme = 'auto', onsignal }: { bundle: IRBundle; theme?: 'light' | 'dark' | 'auto'; onsignal?: (e: SignalEvent) => void } = $props();
  let el: HTMLElement;
  let view: MountedDocument | undefined = $state.raw();

  // a new bundle starts the document again
  $effect(() => {
    const v = mount(el, bundle, { theme: untrack(() => theme), onSignal: (e) => onsignal?.(e) });
    view = v;
    return () => v.unmount();
  });
  // a new theme keeps the reader's place
  $effect(() => view?.update({ theme }));
</script>

<div bind:this={el}></div>
```

Used as `<MkpView {bundle} theme={dark ? 'dark' : 'light'} {onsignal} />`.

## Solid

<!-- recipe solid/src/MkpView.tsx -->
```tsx
// MkpView: an MKP document in a Solid app. Copy this file; it needs the release's web files in ./vendor/mkp.
import { createEffect, on, onCleanup, onMount } from 'solid-js';
import { mount, type IRBundle, type SignalEvent } from './vendor/mkp/mkp-dom.js';

export function MkpView(props: { bundle: IRBundle; theme?: 'light' | 'dark' | 'auto'; onSignal?: (e: SignalEvent) => void }) {
  let el!: HTMLDivElement;
  onMount(() => {
    const view = mount(el, props.bundle, { theme: props.theme, onSignal: (e) => props.onSignal?.(e) });
    // a new theme keeps the reader's place; a new bundle starts the document again
    createEffect(on(() => props.theme, (theme) => view.update({ theme }), { defer: true }));
    createEffect(on(() => props.bundle, (bundle) => view.setBundle(bundle), { defer: true }));
    onCleanup(() => view.unmount());
  });
  return <div ref={el} />;
}
```

## Angular

<!-- recipe angular/src/mkp-view.ts -->
```ts
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
```

Used as `<mkp-view [bundle]="bundle" [theme]="theme()" (signal)="onSignal($event)" />`. The app
loads `.md` files as text with `"loader": { ".md": "text" }` in `angular.json`.

## Astro

The document is compiled when the site is built; the page carries its bundle and draws it in the
browser. Signals arrive as `mkp-signal` events.

<!-- recipe astro/src/components/MkpView.astro -->
```astro
---
// MkpView: an MKP document on an Astro page. Copy this file; it needs the release's web files in
// src/vendor/mkp. The document is compiled when the site is built, so the page ships its bundle and
// no compiler; the browser only draws it. Listen for its signals with `mkp-signal` events.
import { compile } from '../vendor/mkp/mkp.js';

interface Props {
  source: string;
  file?: string;
  theme?: 'light' | 'dark' | 'auto';
}
const { source, file = 'doc.mkp.md', theme = 'auto' } = Astro.props;
const c = compile({ packs: [] });
const bundle = c.document(source, file);
if (!bundle) throw new Error(`${file} has errors:\n${c.diags.errors.map((d) => d.message).join('\n')}`);
---

<mkp-view data-bundle={JSON.stringify(bundle)} data-theme={theme}></mkp-view>

<script>
  import { mount, type MountedDocument } from '../vendor/mkp/mkp-dom.js';

  // <mkp-view>: draws its bundle; set its data-theme to change the theme (the reader's place stays);
  // each signal is a bubbling `mkp-signal` event whose detail is the signal
  class MkpView extends HTMLElement {
    static observedAttributes = ['data-theme'];
    view: MountedDocument | null = null;
    connectedCallback() {
      this.view = mount(this, JSON.parse(this.dataset.bundle!), {
        theme: this.theme,
        onSignal: (e) => this.dispatchEvent(new CustomEvent('mkp-signal', { detail: e, bubbles: true })),
      });
    }
    attributeChangedCallback() {
      this.view?.update({ theme: this.theme });
    }
    disconnectedCallback() {
      this.view?.unmount();
      this.view = null;
    }
    get theme() {
      return (this.dataset.theme ?? 'auto') as 'light' | 'dark' | 'auto';
    }
  }
  customElements.define('mkp-view', MkpView);
</script>
```

Used as `<MkpView source={source} file="lesson.mkp.md" />`, with
`import source from '../lesson.mkp.md?raw'`.

## No framework

No build step: the web files are modules, served as they are. Any static server works; pages opened
from `file://` cannot load modules.

<!-- recipe plain/main.js -->
```js
// MKP in a page with no framework and no build step. Serve this folder with the release's web files
// in ./vendor/mkp, from any static server (modules do not load from file://).
import { compile } from './vendor/mkp/mkp.js';
import { mount } from './vendor/mkp/mkp-dom.js';

const source = await (await fetch('./lesson.mkp.md')).text();
const bundle = compile({ packs: [] }).document(source, 'lesson.mkp.md');
const el = document.getElementById('doc');
const said = document.querySelector('[data-said]');
let dark = false;

const options = () => ({
  theme: dark ? 'dark' : 'light',
  onSignal: (e) => (said.textContent = `${e.name}: ${e.payload.value} (${e.payload.correct ? 'right' : 'wrong'})`),
});
let view = mount(el, bundle, options());

// a new theme keeps the reader's place
document.getElementById('theme').onclick = (e) => {
  dark = !dark;
  e.target.textContent = dark ? 'Light' : 'Dark';
  view?.update({ theme: dark ? 'dark' : 'light' });
};
// unmount() removes the document; mounting again starts it afresh
document.getElementById('shown').onclick = (e) => {
  if (view) (view.unmount(), (view = null));
  else view = mount(el, bundle, options());
  e.target.textContent = view ? 'Hide' : 'Show';
};
```

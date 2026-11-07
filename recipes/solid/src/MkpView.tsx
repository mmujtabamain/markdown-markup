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

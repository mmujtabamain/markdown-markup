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

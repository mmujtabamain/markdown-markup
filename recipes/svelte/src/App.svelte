<script lang="ts">
  import MkpView from './MkpView.svelte';
  import { compile, type SignalEvent } from './vendor/mkp/mkp.js';
  import source from './lesson.mkp.md?raw';

  const bundle = compile({ packs: [] }).document(source, 'lesson.mkp.md')!;
  let dark = $state(false);
  let shown = $state(true);
  let said = $state('');
  const onsignal = (e: SignalEvent) => {
    const p = e.payload as { value: string; correct: boolean };
    said = `${e.name}: ${p.value} (${p.correct ? 'right' : 'wrong'})`;
  };
</script>

<header>
  <h2>MKP in Svelte</h2>
  <button onclick={() => (dark = !dark)}>{dark ? 'Light' : 'Dark'}</button>
  <button onclick={() => (shown = !shown)}>{shown ? 'Hide' : 'Show'}</button>
  <output data-said>{said}</output>
</header>
{#if shown}
  <MkpView {bundle} theme={dark ? 'dark' : 'light'} {onsignal} />
{/if}

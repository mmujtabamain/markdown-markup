<!-- The test app: <MkpPage> in Svelte 5, with the controls the shared steps use (testing/browser.mjs). -->
<script>
  import { MkpPage } from "@mkp/svelte";

  const heard = { calls: [], states: [], outcomes: [], mounts: 0 };
  let which = $state("v1");
  let theme = $state("LIGHT");
  let unit = $state("items");
  let shown = $state(true);
  let view = $state();

  window.__test = {
    heard,
    handle: () => view.handle(),
    setTheme: (t) => (theme = t),
    setIr: (w) => (which = w),
    setUnit: (u) => (unit = u),
    unmount: () => (shown = false),
  };
</script>

{#if shown}
  <MkpPage
    bind:this={view}
    ir={window.__IR[which]}
    page={{ theme }}
    externs={{ app: { unit: { text: unit } } }}
    onCalls={(calls) => heard.calls.push(calls)}
    onState={(state) => heard.states.push(state)}
    onOutcome={(outcome) => heard.outcomes.push(outcome)}
    onMount={() => heard.mounts++}
  />
{/if}

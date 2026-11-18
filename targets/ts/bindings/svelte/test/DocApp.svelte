<!-- The test app for <MkpDoc>: drawn by Svelte itself, $state controlled by the app, with the controls the shared doc steps use (testing/browser.mjs, docSteps). -->
<script>
  import { MkpDoc } from "@mkp/svelte";

  const heard = { states: [], errors: [], calls: [] };
  let which = $state("v1");
  let theme = $state("LIGHT");
  let unit = $state("items");
  let docState = $state.raw(undefined);
  let shown = $state(true);
  let view = $state();

  window.__test = {
    heard,
    handle: () => ({
      set: (c) => view.set(c),
      state: () => view.getState(),
      markdown: () => view.markdown(),
      expose: (c, n, ...a) => view.expose(c, n, ...a),
      snapshot: () => view.snapshot(),
      restore: (s) => view.restore(s),
    }),
    setState: (s) => (docState = s),
    setTheme: (t) => (theme = t),
    setIr: (w) => (which = w),
    setUnit: (u) => (unit = u),
    unmount: () => (shown = false),
  };
</script>

{#if shown}
  <MkpDoc
    bind:this={view}
    ir={window.__IR[which]}
    state={docState}
    page={{ theme }}
    externs={{ app: { unit: { text: unit } } }}
    onStateChange={(s) => {
      heard.states.push(s);
      docState = s;
    }}
    onError={(e) => heard.errors.push(e)}
    onCalls={(c) => heard.calls.push(c)}
  />
{/if}

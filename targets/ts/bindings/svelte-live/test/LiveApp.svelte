<!-- The test app for <MkpLiveDoc>: its text compiled in the tab, with the controls the shared live steps use (testing/browser.mjs, liveSteps). -->
<script>
  import { MkpLiveDoc } from "@mkp/svelte-live";

  const heard = { states: [], errors: [], calls: [] };
  let source = $state(window.__SRC.v1);
  let view = $state();
  const externs = { app: { unit: { text: "items" } } };

  window.__test = {
    heard,
    handle: () => ({
      set: (c) => view.set(c),
      state: () => view.getState(),
      markdown: () => view.markdown(),
    }),
    setSource: (s) => (source = s),
  };
</script>

<MkpLiveDoc
  bind:this={view}
  {source}
  wasm={window.__WASM_URL}
  {externs}
  onStateChange={(s) => heard.states.push(s)}
  onError={(e) => heard.errors.push(e)}
  onCalls={(c) => heard.calls.push(c)}
/>

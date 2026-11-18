// The rows, then each framework's bundle, which mounts into its own row.
const FRAMEWORKS = [["react", "React"], ["vue", "Vue"], ["svelte", "Svelte"], ["solid", "Solid"], ["angular", "Angular"]];
const rows = document.getElementById("rows");
for (const [id, name] of FRAMEWORKS) {
  const row = document.createElement("section");
  row.className = "fw";
  row.dataset.testid = id;
  row.innerHTML = `<h2>${name}</h2>
    <div class="pane"><div class="kind">Run time <code>@mkp/${id}</code></div><div class="page" id="${id}-run" data-testid="${id}-run"></div><div class="state" id="${id}-run-state" data-testid="${id}-run-state"></div></div>
    <div class="pane"><div class="kind">Real time <code>@mkp/${id}-live</code></div><textarea id="${id}-source" data-testid="${id}-source" spellcheck="false"></textarea><div class="status" id="${id}-status" data-testid="${id}-status" data-state="loading">Loading the compiler…</div><div class="page" id="${id}-live" data-testid="${id}-live"></div></div>`;
  rows.append(row);
}
window.__showcase = { ir: null, source: "" };
Promise.all([fetch("/counter.ir.json").then((r) => r.json()), fetch("/counter.mkp.md").then((r) => r.text())]).then(([ir, source]) => {
  window.__showcase = { ir, source, wasm: "/mkp.wasm" };
  for (const [id] of FRAMEWORKS) {
    document.getElementById(`${id}-source`).value = source;
    const s = document.createElement("script");
    s.src = `/${id}.js`;
    document.body.append(s);
  }
});

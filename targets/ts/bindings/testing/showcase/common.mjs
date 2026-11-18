// What every framework's row shares: the page's IR and text, `$state` as a line, the status line,
// and an edit handed over 150 ms after the reader stops typing.
export const S = window.__showcase;

export function line(s) {
  return Object.entries(s ?? {}).map(([k, x]) => `${k} = ${"num" in x ? x.num : JSON.stringify(x)}`).join(", ");
}

export function showState(id, s) {
  document.getElementById(`${id}-run-state`).textContent = `$state: ${line(s)}`;
}

export function status(id, state, text) {
  const el = document.getElementById(`${id}-status`);
  el.dataset.state = state;
  el.textContent = text;
}

export function failed(id) {
  return (e) => status(id, "errors", e.kind === "compile" ? e.message.replace(/^page\.mkp\.md doesn't compile/, "Doesn't compile") : (e.message ?? e.kind));
}

export function onEdit(id, f) {
  let timer;
  document.getElementById(`${id}-source`).addEventListener("input", (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      status(id, "pending", "Compiling…");
      f(e.target.value);
    }, 150);
  });
}

/** A document's new page is a text that compiled: the status says so. */
export function compiled(id, doc) {
  let shown = doc.running;
  if (shown) status(id, "ok", "Compiled in the browser");
  return doc.subscribe(() => {
    if (doc.running && doc.running !== shown) {
      shown = doc.running;
      status(id, "ok", "Compiled in the browser");
    }
  });
}

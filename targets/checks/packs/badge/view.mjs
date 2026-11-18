// The badge pack's externs for the targets drawn from @mkp/view (React, Vue, Svelte, Solid,
// Angular): a widget as an element, as a pack ships one per target it supports.

function text(v) {
  return v?.kind === "text" ? v.s : v?.kind === "num" ? v.n.show() : "";
}

export default {
  /** A count with its label: one status element. */
  "badge/badge": (d) => ({
    tag: "span",
    attrs: { class: "badge-pack", role: "status", "data-part": "badge" },
    style: { display: "inline-block", padding: "2px 8px", "border-radius": "999px", border: "1px solid currentColor" },
    children: [`${text(d.props.get("label"))}: ${text(d.props.get("count"))}`],
  }),
};

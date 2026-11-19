// The badge pack's externs for the web target: a widget for @extended-mark/dom's registry, as a pack ships
// one per target it supports (plan tab 7: `import maps from "@acme/maps/web"`).

function text(v) {
  return v?.kind === "text" ? v.s : v?.kind === "num" ? v.n.show() : "";
}

export default {
  /** A count with its label: one status element, its text following the page. */
  "badge/badge": (d) => {
    const el = document.createElement("span");
    el.className = "badge-pack";
    el.setAttribute("role", "status");
    el.setAttribute("data-part", "badge");
    el.style.cssText = "display:inline-block;padding:2px 8px;border-radius:999px;border:1px solid currentColor";
    const show = (d) => {
      el.textContent = `${text(d.props.get("label"))}: ${text(d.props.get("count"))}`;
    };
    show(d);
    return { el, update: show };
  },
};

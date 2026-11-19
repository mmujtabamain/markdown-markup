// The plain web's XtmdDoc taking over a page a server rendered: the element holds @extended-mark/view's HTML
// of the same page, and XtmdDoc draws the page in its place.
import { XtmdDoc } from "@extended-mark/embed";

const root = document.getElementById("app");
window.__server = root.innerHTML;
const doc = new XtmdDoc(root, { ir: window.__IR.v1, defaultState: { n: { num: "2" } }, externs: { app: { unit: { text: "items" } } } });
window.__test = { doc };

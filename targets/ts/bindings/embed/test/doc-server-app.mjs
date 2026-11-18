// The plain web's MkpDoc taking over a page a server rendered: the element holds @mkp/view's HTML
// of the same page, and MkpDoc draws the page in its place.
import { MkpDoc } from "@mkp/embed";

const root = document.getElementById("app");
window.__server = root.innerHTML;
const doc = new MkpDoc(root, { ir: window.__IR.v1, defaultState: { n: { num: "2" } }, externs: { app: { unit: { text: "items" } } } });
window.__test = { doc };

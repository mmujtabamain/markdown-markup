// The plain web's XtmdDoc from a URL: one that loads, one that doesn't.
import { XtmdDoc } from "@extended-mark/embed";

window.__errors = [];
new XtmdDoc(document.getElementById("ok"), { src: "http://xtmd.test/page.ir.json" });
new XtmdDoc(document.getElementById("missing"), { src: "http://xtmd.test/missing.ir.json", onError: (e) => window.__errors.push(e) });

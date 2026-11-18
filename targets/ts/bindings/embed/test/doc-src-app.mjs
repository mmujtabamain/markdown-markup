// The plain web's MkpDoc from a URL: one that loads, one that doesn't.
import { MkpDoc } from "@mkp/embed";

window.__errors = [];
new MkpDoc(document.getElementById("ok"), { src: "http://mkp.test/page.ir.json" });
new MkpDoc(document.getElementById("missing"), { src: "http://mkp.test/missing.ir.json", onError: (e) => window.__errors.push(e) });

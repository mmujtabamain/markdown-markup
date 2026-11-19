// The plain web's check harness: each case's document is an XtmdDoc (@extended-mark/embed), drawn by
// @extended-mark/dom from the case's IR, as an app draws one it is given (testing/dom_harness.mjs).

import { XtmdDoc } from "../dist/index.js";
import { install } from "../../testing/dom_harness.mjs";

install((root, { source: _, ...props }) => new XtmdDoc(root, props));

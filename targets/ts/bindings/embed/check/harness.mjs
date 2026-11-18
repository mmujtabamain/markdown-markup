// The plain web's check harness: each case's document is an MkpDoc (@mkp/embed), drawn by
// @mkp/dom from the case's IR, as an app draws one it is given (testing/dom_harness.mjs).

import { MkpDoc } from "../dist/index.js";
import { install } from "../../testing/dom_harness.mjs";

install((root, { source: _, ...props }) => new MkpDoc(root, props));

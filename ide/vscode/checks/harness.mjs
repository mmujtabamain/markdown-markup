// The vscode target's page for `xtmd target check`: the web target's harness, drawing with this
// target's widgets.
import { widgets } from "../src/target/widgets.ts";

window.xtmdWidgets = widgets;
// read at each mount, after this has run
import "../../../targets/ts/web/harness.mjs";

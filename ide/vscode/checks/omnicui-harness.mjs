// The vscode target's page for omnicui's widget contracts: the web target's omnicui harness,
// drawing with this target's widgets.
import { widgets } from "../src/target/widgets.ts";

window.xtmdWidgets = widgets;
// read at each mount, after this has run
import "../../../targets/ts/web/omnicui/harness.mjs";

//! An observation, as the check protocol has it (plan tab 16; schemas' `Observation`): the same
//! JSON the test target's and the native target's adapters send, so `xtmd target check` compares
//! the Android target with them byte for byte.

use std::collections::HashSet;

use xtmd_runtime::layout::region_of;
use xtmd_runtime::{Drawn, Num, Page};
use serde_json::{json, Map, Value as Json};

use crate::{failed, XtmdError};

/// Where each spot landed, by its path.
fn boxes(nodes: &[Drawn], out: &mut Map<String, Json>) {
    for n in nodes {
        if n.widget == "core/spot" {
            if let Some(r) = region_of(n.props.get("box")) {
                let num = |x: Num| json!({ "num": x.show() });
                out.insert(n.path.clone(), json!({ "from": { "x": num(r.from.x), "y": num(r.from.y) }, "to": { "x": num(r.to.x), "y": num(r.to.y) } }));
            }
        }
        for kids in n.slots.values() {
            boxes(kids, out);
        }
    }
}

fn to_json<T: serde::Serialize>(x: &T) -> Result<Json, XtmdError> {
    serde_json::to_value(x).map_err(|e| failed(e.to_string()))
}

/// Everything Extended Mark decides about the page after a step. With `drawn`, the tree holds only the
/// widgets the target drew: the observed tree is what is on the screen.
pub fn observe(page: &mut Page, drawn: Option<Vec<String>>) -> Result<String, XtmdError> {
    let drawn: Option<HashSet<String>> = drawn.map(|d| d.into_iter().collect());
    let mut tree = page.observe_tree();
    if let Some(d) = &drawn {
        tree.retain(|path, _| d.contains(path));
    }
    let mut found = Map::new();
    boxes(page.tree(), &mut found);
    let state = to_json(&page.observe_state())?;
    let calls = to_json(&page.take_calls())?;
    let outcome = page.take_outcome();
    let markdown = page.markdown()?;
    let mut o = json!({
        "tree": to_json(&tree)?,
        "state": state,
        "calls": calls,
        "outcome": { "refused": to_json(&outcome.refused)?, "failures": to_json(&outcome.failures)? },
        "markdown": markdown,
    });
    if !found.is_empty() {
        o["boxes"] = Json::Object(found);
    }
    // a shade's fn and arguments; the colour samples are the test target's own
    let shaded = page.observe_shaded(false)?;
    if !shaded.is_empty() {
        let mut s = Map::new();
        for (path, sh) in shaded {
            s.insert(path, json!({ "shader": sh.shader, "args": to_json(&sh.args)? }));
        }
        o["shaded"] = Json::Object(s);
    }
    serde_json::to_string(&o).map_err(|e| failed(e.to_string()))
}

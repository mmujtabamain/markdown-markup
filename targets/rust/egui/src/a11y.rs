//! What a screen reader gets, through egui's AccessKit tree: each drawn widget's root is a node
//! with its role and name, and its parts are nodes too. Each one carries an author id, which is
//! how the check adapters find a widget and its parts, as the web finds `data-xtmd-site` and
//! `data-part`:
//!
//! - a widget's root: `<short name>@<path>` (`press@s0/s0`);
//! - one of its parts: `<short name>.<part>` (`slider.input`), as @extended-mark/dom's `data-part`.
//!
//! Bounds are set on every node we make, in screen coordinates: egui sets them only on widgets
//! that report their info, and leaves a transformed layer's (the plane's) in the layer's own.

use egui::accesskit::{self, Role};
use egui::{Id, Rect, Sense, Ui};

/// A node's bounds, from a rect in the ui's layer, turned into screen coordinates.
pub fn bounds(ui: &Ui, id: Id, rect: Rect) {
    let rect = match ui.ctx().layer_transform_to_global(ui.layer_id()) {
        Some(t) => t * rect,
        None => rect,
    };
    ui.ctx().accesskit_node_builder(id, |n| {
        n.set_bounds(accesskit::Rect { x0: rect.min.x.into(), y0: rect.min.y.into(), x1: rect.max.x.into(), y1: rect.max.y.into() });
    });
}

/// Edits a node: the ui's own, or a widget's in it.
pub fn edit(ui: &Ui, id: Id, f: impl FnOnce(&mut accesskit::Node)) {
    ui.ctx().accesskit_node_builder(id, f);
}

/// A node of its own for a part with no widget of egui's: a rect in the ui, registered as a
/// hover-only widget (so it takes no clicks from what is under it), with its role.
pub fn node(ui: &mut Ui, id: Id, rect: Rect, role: Role) -> egui::Response {
    let r = ui.interact(rect, id, Sense::hover());
    edit(ui, id, |n| n.set_role(role));
    bounds(ui, id, rect);
    r
}

/// Names a node as a part.
pub fn part(ui: &Ui, id: Id, name: &str) {
    edit(ui, id, |n| n.set_author_id(name.to_string()));
}

/// The author id of a widget's root.
pub fn root_id(widget: &str, path: &str) -> String {
    format!("{}@{}", short(widget), path)
}

/// A widget's short name: `core/press` is `press`, `#notice` is `notice`.
pub fn short(widget: &str) -> &str {
    let w = widget.rsplit('/').next().unwrap_or(widget);
    w.trim_start_matches('#')
}

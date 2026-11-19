//! Our default egui widgets, by full name: every core extern, and the runtime's notice. An app's
//! own, given to [`crate::XtmdPage::widget`], replace them by name.
//!
//! Each draws the way egui draws, with the roles, names and states a screen reader needs in
//! egui's AccessKit tree, the keyboard egui gives focusable widgets (Enter and Space press, the
//! arrows move a slider), and writes through checked [`crate::Ctx::write`]s.

pub mod blocks;
pub mod controls;
pub mod gfx;
pub mod kit;
pub mod layout;
pub mod notice;
pub mod plane;

use crate::{Ctx, Props, Registry};

type Draw = fn(&mut egui::Ui, &Props<'_>, &mut Ctx<'_>);

fn stateless(r: &mut Registry, name: &str, f: Draw) {
    r.set(name, move || f);
}

/// Our widgets for every core extern widget, and `#notice`.
pub fn defaults() -> Registry {
    let mut r = Registry::empty();
    stateless(&mut r, "core/paragraph", blocks::paragraph);
    stateless(&mut r, "core/heading", blocks::heading);
    stateless(&mut r, "core/bullets", blocks::bullets);
    stateless(&mut r, "core/item", blocks::item);
    stateless(&mut r, "core/quote", blocks::quote);
    stateless(&mut r, "core/code", blocks::code);
    stateless(&mut r, "core/math", blocks::math);
    stateless(&mut r, "core/table", blocks::table);
    stateless(&mut r, "core/footnote", blocks::footnote);
    stateless(&mut r, "core/divider", blocks::divider);
    stateless(&mut r, "core/label", controls::label);
    stateless(&mut r, "core/image", controls::image);
    stateless(&mut r, "core/icon", controls::icon);
    stateless(&mut r, "core/press", controls::press);
    r.set("core/field", controls::Field::default);
    r.set("core/slider", controls::Slider::default);
    r.set("core/overlay", controls::Overlay::default);
    stateless(&mut r, "core/flex", layout::flex);
    r.set("core/grid", layout::Grid::default);
    stateless(&mut r, "core/cell", layout::cell);
    stateless(&mut r, "core/sizing", layout::sizing);
    stateless(&mut r, "core/canvas", gfx::canvas);
    stateless(&mut r, "core/layer", gfx::layer);
    r.set("core/circle", gfx::Shape::default);
    r.set("core/path", gfx::Shape::default);
    r.set("core/place", gfx::Place::default);
    r.set("core/handle", gfx::Handle::default);
    r.set("core/shade", gfx::Shade::default);
    r.set("core/plane", plane::Plane::default);
    r.set("core/spot", plane::Spot::default);
    stateless(&mut r, "#notice", notice::widget);
    r
}

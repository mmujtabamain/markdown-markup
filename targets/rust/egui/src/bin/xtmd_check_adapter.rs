//! The egui target's check adapter: `xtmd target check egui`. Each case's document is an
//! [`xtmd_egui::doc::XtmdDoc`] made from the case's IR, as an app makes one from the IR it is given,
//! driven by [`xtmd_egui::check::adapter`].

use xtmd_egui::check::adapter::{serve, Target};
use xtmd_egui::doc::XtmdDoc;

fn main() {
    serve(Target { name: "egui", load: Box::new(|l| XtmdDoc::from_json(&l.ir, l.options).map_err(|e| e.to_string())) });
}

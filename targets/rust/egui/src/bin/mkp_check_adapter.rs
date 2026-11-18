//! The egui target's check adapter: `mkp target check egui`. Each case's document is an
//! [`mkp_egui::doc::MkpDoc`] made from the case's IR, as an app makes one from the IR it is given,
//! driven by [`mkp_egui::check::adapter`].

use mkp_egui::check::adapter::{serve, Target};
use mkp_egui::doc::MkpDoc;

fn main() {
    serve(Target { name: "egui", load: Box::new(|l| MkpDoc::from_json(&l.ir, l.options).map_err(|e| e.to_string())) });
}

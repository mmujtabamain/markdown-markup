//! The egui-live target's check adapter: `xtmd target check egui-live`. Each case's document is an
//! [`xtmd_egui_live::XtmdLiveDoc`] made from the case's own text and its packs' files, compiled in
//! the app, then driven as egui's are ([`xtmd_egui::check::adapter`]).

use xtmd_egui::check::adapter::{serve, Target};
use xtmd_egui_live::{compiler, XtmdLiveDoc, Source};

fn main() {
    serve(Target {
        name: "egui-live",
        load: Box::new(|l| {
            let source = l.source.ok_or("load gives the case's source: this target compiles it")?;
            let packs = l.packs.into_iter().map(|f| Source { path: f.path, text: f.text }).collect();
            let doc = XtmdLiveDoc::with(compiler(), &source.path, packs, &source.text, l.options);
            match doc.doc() {
                Some(_) => Ok(doc),
                None => Err(doc.why().unwrap_or_else(|| "the case didn't compile".into())),
            }
        }),
    });
}

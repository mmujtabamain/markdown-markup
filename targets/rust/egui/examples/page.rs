//! A window showing a page, drawn with mkp-egui.
//!
//!   cargo run -p mkp-egui --example page --features app                       # the demo page
//!   cargo run -p mkp-egui --example page --features app -- page.ir.json      # what `mkp build` wrote
//!   cargo run -p mkp-egui --example page --features app -- doc.mkp.md [pack…] # compiled here
//!
//! The page's Markdown is printed when the window closes, with the values it has then
//! ([`mkp_egui::run_window`]).

use std::path::{Path, PathBuf};

use mkp_egui::runtime::{ir, Page};
use mkp_egui::MkpPage;

/// The repository's core, compiled with the compiler's own crates (as `mkp build` does).
fn compile(doc: &str, packs: &[PathBuf]) -> Result<ir::File, String> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let read = |dir: &Path| -> Vec<mkp_check::Source> {
        let mut files: Vec<PathBuf> = std::fs::read_dir(dir).map(|d| d.filter_map(|e| e.ok().map(|e| e.path())).collect()).unwrap_or_default();
        files.retain(|p| p.extension().is_some_and(|x| x == "mkp"));
        files.sort();
        files.into_iter().map(|p| mkp_check::Source { path: p.to_string_lossy().into_owned(), text: std::fs::read_to_string(&p).unwrap_or_default() }).collect()
    };
    let packs: Vec<Vec<mkp_check::Source>> = packs.iter().map(|p| read(p)).collect();
    let c = mkp_check::compile(&read(&root.join("core")), &packs, &[mkp_check::Source { path: "page.mkp.md".into(), text: doc.into() }], "doc");
    let errors = format!("the page doesn't compile: {:?}", c.errors().collect::<Vec<_>>());
    let mut m = c.module.ok_or(errors)?;
    mkp_lower::lower(&mut m);
    Ok(ir::File { ir: m })
}

fn main() -> eframe::Result {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let page = match args.first() {
        Some(p) if p.ends_with(".json") => Page::from_json(&std::fs::read_to_string(p).expect("read the IR"), MkpPage::options()),
        Some(p) => Page::new(compile(&std::fs::read_to_string(p).expect("read the page"), &args[1..].iter().map(PathBuf::from).collect::<Vec<_>>()).expect("compile"), MkpPage::options()),
        None => Page::new(compile(include_str!("demo.mkp.md"), &[]).expect("compile the demo"), MkpPage::options()),
    }
    .expect("mount the page");
    let page = MkpPage::new(page);
    for m in page.page().missing() {
        eprintln!("nothing draws {} here: it shows its Markdown", m);
    }
    mkp_egui::run_window("MKP page", page)
}

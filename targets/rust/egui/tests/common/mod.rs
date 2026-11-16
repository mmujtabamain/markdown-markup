//! Pages for the tests, compiled in the test with the compiler's crates and core's sources from the
//! repository, then drawn headless.

#![allow(dead_code)]

use std::path::{Path, PathBuf};

use mkp_egui::check::Headless;
use mkp_egui::measure::Fixed;
use mkp_egui::runtime::{Page, PageOptions};
use mkp_egui::MkpPage;

pub fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).ancestors().nth(3).unwrap().to_path_buf()
}

fn sources(dir: &Path) -> Vec<mkp_check::Source> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir).unwrap().filter_map(|e| e.ok().map(|e| e.path())).filter(|p| p.extension().is_some_and(|x| x == "mkp")).collect();
    files.sort();
    files.into_iter().map(|p| mkp_check::Source { path: p.to_string_lossy().into_owned(), text: std::fs::read_to_string(&p).unwrap() }).collect()
}

thread_local! {
    /// Core, compiled once for every test on a thread.
    static CORE: mkp_check::Checker = mkp_check::compile_core(&sources(&repo().join("core")));
}

/// A document's IR, with the packs in some folders of the repository.
pub fn ir(doc: &str, packs: &[&str]) -> mkp_egui::runtime::ir::File {
    let packs: Vec<Vec<mkp_check::Source>> = packs.iter().map(|p| sources(&repo().join(p))).collect();
    let c = CORE.with(|core| mkp_check::compile_on(core, &packs, &[mkp_check::Source { path: "test.mkp.md".into(), text: doc.into() }], "doc"));
    let Some(mut m) = c.module else {
        let errors: Vec<String> = c.errors().map(|e| format!("{:?}", e)).collect();
        panic!("the page doesn't compile: {}", errors.join("\n"));
    };
    mkp_lower::lower(&mut m);
    mkp_egui::runtime::ir::File { ir: m }
}

/// A page, drawn headless with our widgets and the checks' sizes, settled.
pub fn mount(doc: &str) -> Headless {
    mount_with(doc, &[])
}

pub fn mount_with(doc: &str, packs: &[&str]) -> Headless {
    let page = Page::new(ir(doc, packs), PageOptions { fns: mkp_egui::fns::check_fns(), ..PageOptions::default() }).unwrap();
    let mut h = Headless::new(MkpPage::new(page).with_measure(Box::new(Fixed)).follow_theme(false), egui::vec2(800.0, 800.0), false);
    h.settle().unwrap();
    h
}

/// A page drawn with what egui measures, as an app draws it.
pub fn mount_measured(doc: &str, packs: &[&str]) -> Headless {
    let page = Page::new(ir(doc, packs), MkpPage::options()).unwrap();
    let mut h = Headless::new(MkpPage::new(page), egui::vec2(800.0, 800.0), false);
    h.settle().unwrap();
    h
}

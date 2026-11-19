//! Pages for the tests, compiled in the test with the compiler's crates and core's sources from the
//! repository, then drawn headless.

#![allow(dead_code)]

use std::path::{Path, PathBuf};

use xtmd_egui::check::Headless;
use xtmd_egui::measure::Fixed;
use xtmd_egui::runtime::{Page, PageOptions};
use xtmd_egui::XtmdPage;

pub fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).ancestors().nth(3).unwrap().to_path_buf()
}

fn sources(dir: &Path) -> Vec<xtmd_check::Source> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir).unwrap().filter_map(|e| e.ok().map(|e| e.path())).filter(|p| p.extension().is_some_and(|x| x == "xtpack")).collect();
    files.sort();
    files.into_iter().map(|p| xtmd_check::Source { path: p.to_string_lossy().into_owned(), text: std::fs::read_to_string(&p).unwrap() }).collect()
}

thread_local! {
    /// Core, compiled once for every test on a thread.
    static CORE: xtmd_check::Checker = xtmd_check::compile_core(&sources(&repo().join("core")));
}

/// A document's IR, with the packs in some folders of the repository.
pub fn ir(doc: &str, packs: &[&str]) -> xtmd_egui::runtime::ir::File {
    let packs: Vec<Vec<xtmd_check::Source>> = packs.iter().map(|p| sources(&repo().join(p))).collect();
    let c = CORE.with(|core| xtmd_check::compile_on(core, &packs, &[xtmd_check::Source { path: "test.xt.md".into(), text: doc.into() }], "doc"));
    let Some(mut m) = c.module else {
        let errors: Vec<String> = c.errors().map(|e| format!("{:?}", e)).collect();
        panic!("the page doesn't compile: {}", errors.join("\n"));
    };
    xtmd_lower::lower(&mut m);
    xtmd_egui::runtime::ir::File { ir: m }
}

/// A page, drawn headless with our widgets and the checks' sizes, settled.
pub fn mount(doc: &str) -> Headless {
    mount_with(doc, &[])
}

pub fn mount_with(doc: &str, packs: &[&str]) -> Headless {
    let page = Page::new(ir(doc, packs), PageOptions { fns: xtmd_egui::fns::check_fns(), ..PageOptions::default() }).unwrap();
    let mut h = Headless::new(XtmdPage::new(page).with_measure(Box::new(Fixed)).follow_theme(false), egui::vec2(800.0, 800.0), false);
    h.settle().unwrap();
    h
}

/// A page drawn with what egui measures, as an app draws it.
pub fn mount_measured(doc: &str, packs: &[&str]) -> Headless {
    let page = Page::new(ir(doc, packs), XtmdPage::options()).unwrap();
    let mut h = Headless::new(XtmdPage::new(page), egui::vec2(800.0, 800.0), false);
    h.settle().unwrap();
    h
}

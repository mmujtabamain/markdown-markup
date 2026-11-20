//! Test helpers: pages compiled by the compiler in-process, as `xtmd build` compiles them.

#![allow(dead_code)]

use std::path::PathBuf;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Mutex, OnceLock};

use xtmd_check::Source;
use xtmd_runtime::ir::{self, Expr};
use xtmd_runtime::{Num, Page, PageOptions, Value};

pub fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

fn core_sources() -> Vec<Source> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(repo().join("core")).unwrap().map(|e| e.unwrap().path()).filter(|p| p.extension().map_or(false, |x| x == "xtmdpack")).collect();
    files.sort();
    files.into_iter().map(|p| Source { path: format!("core/{}", p.file_name().unwrap().to_str().unwrap()), text: std::fs::read_to_string(&p).unwrap() }).collect()
}

/// A request to the compiler's thread: a document's source and its packs' folders.
type Job = (String, Vec<PathBuf>, Sender<Result<ir::Module, String>>);

/// The compiler, on a thread of its own: core is compiled once for every test.
fn compiler() -> &'static Mutex<Sender<Job>> {
    static SERVER: OnceLock<Mutex<Sender<Job>>> = OnceLock::new();
    SERVER.get_or_init(|| {
        let (tx, rx) = channel::<Job>();
        std::thread::spawn(move || {
            let base = xtmd_check::compile_core(&core_sources());
            for (source, packs, reply) in rx {
                let mut pack_sources = Vec::new();
                for dir in packs {
                    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().path()).filter(|p| p.extension().map_or(false, |x| x == "xtmdpack")).collect();
                    files.sort();
                    pack_sources.push(files.into_iter().map(|f| Source { path: f.to_string_lossy().into_owned(), text: std::fs::read_to_string(&f).unwrap() }).collect());
                }
                let c = xtmd_check::compile_on(&base, &pack_sources, &[Source { path: "page.xtmd".into(), text: source }], "doc");
                let out = match c.module {
                    Some(mut m) => {
                        xtmd_lower::lower(&mut m);
                        Ok(m)
                    }
                    None => Err(c.errors().map(|d| d.diagnostic.render(&d.file, &c.texts[&d.file])).collect::<Vec<_>>().join("\n")),
                };
                let _ = reply.send(out);
            }
        });
        Mutex::new(tx)
    })
}

/// A document's IR module, compiled with these packs.
pub fn build_with(source: &str, packs: &[PathBuf]) -> ir::Module {
    let (tx, rx) = channel();
    compiler().lock().unwrap().send((source.to_string(), packs.to_vec(), tx)).unwrap();
    match rx.recv().unwrap() {
        Ok(m) => m,
        Err(e) => panic!("the page doesn't compile:\n{}", e),
    }
}

/// A document, mounted.
pub fn page(source: &str) -> Page {
    page_with(source, PageOptions::default())
}

pub fn page_with(source: &str, opts: PageOptions) -> Page {
    Page::from_module(build_with(source, &[]), opts).expect("the page mounts")
}

pub fn num(s: &str) -> Expr {
    Expr::Num(s.to_string())
}

pub fn text(s: &str) -> Expr {
    Expr::Text(s.to_string())
}

pub fn n(s: &str) -> Num {
    Num::parse(s).unwrap()
}

pub fn v(p: &Page, x: Expr) -> Value {
    p.value(&x).unwrap()
}

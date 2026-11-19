//! How long one drag step takes on the native runtime, from the write to the page drawn and laid
//! out again: a canvas handle and a plane's pan, each with reuse on and off, alternating in one
//! run so a busy machine weighs on both alike. Prints the median ms per step, as
//! targets/ts/dom/test/drag-bench.mjs does for the web.
//!
//!   cargo run --release -p xtmd-runtime --example drag_bench -- targets/android/compose/sample/pages/tour.xt.md

use std::path::PathBuf;
use std::time::Instant;

use xtmd_check::Source;
use xtmd_runtime::ir::{Expr, ExprRecord};
use xtmd_runtime::{Drawn, Measure, Num, Page, PageOptions, Size};

struct Fixed;

impl Measure for Fixed {
    fn spot(&mut self, _page: &Page, _spot: &Drawn) -> Size {
        Size { width: Num::int(80), height: Num::int(20) }
    }

    fn plane_width(&mut self, _page: &Page, _plane: &Drawn) -> Num {
        Num::int(640)
    }
}

fn core() -> Vec<Source> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../core");
    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().path()).filter(|p| p.extension().map_or(false, |x| x == "xtpack")).collect();
    files.sort();
    files.into_iter().map(|p| Source { path: format!("core/{}", p.file_name().unwrap().to_str().unwrap()), text: std::fs::read_to_string(&p).unwrap() }).collect()
}

fn find(nodes: &[Drawn], widget: &str) -> Option<String> {
    for n in nodes {
        if n.widget == widget {
            return Some(n.path.clone());
        }
        for kids in n.slots.values() {
            if let Some(p) = find(kids, widget) {
                return Some(p);
            }
        }
    }
    None
}

fn point(x: f64, y: f64) -> Expr {
    let n = |v: f64| Expr::Num(format!("{}", (v * 1000.0).round() / 1000.0));
    Expr::Record(ExprRecord { ty: "core/point".into(), fields: [("x".to_string(), n(x)), ("y".to_string(), n(y))].into_iter().collect() })
}

/// One drag: `steps` writes of `input` on the widget at `path`, each laid out; ms per step.
fn drag(page: &mut Page, path: &str, input: &str, steps: usize, at: impl Fn(usize) -> Expr) -> Vec<f64> {
    let mut out = Vec::new();
    for k in 1..=steps {
        let v = page.value(&at(k)).unwrap();
        let t = Instant::now();
        page.write(path, input, v).unwrap();
        page.layout(&mut Fixed).unwrap();
        out.push(t.elapsed().as_secs_f64() * 1000.0);
    }
    out
}

fn median(mut xs: Vec<f64>) -> f64 {
    xs.sort_by(|a, b| a.partial_cmp(b).unwrap());
    (xs[xs.len() / 2] * 1000.0).round() / 1000.0
}

fn main() {
    let file = std::env::args().nth(1).expect("a page: drag_bench <page.xt.md>");
    let text = std::fs::read_to_string(&file).unwrap();
    let base = xtmd_check::compile_core(&core());
    let c = xtmd_check::compile_on(&base, &[], &[Source { path: file.clone(), text }], "doc");
    let mut module = c.module.expect("the page compiles");
    xtmd_lower::lower(&mut module);
    let t = Instant::now();
    let mut page = Page::from_module(module, PageOptions::default()).unwrap();
    page.layout(&mut Fixed).unwrap();
    let mount = t.elapsed().as_secs_f64() * 1000.0;
    let handle = find(page.tree(), "core/handle").expect("a handle");
    let plane = find(page.tree(), "core/plane").expect("a plane");
    let (mut on_h, mut on_p, mut off_h, mut off_p) = (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    for _round in 0..6 {
        for on in [true, false] {
            page.set_memo(on);
            let h = drag(&mut page, &handle, "at", 20, |k| point(0.4 + 0.01 * (k % 20) as f64, 0.3 - 0.005 * (k % 20) as f64));
            let p = drag(&mut page, &plane, "center", 20, |k| point(2.0 * (k % 20) as f64, (k % 20) as f64));
            if on {
                on_h.extend(h);
                on_p.extend(p);
            } else {
                off_h.extend(h);
                off_p.extend(p);
            }
        }
    }
    let failures = page.take_outcome();
    assert!(failures.failures.is_empty() && failures.refused.is_empty(), "{:?}", failures);
    println!("{{\"mount_ms\":{:.1},\"on\":{{\"handle\":{},\"plane\":{}}},\"off\":{{\"handle\":{},\"plane\":{}}}}}", mount, median(on_h), median(on_p), median(off_h), median(off_p));
}

//! Levels (page 6): every call carries the levels it needs, and so do widgets and the page.

use xtmd_check::{compile_core, compile_on, Source};
use xtmd_ir::ir::{self, Level, Node};
use std::path::PathBuf;

fn core_sources() -> Vec<Source> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../../core");
    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().path()).filter(|p| p.extension().map_or(false, |x| x == "xtpack")).collect();
    files.sort();
    files.into_iter().map(|p| Source { path: format!("core/{}", p.file_name().unwrap().to_str().unwrap()), text: std::fs::read_to_string(&p).unwrap() }).collect()
}

const DOC: &str = r#"$state {
    volume: number = 5;
    clicks: int = 0;
}

widget counter() {
    mut n: int = 0;
    view {
        @label(value = "\{n}");
    }
}

widget quiet() {
    event pinged();
    view {
        @label(value = "quiet");
    }
}

widget buttons() {
    view {
        @press(label = "Count", click = fn() { $state.clicks = $state.clicks + 1; });
        @press(label = "Nothing", click = fn() { let x: number = 1; });
    }
}

widget holder() {
    view {
        @column {
            @counter;
        }
    }
}
@@@
# Levels

@label(value = "plain");
@counter;
@quiet;
@holder;
@slider(value = $state.volume, label = "Volume");
@buttons;
@canvas(label = "Dot") {
@layer {
@circle(at = point { x = 0, y = 0 }, r = 0.5);
}
}
"#;

fn calls(nodes: &[Node], out: &mut Vec<(String, Vec<Level>)>) {
    for n in nodes {
        match n {
            Node::Extern(e) => out.push((e.name.clone(), e.levels.clone())),
            Node::Use(u) => out.push((u.name.clone(), u.levels.clone())),
            _ => {}
        }
    }
}

#[test]
fn each_call_widget_and_page_carries_its_levels() {
    let base = compile_core(&core_sources());
    let c = compile_on(&base, &[], &[Source { path: "levels.xt.md".into(), text: DOC.into() }], "doc");
    let errors: Vec<String> = c.errors().map(|d| format!("{}: {}", d.file, d.diagnostic.message)).collect();
    assert!(errors.is_empty(), "{:?}", errors);
    let m = c.module.unwrap();
    let t = |name: &str| -> &ir::Template { m.templates.iter().find(|t| t.name == name).unwrap_or_else(|| panic!("no template {}", name)) };
    let (draw, live, gfx) = (Level::CoreDraw, Level::CoreLive, Level::CoreGfx);
    // a widget's own variables need core.live; an event declared and never set needs nothing
    assert_eq!(t("doc/counter").levels, vec![draw, live]);
    assert_eq!(t("doc/quiet").levels, vec![draw]);
    // placing a call that needs core.live needs it too
    assert_eq!(t("doc/holder").levels, vec![draw, live]);
    let mut found = Vec::new();
    calls(&t("doc").view, &mut found);
    let levels = |name: &str, k: usize| found.iter().filter(|(n, _)| n == name).nth(k).map(|(_, l)| l.clone()).unwrap_or_else(|| panic!("no call {} #{}", name, k));
    assert_eq!(levels("core/heading", 0), vec![draw]);
    assert_eq!(levels("core/label", 0), vec![draw]);
    assert_eq!(levels("doc/counter", 0), vec![draw, live]);
    assert_eq!(levels("doc/quiet", 0), vec![draw]);
    // a variable given to a mut input, a handler that changes something; one that changes nothing
    assert_eq!(levels("core/slider", 0), vec![draw, live]);
    let mut presses = Vec::new();
    calls(&t("doc/buttons").view, &mut presses);
    assert_eq!(presses.iter().map(|(_, l)| l.clone()).collect::<Vec<_>>(), vec![vec![draw, live], vec![draw]]);
    assert_eq!(levels("doc/buttons", 0), vec![draw, live]);
    // the canvas widgets need core.gfx, and the canvas holding them
    assert_eq!(levels("core/canvas", 0), vec![draw, gfx]);
    assert_eq!(m.levels, vec![draw, live, gfx]);
}

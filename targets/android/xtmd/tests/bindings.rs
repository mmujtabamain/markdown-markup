//! The bindings' interface, as Kotlin uses it: a page mounted from the IR the compiler writes, its
//! tree read as `Val`s, changes made with `Val`s and in the check protocol's JSON, and what the
//! target supplies (moment.local's zone, a slider's ends, a shade's pixels, the plane's measure).

use std::path::PathBuf;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex, OnceLock};

use xtmd_android::{Extent, Field, Measure, NativePage, Node, PageInit, Val, Zone};
use xtmd_check::Source;

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

/// A document's IR file, as `xtmd build` writes it: core is compiled once, on the compiler's own
/// thread (a checker holds values that stay on one thread).
fn build(source: &str) -> String {
    type Job = (String, Sender<Result<String, String>>);
    static SERVER: OnceLock<Mutex<Sender<Job>>> = OnceLock::new();
    let server = SERVER.get_or_init(|| {
        let (tx, rx) = channel::<Job>();
        std::thread::spawn(move || {
            let mut files: Vec<PathBuf> = std::fs::read_dir(repo().join("core")).unwrap().map(|e| e.unwrap().path()).filter(|p| p.extension().map_or(false, |x| x == "xtmdpack")).collect();
            files.sort();
            let sources: Vec<Source> = files.into_iter().map(|p| Source { path: format!("core/{}", p.file_name().unwrap().to_str().unwrap()), text: std::fs::read_to_string(&p).unwrap() }).collect();
            let base = xtmd_check::compile_core(&sources);
            for (source, reply) in rx {
                let c = xtmd_check::compile_on(&base, &[], &[Source { path: "page.xtmd".into(), text: source }], "doc");
                let out = match c.module {
                    Some(mut m) => {
                        xtmd_lower::lower(&mut m);
                        Ok(serde_json::to_string(&xtmd_ir::ir::File { ir: m }).unwrap())
                    }
                    None => Err(c.errors().map(|d| d.diagnostic.render(&d.file, &c.texts[&d.file])).collect::<Vec<_>>().join("\n")),
                };
                let _ = reply.send(out);
            }
        });
        Mutex::new(tx)
    });
    let (tx, rx) = channel();
    server.lock().unwrap().send((source.to_string(), tx)).unwrap();
    rx.recv().unwrap().unwrap_or_else(|e| panic!("the page doesn't compile:\n{}", e))
}

struct Utc;
impl Zone for Utc {
    fn offset_minutes(&self, _utc_minutes: i64) -> i32 {
        0
    }
}

struct East(i32);
impl Zone for East {
    fn offset_minutes(&self, _utc_minutes: i64) -> i32 {
        self.0
    }
}

fn page(source: &str) -> Arc<NativePage> {
    NativePage::new(build(source), PageInit::default(), Box::new(Utc)).unwrap()
}

fn find(nodes: &[Node], widget: &str) -> Option<Node> {
    for n in nodes {
        if n.widget == widget {
            return Some(n.clone());
        }
        for s in &n.slots {
            if let Some(f) = find(&s.nodes, widget) {
                return Some(f);
            }
        }
    }
    None
}

fn num(n: &str) -> Val {
    Val::Num { n: n.into() }
}

fn state(p: &NativePage, name: &str) -> Val {
    p.state(name.into()).unwrap().unwrap()
}

const COUNTER: &str = r#"$state {
    count: int 0..3 = 0;
}

widget sample() {
    view {
        @press(label = "Add", tone = color.ACCENT, click = fn() { $state.count = ($state.count + 1).clamp(0, 3); });
        @slider(value = $state.count, label = "Count");
    }
}
@@@
@sample;
"#;

#[test]
fn the_tree_reads_as_values_with_its_tokens() {
    let p = page(COUNTER);
    let press = find(&p.tree().unwrap(), "core/press").unwrap();
    assert_eq!(press.props["label"], Val::Text { s: "Add".into() });
    assert!(matches!(&press.props["kind"], Val::Case { ty, name, token, .. } if ty == "core/press_kind" && name == "BUTTON" && token.is_empty()));
    // a token case carries the build's value: a color_value with both themes
    match &press.props["tone"] {
        Val::Opt { value } => match &value[0] {
            Val::Case { name, token, .. } => {
                assert_eq!(name, "ACCENT");
                assert!(matches!(&token[0], Val::Record { ty, fields } if ty == "core/color_value" && fields[0].name == "light"));
            }
            other => panic!("tone is {:?}", other),
        },
        other => panic!("tone is {:?}", other),
    }
    assert_eq!(press.listens, vec!["click".to_string()]);
    let slider = find(&p.tree().unwrap(), "core/slider").unwrap();
    assert_eq!(slider.writes, vec!["value".to_string()]);
}

#[test]
fn an_event_is_one_change_and_redraws() {
    let p = page(COUNTER);
    let press = find(&p.tree().unwrap(), "core/press").unwrap();
    let (r, c) = (p.revision(), p.changes());
    p.event(press.path.clone(), "click".into(), vec![]).unwrap();
    assert_eq!(state(&p, "count"), num("1"));
    assert!(p.revision() > r);
    assert_eq!(p.changes(), c + 1);
    // the slider follows
    assert_eq!(find(&p.tree().unwrap(), "core/slider").unwrap().props["value"], num("1"));
}

#[test]
fn a_write_outside_the_contract_is_refused_and_observed() {
    let p = page(COUNTER);
    let slider = find(&p.tree().unwrap(), "core/slider").unwrap();
    p.write(slider.path.clone(), "value".into(), num("2")).unwrap();
    assert_eq!(state(&p, "count"), num("2"));
    p.write(slider.path.clone(), "value".into(), num("7")).unwrap();
    assert_eq!(state(&p, "count"), num("2"));
    let o: serde_json::Value = serde_json::from_str(&p.observe_json(None).unwrap()).unwrap();
    assert_eq!(o["outcome"]["refused"][0]["code"], "contracts.outside");
    assert_eq!(o["state"]["count"], serde_json::json!({ "num": "2" }));
    // only what was drawn, when the target says what it drew
    let o: serde_json::Value = serde_json::from_str(&p.observe_json(Some(vec![slider.path.clone()])).unwrap()).unwrap();
    assert_eq!(o["tree"].as_object().unwrap().keys().collect::<Vec<_>>(), vec![&slider.path]);
}

#[test]
fn the_check_protocol_json_goes_in_too() {
    let p = page(COUNTER);
    let slider = find(&p.tree().unwrap(), "core/slider").unwrap();
    p.write_json(slider.path.clone(), "value".into(), r#"{"num": "3"}"#.into()).unwrap();
    assert_eq!(state(&p, "count"), num("3"));
    p.set_json(r#"{"count": {"num": "1"}}"#.into()).unwrap();
    assert_eq!(state(&p, "count"), num("1"));
    assert_eq!(p.value_json(r#"{"some": {"text": "x"}}"#.into()).unwrap(), Val::Opt { value: vec![Val::Text { s: "x".into() }] });
    assert!(p.value_json("not json".into()).is_err());
}

#[test]
fn a_slider_takes_its_ends_from_its_variable() {
    let p = page(COUNTER);
    let slider = find(&p.tree().unwrap(), "core/slider").unwrap();
    let e = p.slider_ends(slider.path).unwrap();
    assert_eq!((e.low.as_str(), e.high.as_str(), e.step.as_str()), ("0", "3", "1"));
    let p = page("$state {\n    v: number = 0.5;\n}\n\nwidget sample() {\n    view {\n        @slider(value = $state.v, label = \"V\", range = 0..2 step 0.25);\n        @slider(value = $state.v, label = \"W\");\n    }\n}\n@@@\n@sample;\n");
    let tree = p.tree().unwrap();
    let sliders: Vec<String> = tree.iter().flat_map(|n| std::iter::once(n.clone()).chain(n.slots.iter().flat_map(|s| s.nodes.clone()))).filter(|n| n.widget == "core/slider").map(|n| n.path).collect();
    let e = p.slider_ends(sliders[0].clone()).unwrap();
    assert_eq!((e.low.as_str(), e.high.as_str(), e.step.as_str()), ("0", "2", "0.25"));
    // nothing given: 0..1, by hundredths
    let e = p.slider_ends(sliders[1].clone()).unwrap();
    assert_eq!((e.low.as_str(), e.high.as_str(), e.step.as_str()), ("0", "1", "0.01"));
}

#[test]
fn moment_local_uses_the_zone() {
    let src = "$state {\n    at: moment = \"2026-11-16T23:30+00:00\";\n}\n@@@\nLocal: \\{$state.at.local()}\n";
    let utc = NativePage::new(build(src), PageInit::default(), Box::new(Utc)).unwrap();
    let md = utc.markdown().unwrap();
    assert!(md.contains("2026-11-16T23:30+00:00"), "{}", md);
    // an hour and a half east: the next day, with its offset
    let east = NativePage::new(build(src), PageInit::default(), Box::new(East(90))).unwrap();
    let md = east.markdown().unwrap();
    assert!(md.contains("2026-11-17T01:00+01:30"), "{}", md);
}

#[test]
fn a_shade_paints_from_its_shader() {
    let p = page("fn glow(at: point, px: number, args: number): pixel {\n    return pixel { r = at.x.clamp(0, 1), g = 0, b = at.y.clamp(0, 1), a = 1 };\n}\n\nwidget sample() {\n    view {\n        @canvas(label = \"G\", x = 0..1, y = 0..1, aspect = 1) {\n            @layer {\n                @shade(area = region { from = point { x = 0, y = 0 }, to = point { x = 1, y = 1 } }, shader = glow, args = 1, label = \"g\");\n            }\n        }\n    }\n}\n@@@\n@sample;\n");
    let shade = find(&p.tree().unwrap(), "core/shade").unwrap();
    assert_eq!(shade.props["shader"], Val::Fn { name: "doc/glow".into() });
    let px = p.shade(shade.path, 2, 2).unwrap();
    // the top row is the area's highest: blue there; red to the right
    let argb = |r: u32, b: u32| (0xff00_0000u32 | (r << 16) | b) as i32;
    assert_eq!(px, vec![argb(64, 191), argb(191, 191), argb(64, 64), argb(191, 64)]);
}

struct Fixed;
impl Measure for Fixed {
    fn spot(&self, _spot: Node) -> Extent {
        Extent { width: 40.0, height: 20.0 }
    }
    fn plane_width(&self, _plane: Node) -> f64 {
        320.0
    }
}

#[test]
fn the_plane_is_laid_out_from_the_targets_measure() {
    let p = page("$state {\n    seen: opt<region> = opt.NONE;\n}\n\nwidget map() {\n    view {\n        @plane(label = \"P\", aspect = 2) {\n            items {\n                @spot(at = point { x = 10, y = 10 }, anchor = anchor.SW, box = $state.seen) {\n                    @label(value = \"A\");\n                }\n            }\n        }\n    }\n}\n@@@\n@map;\n");
    p.layout(Box::new(Fixed)).unwrap();
    let o: serde_json::Value = serde_json::from_str(&p.observe_json(None).unwrap()).unwrap();
    let b = o["boxes"].as_object().unwrap().values().next().unwrap().clone();
    assert_eq!(b, serde_json::json!({ "from": { "x": { "num": "10" }, "y": { "num": "10" } }, "to": { "x": { "num": "50" }, "y": { "num": "30" } } }));
}

#[test]
fn supplies_name_widgets_or_whole_packs() {
    assert!(xtmd_android::supplies_widget(vec!["core/*".into()], "core/press".into()));
    assert!(!xtmd_android::supplies_widget(vec!["core/*".into()], "badge/badge".into()));
    assert!(xtmd_android::supplies_widget(vec!["badge/badge".into()], "badge/badge".into()));
    assert!(!xtmd_android::supplies_widget(vec!["core/*".into()], "corex/press".into()));
}

#[test]
fn a_widget_not_supplied_shows_its_markdown() {
    let init = PageInit { supplies: Some(vec!["core/paragraph".into()]), ..PageInit::default() };
    let p = NativePage::new(build(COUNTER), init, Box::new(Utc)).unwrap();
    let missing = p.missing().unwrap();
    assert!(missing.contains(&"core/press".to_string()), "{:?}", missing);
    assert!(find(&p.tree().unwrap(), "core/press").is_none());
    let _ = Field { name: String::new(), value: Val::Bool { b: true } };
}

#[test]
fn a_tree_update_sends_only_what_changed() {
    let p = page("$state {\n    count: int 0..3 = 0;\n}\n\nwidget sample() {\n    view {\n        @label(value = \"Still\");\n        @press(label = \"Add\", click = fn() { $state.count = ($state.count + 1).clamp(0, 3); });\n        @label(value = \"Count: \\{$state.count}\");\n    }\n}\n@@@\n@sample;\n");
    let first = p.tree().unwrap();
    let all = |nodes: &[Node]| -> Vec<Node> {
        fn walk(n: &[Node], out: &mut Vec<Node>) {
            for x in n {
                out.push(x.clone());
                for s in &x.slots {
                    walk(&s.nodes, out);
                }
            }
        }
        let mut out = Vec::new();
        walk(nodes, &mut out);
        out
    };
    assert!(all(&first).iter().all(|n| !n.same));
    let press = find(&first, "core/press").unwrap();
    let since = p.revision();
    p.event(press.path.clone(), "click".into(), vec![]).unwrap();
    let update = p.tree_update(since).unwrap();
    let nodes = all(&update);
    // the count's label is sent whole; the press and the still label are stubs
    let count = nodes.iter().find(|n| n.props.get("value") == Some(&Val::Text { s: "Count: 1".into() })).expect("the count is sent");
    assert!(!count.same);
    let stubs: Vec<&Node> = nodes.iter().filter(|n| n.same).collect();
    assert!(stubs.iter().any(|n| n.widget == "core/press" && n.props.is_empty()), "{:?}", stubs);
    assert!(stubs.iter().any(|n| n.widget == "core/label"));
    // read at another revision than the last one sent, everything is whole
    let whole = p.tree_update(since).unwrap();
    assert!(all(&whole).iter().all(|n| !n.same));
}

/// How long a page takes to mount, for the sample's tour (`XTMD_TIME_IR=<ir.json>`): printed, not held
/// to a number, since it depends on the box.
#[test]
fn mount_time() {
    let Ok(path) = std::env::var("XTMD_TIME_IR") else { return };
    let ir = std::fs::read_to_string(path).unwrap();
    for _ in 0..3 {
        let t = std::time::Instant::now();
        let file: xtmd_ir::ir::File = serde_json::from_str(&ir).unwrap();
        let parsed = t.elapsed();
        drop(file);
        let t = std::time::Instant::now();
        let p = NativePage::new(ir.clone(), PageInit::default(), Box::new(Utc)).unwrap();
        let mounted = t.elapsed();
        let t = std::time::Instant::now();
        let tree = p.tree().unwrap();
        eprintln!("parse {:?}, mount (parse included) {:?}, tree {:?} ({} roots)", parsed, mounted, t.elapsed(), tree.len());
    }
}

//! A page running on mkp-runtime: mounted, changed only through checked transactions, and
//! written back as Markdown (page 6, plan tab 11). The same pages as @mkp/runtime's
//! page.test.mjs, and a few more.

mod common;

use std::cell::Cell;
use std::collections::BTreeMap;
use std::rc::Rc;

use common::*;
use mkp_runtime::ir::Expr;
use mkp_runtime::layout::{around, keep_inside, place, Pt, Region, Size};
use mkp_runtime::{Broken, Drawn, Measure, Num, Page, PageOptions, PageValues, PageWidth, Value};

fn refused_code(code: &str, site: &str) -> Broken {
    Broken { code: Some(code.into()), rule: None, site: Some(site.into()) }
}

fn refused_rule(rule: &str) -> Broken {
    Broken { code: None, rule: Some(rule.into()), site: None }
}

fn state(p: &Page, name: &str) -> Expr {
    p.observe_state()[name].clone()
}

#[test]
fn a_page_mounts_its_tree_its_state_and_its_markdown() {
    let p = page("$state {\n    n: int 0..10 = 3;\n}\n@@@\n# Count\n\n@slider(value = $state.n, label = \"N\");\n");
    let tree = p.observe_tree();
    assert_eq!(tree["s1"].widget, "core/slider");
    assert_eq!(tree["s1"].props["value"], num("3"));
    assert_eq!(p.observe_state(), BTreeMap::from([("n".to_string(), num("3"))]));
    assert_eq!(p.markdown().unwrap(), "# Count\n\nN: 3\n");
    // the tree holds every prop worked out: a target only reads it
    let slider = p.find("s1").unwrap();
    assert!(matches!(slider.prop("value"), Some(Value::Num(x)) if *x == n("3")));
    assert_eq!(p.revision(), 1);
}

#[test]
fn a_widgets_write_goes_to_the_callers_variable_checked_against_its_contract() {
    let mut p = page("$state {\n    n: int 0..10 = 3;\n}\n@@@\n@slider(value = $state.n, label = \"N\");\n");
    p.write("s0", "value", v(&p, num("7"))).unwrap();
    assert_eq!(state(&p, "n"), num("7"));
    p.write("s0", "value", v(&p, num("12"))).unwrap();
    assert_eq!(state(&p, "n"), num("7"));
    assert_eq!(p.take_outcome().refused, vec![refused_code("contracts.outside", "s0")]);
    p.write("s0", "value", v(&p, num("1.5"))).unwrap();
    assert_eq!(state(&p, "n"), num("7"));
    // the slider's ends and step come from the variable's type
    let t = p.write_type(p.find("s0").unwrap(), "value").unwrap();
    assert!(t.contract.as_ref().and_then(|c| c.range.as_ref()).is_some(), "{:?}", t);
}

#[test]
fn an_apps_write_to_state_is_one_change_checked_once_against_states_rules() {
    let mut p = page("$state {\n    low: number = 1;\n    high: number = 5;\n\n    require \"low stays at or below high\" {\n        return low <= high;\n    }\n}\n@@@\n\\{$state.low} to \\{$state.high}\n");
    p.set(vec![("low".into(), v(&p, num("9")))]).unwrap();
    assert_eq!(p.take_outcome().refused, vec![refused_rule("low stays at or below high")]);
    assert_eq!(state(&p, "low"), num("1"));
    // both at once is one change, so the rule holds after it
    p.set(vec![("low".into(), v(&p, num("9"))), ("high".into(), v(&p, num("10")))]).unwrap();
    assert_eq!(p.take_outcome().refused, vec![]);
    assert_eq!(p.markdown().unwrap(), "9 to 10\n");
    // a field that doesn't exist changes nothing
    p.set(vec![("nope".into(), v(&p, num("1")))]).unwrap();
    assert_eq!(p.take_outcome().refused, vec![refused_code("contracts.outside", "$state.nope")]);
}

#[test]
fn an_apps_write_of_the_wrong_type_or_outside_its_contract_is_refused() {
    let mut p = page("record task {\n    title: text;\n}\n\n$state {\n    tasks: list<task> = [task { title = \"a\" }];\n    n: int 0..10 = 1;\n    note: opt<text> = opt.NONE;\n}\n@@@\n\\{$state.n}\n");
    let task = |title: Expr| Expr::List(vec![Expr::Record(mkp_runtime::ir::ExprRecord { ty: "doc/task".into(), fields: BTreeMap::from([("title".to_string(), title)]) })]);
    for (k, x) in [("tasks", num("3")), ("n", text("3")), ("tasks", task(num("1"))), ("note", Expr::Some(Box::new(num("2")))), ("n", num("11")), ("n", num("2.5"))] {
        p.set(vec![(k.into(), v(&p, x))]).unwrap();
        assert_eq!(p.take_outcome().refused, vec![refused_code("contracts.outside", &format!("$state.{}", k))], "{}", k);
    }
    assert_eq!(p.markdown().unwrap(), "1\n");
    p.set(vec![("tasks".into(), v(&p, task(text("b")))), ("note".into(), v(&p, Expr::Some(Box::new(text("hi")))))]).unwrap();
    assert_eq!(p.take_outcome().refused, vec![]);
    let Expr::List(items) = state(&p, "tasks") else { panic!() };
    let Expr::Record(r) = &items[0] else { panic!() };
    assert_eq!(r.fields["title"], text("b"));
}

#[test]
fn a_handler_that_fails_is_undone_whole_and_reported_the_page_carries_on() {
    let mut p = page("$state {\n    tries: int = 0;\n    total: number = 10;\n}\n\nwidget go() {\n    view {\n        @press(label = \"Go\", click = fn() { $state.tries = $state.tries + 1; $state.total = $state.total / 0; });\n    }\n}\n@@@\n@go;\n");
    p.event("s0/s0", "click", vec![]).unwrap();
    assert_eq!(p.observe_state(), BTreeMap::from([("tries".to_string(), num("0")), ("total".to_string(), num("10"))]));
    assert_eq!(p.take_outcome().failures, vec![refused_code("failure.number", "s0/s0")]);
    assert_eq!(p.take_errors().len(), 1);
    // and the next event runs
    let before = p.revision();
    p.event("s0/s0", "click", vec![]).unwrap();
    assert!(p.revision() > before);
}

#[test]
fn extern_channels_calls_are_reported_values_redraw_and_exposed_fns_run_as_one_change() {
    let mut p = page("extern scores {\n    unit: text = \"K\";\n    fn saved(total: int);\n}\n\n$state {\n    points: int 0... = 0;\n}\n\nexpose scores {\n    fn clear() {\n        $state.points = 0;\n    }\n}\n\nwidget tally(mut points: int) {\n    view {\n        @press(label = \"Add\", click = fn() { points = points + 1; scores.saved(points); });\n    }\n    markdown {\n        \\{points} \\{scores.unit}\n    }\n}\n@@@\n@tally(points = $state.points);\n");
    p.event("s0/s0", "click", vec![]).unwrap();
    let calls = p.take_calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].call.name, "doc/scores.saved");
    assert_eq!(calls[0].call.args, vec![num("1")]);
    assert_eq!(p.markdown().unwrap(), "1 K\n");
    p.set_extern("doc/scores", vec![("unit".into(), v(&p, text("points")))]).unwrap();
    assert_eq!(p.markdown().unwrap(), "1 points\n");
    p.expose("doc/scores", "clear", vec![]).unwrap();
    assert_eq!(state(&p, "points"), num("0"));
    assert!(p.take_calls().is_empty());
}

#[test]
fn a_handler_undone_takes_back_the_calls_it_made() {
    let mut p = page("extern scores {\n    fn saved(total: int);\n}\n\n$state {\n    points: int = 0;\n\n    require \"at most one point\" {\n        return points <= 1;\n    }\n}\n\nwidget tally() {\n    view {\n        @press(label = \"Add\", click = fn() { scores.saved(1); $state.points = $state.points + 5; });\n    }\n}\n@@@\n@tally;\n");
    p.event("s0/s0", "click", vec![]).unwrap();
    assert!(p.take_calls().is_empty());
    assert_eq!(p.take_outcome().failures, vec![Broken { code: None, rule: Some("at most one point".into()), site: Some("s0/s0".into()) }]);
    assert_eq!(state(&p, "points"), num("0"));
}

#[test]
fn a_loops_rows_keep_their_widgets_variables_by_item_not_by_position() {
    let mut p = page("record task {\n    title: text;\n}\n\n$state {\n    tasks: list<task> = [task { title = \"a\" }, task { title = \"b\" }];\n}\n\nwidget row(t: task) {\n    mut votes: int = 0;\n    view {\n        @press(label = \"\\{t.title}: \\{votes}\", click = fn() { votes = votes + 1; });\n    }\n}\n\nwidget board() {\n    view {\n        mut for (t in $state.tasks) {\n            if (mut x: task = t) {\n                @row(t = x);\n                @press(label = \"Drop\", click = fn() { $state.tasks.remove(x); });\n            }\n        }\n    }\n}\n@@@\n@board;\n");
    p.event("s0/s0[1]/s2/s0", "click", vec![]).unwrap();
    assert_eq!(p.observe_tree()["s0/s0[1]/s2/s0"].props["label"], text("b: 1"));
    let key_before = p.find("s0/s0[1]/s2/s0").unwrap().key.clone();
    p.event("s0/s0[0]/s3", "click", vec![]).unwrap();
    // "b" is now the first row, and keeps its vote
    assert_eq!(p.observe_tree()["s0/s0[0]/s2/s0"].props["label"], text("b: 1"));
    assert_eq!(p.find("s0/s0[0]/s2/s0").unwrap().key, key_before);
    assert!(p.find("s0/s0[1]/s2/s0").is_none());
}

#[test]
fn a_widget_that_fails_while_drawing_is_a_notice_and_is_tried_again() {
    let mut p = page("$state {\n    parts: int 0... = 0;\n}\n\nwidget share() {\n    view {\n        @label(value = \"Each: \\{100 / $state.parts}\");\n    }\n}\n@@@\n@share;\n\nAfter.\n");
    assert_eq!(p.take_outcome().failures, vec![refused_code("failure.number", "s0")]);
    let tree = p.observe_tree();
    assert_eq!(tree["s0"].widget, "#notice");
    assert!(matches!(&tree["s0"].props["message"], Expr::Text(t) if t.starts_with("share failed: ")));
    // the rest of the page carries on, and the notice is a quote in Markdown
    let md = p.markdown().unwrap();
    assert!(md.starts_with("> share failed: ") && md.ends_with("\n\nAfter.\n"), "{:?}", md);
    p.set(vec![("parts".into(), v(&p, num("4")))]).unwrap();
    assert_eq!(p.observe_tree()["s0/s0"].props["value"], text("Each: 25"));
    // reported once, not at every redraw
    assert_eq!(p.take_outcome().failures, vec![]);
}

#[test]
fn the_pages_values_reach_the_document_as_cores_page_channel() {
    let opts = PageOptions { page: PageValues { width: Some(PageWidth::Narrow), theme: None }, ..PageOptions::default() };
    let mut p = page_with("widget where() {\n    view {\n        @label(value = page.width == width.NARROW ? \"Narrow\" : \"Wide\");\n    }\n}\n@@@\n@where;\n", opts);
    assert_eq!(p.markdown().unwrap(), "Narrow\n");
    p.set_page(PageValues { width: Some(PageWidth::Wide), theme: None }).unwrap();
    assert_eq!(p.markdown().unwrap(), "Wide\n");
}

#[test]
fn on_change_is_told_after_every_redraw_and_the_revision_moves() {
    let mut p = page("$state {\n    n: int 0..10 = 0;\n}\n@@@\n@slider(value = $state.n, label = \"N\");\n");
    let told = Rc::new(Cell::new(0));
    let t = told.clone();
    let id = p.on_change(move || t.set(t.get() + 1));
    let r0 = p.revision();
    p.write("s0", "value", v(&p, num("1"))).unwrap();
    p.off_change(id);
    p.write("s0", "value", v(&p, num("2"))).unwrap();
    assert_eq!(told.get(), 1);
    assert_eq!(p.revision(), r0 + 2);
}

#[test]
fn writing_the_markdown_leaves_the_page_as_it_was() {
    let mut p = page("record task {\n    title: text;\n}\n\n$state {\n    tasks: list<task> = [task { title = \"a\" }, task { title = \"b\" }];\n}\n\nwidget row(t: task) {\n    event drop();\n    view {\n        @press(label = \"Drop \\{t.title}\", click = fn() { invoke drop(); });\n    }\n    markdown {\n        - \\{t.title}\n    }\n}\n\nwidget board() {\n    view {\n        mut for (t in $state.tasks) {\n            if (mut x: task = t) {\n                @row(t = x, drop = fn() { $state.tasks.remove(x); });\n            }\n        }\n    }\n    markdown {\n        @for (t in $state.tasks) {\n        - \\{t.title}\n        }\n    }\n}\n@@@\n@board;\n");
    assert_eq!(p.markdown().unwrap(), "- a\n- b\n");
    p.event("s0/s0[0]/s2/s0", "click", vec![]).unwrap();
    assert_eq!(p.take_outcome().failures, vec![]);
    assert_eq!(p.markdown().unwrap(), "- b\n");
    p.event("s0/s0[0]/s2/s0", "click", vec![]).unwrap();
    assert_eq!(p.markdown().unwrap(), "");
}

#[test]
fn writing_the_markdown_leaves_a_widgets_events_in_place() {
    let mut p = page("$state {\n    n: int = 0;\n}\n\nwidget go() {\n    event pressed();\n    view {\n        @press(label = \"Go\", click = fn() { invoke pressed(); });\n    }\n    markdown {\n        Go\n    }\n}\n@@@\n@go(pressed = fn() { $state.n = $state.n + 1; });\n\nPressed \\{$state.n} times.\n");
    assert_eq!(p.markdown().unwrap(), "Go\n\nPressed 0 times.\n");
    p.event("s0/s0", "click", vec![]).unwrap();
    assert_eq!(state(&p, "n"), num("1"));
}

#[test]
fn markdown_out_escapes_values_so_they_never_become_formatting() {
    let mut p = page("$state {\n    name: text = \"plain\";\n}\n@@@\n# Hello \\{$state.name}\n\n- one\n- **two**\n");
    assert_eq!(p.markdown().unwrap(), "# Hello plain\n\n- one\n- **two**\n");
    p.set(vec![("name".into(), v(&p, text("*not* [a](link) `x`")))]).unwrap();
    assert_eq!(p.markdown().unwrap(), "# Hello \\*not\\* \\[a\\](link) \\`x\\`\n\n- one\n- **two**\n");
}

#[test]
fn listens_says_which_events_do_something() {
    let p = page("$state {\n    n: int = 0;\n}\n\nwidget go() {\n    event pressed();\n    view {\n        @press(label = \"Go\", click = fn() { invoke pressed(); });\n    }\n}\n@@@\n@go(pressed = fn() { $state.n = $state.n + 1; });\n\n@go;\n\n@label(value = \"Quiet\");\n");
    let set = p.find("s0/s0").unwrap();
    let unset = p.find("s1/s0").unwrap();
    assert!(p.listens(set, "click"));
    // it only passes the event on, and its caller set nothing
    assert!(!p.listens(unset, "click"));
    assert!(!p.listens(p.find("s2").unwrap(), "click"));
}

#[test]
fn each_change_has_the_step_limit_to_itself() {
    // about 600,000 steps a click: two clicks are more than the limit together, never alone
    let mut p = page("$state {\n    n: int = 0;\n}\n\nwidget go() {\n    view {\n        @press(label = \"Go\", click = fn() { mut k: int = 0; for (i in 1..300) { for (j in 1..1000) { k = k + 1; } } $state.n = $state.n + k; });\n        @press(label = \"Too much\", click = fn() { mut k: int = 0; for (i in 1..600) { for (j in 1..1000) { k = k + 1; } } $state.n = $state.n + k; });\n    }\n}\n@@@\n@go;\n");
    p.event("s0/s0", "click", vec![]).unwrap();
    p.event("s0/s0", "click", vec![]).unwrap();
    assert_eq!(p.take_outcome().failures, vec![]);
    assert_eq!(state(&p, "n"), num("600000"));
    // one change over the limit is a failure, undone
    p.event("s0/s1", "click", vec![]).unwrap();
    assert_eq!(p.take_outcome().failures, vec![refused_code("failure.limit", "s0/s1")]);
    assert_eq!(state(&p, "n"), num("600000"));
    // and the one after it starts again from nothing
    p.event("s0/s0", "click", vec![]).unwrap();
    assert_eq!(p.take_outcome().failures, vec![]);
    assert_eq!(state(&p, "n"), num("900000"));
}

#[test]
fn an_extern_widget_the_target_doesnt_supply_shows_its_markdown_and_is_reported() {
    let pack = repo().join("targets/checks/packs/badge");
    let m = build_with("import badge;\n@@@\n# Votes\n\n@badge(label = \"Votes\", count = 2);\n\n@seal(text = \"Checked by nobody\");\n", &[pack]);
    assert_eq!(m.needs.packs.len(), 1);
    assert_eq!(m.needs.packs[0].externs, vec!["badge/badge".to_string(), "badge/seal".to_string()]);
    let opts = PageOptions { supplies: Some(Rc::new(|w: &str| w.starts_with("core/") || w == "badge/badge")), ..PageOptions::default() };
    let mut p = Page::from_module(m, opts).unwrap();
    let tree = p.observe_tree();
    assert_eq!(tree["s1"].widget, "badge/badge");
    // the seal is drawn as its Markdown: a quote holding a paragraph, under its own path
    assert!(!tree.contains_key("s2"));
    let mut widgets: Vec<&str> = tree.values().map(|n| n.widget.as_str()).filter(|w| *w != "core/heading").collect();
    widgets.sort();
    assert_eq!(widgets, vec!["badge/badge", "core/paragraph", "core/quote"]);
    assert_eq!(p.missing(), vec!["badge/seal".to_string()]);
    // its calls show their Markdown, supplied or not
    assert_eq!(p.markdown().unwrap(), "# Votes\n\n**Votes**: 2\n\n> Checked by nobody\n");
    p.set_supplies(None).unwrap();
    assert!(p.missing().is_empty());
    assert_eq!(p.observe_tree()["s2"].widget, "badge/seal");
}

// ---- the plane's layout

fn pt(x: &str, y: &str) -> Pt {
    Pt { x: n(x), y: n(y) }
}

fn show(r: Region) -> [String; 4] {
    [r.from.x.show(), r.from.y.show(), r.to.x.show(), r.to.y.show()]
}

#[test]
fn a_spots_box_is_its_anchors_part_of_it_on_the_point_moved_by_its_nudge() {
    let size = Size { width: n("40"), height: n("20") };
    assert_eq!(show(place(pt("0", "0"), "CENTER", pt("0", "0"), size).unwrap()), ["-20", "-10", "20", "10"]);
    assert_eq!(show(place(pt("0", "0"), "SW", pt("0", "0"), size).unwrap()), ["0", "0", "40", "20"]);
    assert_eq!(show(place(pt("0", "0"), "NE", pt("0", "0"), size).unwrap()), ["-40", "-20", "0", "0"]);
    assert_eq!(show(place(pt("0", "0"), "N", pt("5", "5"), size).unwrap()), ["-15", "-15", "25", "5"]);
    assert_eq!(show(place(pt("10", "10"), "E", pt("0", "0"), size).unwrap()), ["-30", "0", "10", "20"]);
}

#[test]
fn bounds_left_out_are_the_region_around_every_box_and_the_centre_stays_inside() {
    let r = around(&[Region { from: pt("-4", "-10"), to: pt("4", "10") }, Region { from: pt("100", "50"), to: pt("124", "70") }]).unwrap();
    assert_eq!(show(r), ["-4", "-10", "124", "70"]);
    let b = Region { from: pt("-400", "-300"), to: pt("400", "300") };
    let at = |c: Pt, h: Pt| {
        let p = keep_inside(c, h, b).unwrap();
        (p.x.show(), p.y.show())
    };
    assert_eq!(at(pt("10", "10"), pt("100", "50")), ("10".into(), "10".into()));
    assert_eq!(at(pt("390", "-290"), pt("100", "50")), ("300".into(), "-250".into()));
    assert_eq!(at(pt("390", "0"), pt("500", "50")), ("0".into(), "0".into()));
}

const MAP: &str = "$state {\n    home: opt<region> = opt.NONE;\n}\n\nwidget map() {\n    view {\n        @plane(label = \"Map\", bounds = region { from = point { x = -100, y = -100 }, to = point { x = 100, y = 100 } }) {\n            items {\n                @spot(at = point { x = 0, y = 0 }, box = $state.home) {\n                    @label(value = \"Home\");\n                }\n            }\n        }\n    }\n}\n@@@\n@map;\n";

struct Fixed {
    width: Num,
    measured: Rc<Cell<u32>>,
    /// Each spot measured grows by this much: a layout that never settles.
    grow: i64,
}

impl Measure for Fixed {
    fn spot(&mut self, _page: &Page, _spot: &Drawn) -> Size {
        self.measured.set(self.measured.get() + 1);
        let extra = self.grow * self.measured.get() as i64;
        Size { width: Num::int(32 + extra), height: Num::int(20) }
    }

    fn plane_width(&mut self, _page: &Page, _plane: &Drawn) -> Num {
        self.width
    }
}

fn region_expr(fx: &str, fy: &str, tx: &str, ty: &str) -> Expr {
    use mkp_runtime::ir::ExprRecord;
    let point = |x: &str, y: &str| Expr::Record(ExprRecord { ty: "core/point".into(), fields: BTreeMap::from([("x".to_string(), num(x)), ("y".to_string(), num(y))]) });
    Expr::Some(Box::new(Expr::Record(ExprRecord { ty: "core/region".into(), fields: BTreeMap::from([("from".to_string(), point(fx, fy)), ("to".to_string(), point(tx, ty))]) })))
}

#[test]
fn a_layout_writes_boxes_once_a_second_pass_with_nothing_changed_writes_nothing() {
    let mut p = page(MAP);
    let redraws = Rc::new(Cell::new(0));
    let r = redraws.clone();
    p.on_change(move || r.set(r.get() + 1));
    let mut measure = Fixed { width: n("100"), measured: Rc::new(Cell::new(0)), grow: 0 };
    p.layout(&mut measure).unwrap();
    assert_eq!(redraws.get(), 1);
    assert_eq!(state(&p, "home"), region_expr("-16", "-10", "16", "10"));
    // the plane's drawn region, in its units
    let plane = p.observe_tree().into_iter().find(|(_, m)| m.widget == "core/plane").unwrap().1;
    assert!(plane.props.contains_key("drawn"));
    p.layout(&mut measure).unwrap();
    assert_eq!(redraws.get(), 1);
    assert_eq!(p.take_outcome(), Default::default());
}

#[test]
fn a_layout_that_never_settles_fails_its_plane_and_is_held_until_an_outside_change() {
    let mut p = page(MAP);
    let measured = Rc::new(Cell::new(0));
    let mut measure = Fixed { width: n("100"), measured: measured.clone(), grow: 2 };
    p.layout(&mut measure).unwrap();
    assert_eq!(measured.get(), mkp_runtime::MAX_LAYOUT_PASSES as u32);
    let failures = p.take_outcome().failures;
    assert_eq!(failures.len(), 1);
    assert_eq!(failures[0].code.as_deref(), Some("failure.layout"));
    // held: laying out again, as a target does every frame, runs no pass
    p.layout(&mut measure).unwrap();
    p.layout(&mut measure).unwrap();
    assert_eq!(measured.get(), mkp_runtime::MAX_LAYOUT_PASSES as u32);
    // until something outside the layout changes the page
    p.set_page(PageValues { width: Some(PageWidth::Wide), theme: None }).unwrap();
    p.layout(&mut measure).unwrap();
    assert_eq!(measured.get(), 2 * mkp_runtime::MAX_LAYOUT_PASSES as u32);
}

#[test]
fn a_spot_outside_its_planes_bounds_is_a_warning_once_as_it_moves_out() {
    let mut p = page("$state {\n    x: number = 5;\n}\n\nwidget map() {\n    view {\n        @plane(label = \"Map\", bounds = region { from = point { x = 0, y = 0 }, to = point { x = 10, y = 10 } }) {\n            items {\n                @spot(at = point { x = $state.x, y = 5 }) {\n                    @label(value = \"here\");\n                }\n            }\n        }\n    }\n}\n@@@\n@map;\n");
    let mut measure = Fixed { width: n("100"), measured: Rc::new(Cell::new(0)), grow: 0 };
    let outside = || vec![refused_code("views.spot-outside-bounds", "s0/s1")];
    p.layout(&mut measure).unwrap();
    assert_eq!(p.take_warnings(), vec![]);
    for (x, warned) in [("20", outside()), ("30", vec![]), ("3", vec![]), ("-1", outside())] {
        p.set(vec![("x".into(), v(&p, num(x)))]).unwrap();
        p.layout(&mut measure).unwrap();
        assert_eq!(p.take_warnings(), warned, "x = {}", x);
    }
    assert_eq!(p.take_outcome().failures, vec![]);
}

#[test]
fn a_widget_in_a_list_slot_writes_its_markdown_with_its_inputs() {
    let mut p = page("widget tally(label: text) {\n    mut votes: int = 0;\n    view {\n        @press(label = \"\\{label}: \\{votes}\", click = fn() { votes = votes + 1; });\n    }\n    markdown {\n        \\{label} has \\{votes}\n    }\n}\n\nwidget pile() {\n    view {\n        @stack {\n            @tally(label = \"a\");\n            @tally(label = \"b\");\n        }\n    }\n}\n@@@\n@pile;\n");
    // as the compiler writes it, with the values it has now
    assert_eq!(p.markdown().unwrap(), "a has 0\n\nb has 0\n");
    let press = p.observe_tree().into_iter().find(|(_, m)| m.props.get("label") == Some(&text("a: 0"))).unwrap().0;
    // the stack's markdown places each child at a site of its own, so the Markdown has an
    // instance of its own for it too: its inputs, and its own variables as they start
    p.event(&press, "click", vec![]).unwrap();
    assert_eq!(p.markdown().unwrap(), "a has 0\n\nb has 0\n");
    p.event(&press, "click", vec![]).unwrap();
    assert_eq!(p.observe_tree()[&press].props["label"], text("a: 2"));
}

#[test]
fn a_widget_of_another_kind_at_a_key_keeps_its_own_variables() {
    let mut p = page("$state {\n    which: bool = true;\n}\n\nwidget one() {\n    mut n: int = 0;\n    view {\n        @press(label = \"one \\{n}\", click = fn() { n = n + 1; });\n    }\n}\n\nwidget two() {\n    mut n: int = 0;\n    view {\n        @press(label = \"two \\{n}\", click = fn() { n = n + 1; });\n    }\n}\n\nwidget pile() {\n    view {\n        @press(label = \"swap\", click = fn() { $state.which = !$state.which; });\n        @stack {\n            if ($state.which) {\n                @one;\n            } else {\n                @two;\n            }\n        }\n    }\n}\n@@@\n@pile;\n");
    let at = "s0/s1/s1[0]/s3/s0";
    p.event(at, "click", vec![]).unwrap();
    assert_eq!(p.observe_tree()[at].props["label"], text("one 1"));
    p.event("s0/s0", "click", vec![]).unwrap();
    assert_eq!(p.observe_tree()[at].props["label"], text("two 0"));
    // `one` left the key, and `two` holds it: its count moves, redraw after redraw
    for k in 1..=3 {
        p.event(at, "click", vec![]).unwrap();
        assert_eq!(p.observe_tree()[at].props["label"], text(&format!("two {}", k)));
    }
}

// ---- reusing what didn't change (plan tab 2: only the bindings that read what changed)

const MEMO_PAGE: &str = "record task {\n    title: text;\n}\n\n$state {\n    n: int = 0;\n    tasks: list<task> = [task { title = \"a\" }, task { title = \"b\" }];\n    note: text = \"hi\";\n}\n\nwidget row(t: task) {\n    mut votes: int = 0;\n    view {\n        @press(label = \"\\{t.title}: \\{votes}\", click = fn() { votes = votes + 1; });\n    }\n}\n\nwidget board() {\n    view {\n        @label(value = \"n is \\{$state.n}\");\n        @slider(value = $state.n, label = \"N\", range = 0..100);\n        mut for (t in $state.tasks) {\n            if (mut x: task = t) {\n                @row(t = x);\n                @press(label = \"Drop\", click = fn() { $state.tasks.remove(x); });\n            }\n        }\n        @label(value = $state.note);\n    }\n}\n@@@\n# Board\n\n@board;\n";

fn by_path(p: &Page) -> BTreeMap<String, Drawn> {
    fn walk(nodes: &[Drawn], out: &mut BTreeMap<String, Drawn>) {
        for d in nodes {
            out.insert(d.path.clone(), d.clone());
            for kids in d.slots.values() {
                walk(kids, out);
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(p.tree(), &mut out);
    out
}

#[test]
fn a_widget_whose_reads_didnt_change_is_the_very_same_node_after_a_change() {
    let mut p = page(MEMO_PAGE);
    let before = by_path(&p);
    p.write("s1/s1", "value", v(&p, num("5"))).unwrap();
    let after = by_path(&p);
    // what reads $state.n is drawn anew; the rows and the note are reused as they were
    assert!(!Drawn::same(&after["s1/s0"], &before["s1/s0"]));
    assert_eq!(p.observe_tree()["s1/s0"].props["value"], text("n is 5"));
    for reused in ["s1/s6", "s1/s2[0]/s4/s0", "s1/s2[1]/s5", "m0"] {
        assert!(before.contains_key(reused), "{} is drawn", reused);
        assert!(Drawn::same(&after[reused], &before[reused]), "{} is reused", reused);
    }
}

/// Every step, on a page with reuse and on one without: the same tree, `$state` and Markdown.
fn same_with_and_without_reuse(source: &str, steps: &[&dyn Fn(&mut Page)]) {
    let mut on = page(source);
    let mut off = page_with(source, PageOptions { memo: false, ..PageOptions::default() });
    let same = |on: &Page, off: &Page, k: usize| {
        assert_eq!(on.observe_tree(), off.observe_tree(), "the tree after step {}", k);
        assert_eq!(on.observe_state(), off.observe_state(), "$state after step {}", k);
        assert_eq!(on.markdown().unwrap(), off.markdown().unwrap(), "the Markdown after step {}", k);
    };
    same(&on, &off, 0);
    for (k, step) in steps.iter().enumerate() {
        step(&mut on);
        step(&mut off);
        same(&on, &off, k + 1);
        assert_eq!(on.take_outcome(), off.take_outcome(), "the outcome after step {}", k + 1);
    }
}

#[test]
fn with_and_without_reuse_every_step_observes_the_same_tree_state_and_markdown() {
    same_with_and_without_reuse(
        MEMO_PAGE,
        &[
            &|p| p.write("s1/s1", "value", v(p, num("7"))).unwrap(),
            &|p| p.event("s1/s2[1]/s4/s0", "click", vec![]).unwrap(),
            &|p| p.event("s1/s2[1]/s4/s0", "click", vec![]).unwrap(),
            &|p| p.event("s1/s2[0]/s5", "click", vec![]).unwrap(),
            &|p| p.set(vec![("note".into(), v(p, text("there")))]).unwrap(),
            &|p| p.event("s1/s2[0]/s4/s0", "click", vec![]).unwrap(),
            &|p| p.set(vec![("n".into(), v(p, num("-1")))]).unwrap(),
            &|p| p.set_page(PageValues { width: Some(PageWidth::Narrow), theme: Some(mkp_runtime::PageTheme::Dark) }).unwrap(),
            &|p| p.write("s1/s1", "value", v(p, num("3"))).unwrap(),
        ],
    );
}

#[test]
fn an_undone_change_leaves_no_reused_node_behind() {
    let mut p = page("$state {\n    n: int = 0;\n    total: number = 10;\n}\n\nwidget go() {\n    view {\n        @label(value = \"\\{$state.n} of \\{$state.total}\");\n        @press(label = \"Go\", click = fn() { $state.n = $state.n + 1; $state.total = $state.total / 0; });\n    }\n}\n@@@\n@go;\n");
    p.event("s0/s1", "click", vec![]).unwrap();
    assert_eq!(p.observe_tree()["s0/s0"].props["value"], text("0 of 10"));
    assert_eq!(p.take_outcome().failures.len(), 1);
}

#[test]
fn dragging_on_the_tour_page_observes_the_same_with_and_without_reuse() {
    let source = std::fs::read_to_string(repo().join("targets/android/compose/sample/pages/tour.mkp.md")).unwrap();
    let point = |x: &str, y: &str| {
        Expr::Record(mkp_runtime::ir::ExprRecord { ty: "core/point".into(), fields: BTreeMap::from([("x".to_string(), num(x)), ("y".to_string(), num(y))]) })
    };
    let find = |p: &Page, widget: &str| p.observe_tree().into_iter().find(|(_, m)| m.widget == widget).unwrap().0;
    let lay = |p: &mut Page| {
        let mut m = Fixed { width: n("640"), measured: Rc::new(Cell::new(0)), grow: 0 };
        p.layout(&mut m).unwrap();
    };
    let handle = |x: &'static str, y: &'static str| {
        move |p: &mut Page| {
            let at = find(p, "core/handle");
            let value = v(p, point(x, y));
            p.write(&at, "at", value).unwrap();
            lay(p);
        }
    };
    let pan = |x: &'static str, y: &'static str| {
        move |p: &mut Page| {
            let at = find(p, "core/plane");
            let value = v(p, point(x, y));
            p.write(&at, "center", value).unwrap();
            lay(p);
        }
    };
    let (h1, h2, p1, p2, h3) = (handle("0.5", "0.2"), handle("0.6", "0.1"), pan("20", "10"), pan("40", "-20"), handle("-0.3", "0.9"));
    let dark = |p: &mut Page| p.set(vec![("dark".into(), v(p, Expr::Bool(true)))]).unwrap();
    same_with_and_without_reuse(&source, &[&lay, &h1, &h2, &p1, &dark, &p2, &h3]);
}

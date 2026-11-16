//! Our egui widgets, drawn headless: what a screen reader reads in the AccessKit tree, and what a
//! reader's pointer and keys do to the page.

mod common;

use egui::accesskit::Role;
use mkp_egui::check::{self, Headless};
use mkp_egui::runtime::{Page, PageOptions, Value};
use mkp_egui::{Act, Ctx, MkpPage, Props};

fn num(h: &mut Headless, name: &str) -> String {
    match h.page().page().state_value(name) {
        Some(Value::Num(n)) => n.show(),
        other => panic!("$state.{} is {:?}", name, other),
    }
}

fn text_state(h: &mut Headless, name: &str) -> String {
    match h.page().page().state_value(name) {
        Some(Value::Text(t)) => t.to_string(),
        other => panic!("$state.{} is {:?}", name, other),
    }
}

/// A node by its author id: a widget's root (`press@s0/s0`) or a part (`slider.input`).
fn node<'t>(h: &'t Headless, author: &str) -> egui_kittest::kittest::AccessKitNode<'t> {
    check::all(h.root()).into_iter().find(|n| n.author_id() == Some(author)).unwrap_or_else(|| panic!("no node {}", author))
}

fn has(h: &Headless, author: &str) -> bool {
    check::all(h.root()).into_iter().any(|n| n.author_id() == Some(author))
}

fn center(h: &Headless, author: &str) -> egui::Pos2 {
    check::rect(&node(h, author)).unwrap().center()
}

const PRESS: &str = r#"$state {
    count: int = 0;
}

widget sample() {
    view {
        @press(label = "Add", click = fn() { $state.count = $state.count + 1; });
        @press(label = "Never", disabled = true, click = fn() { $state.count = $state.count + 100; });
    }
}
@@@
@sample;
"#;

#[test]
fn a_press_is_a_named_button_and_a_click_runs_its_handler() {
    let mut h = common::mount(PRESS);
    {
        let n = node(&h, "press@s0/s0");
        assert_eq!(n.role(), Role::Button);
        assert_eq!(n.label().as_deref(), Some("Add"));
        assert_eq!(check::text(&n), "Add");
    }
    let at = center(&h, "press@s0/s0");
    h.click_at(at);
    h.settle().unwrap();
    assert_eq!(num(&mut h, "count"), "1");
    // Enter and Space press the focused button, as egui's own buttons
    assert!(node(&h, "press@s0/s0").is_focused());
    h.key("Enter").unwrap();
    h.key("Space").unwrap();
    h.settle().unwrap();
    assert_eq!(num(&mut h, "count"), "3");
}

#[test]
fn a_disabled_press_says_so_and_does_nothing() {
    let mut h = common::mount(PRESS);
    assert!(node(&h, "press@s0/s1").is_disabled());
    let at = center(&h, "press@s0/s1");
    h.click_at(at);
    h.settle().unwrap();
    assert_eq!(num(&mut h, "count"), "0");
}

#[test]
fn a_field_writes_what_is_typed_and_enter_submits() {
    let mut h = common::mount(
        r#"$state {
    name: text = "";
    sent: int = 0;
}

widget sample() {
    view {
        @field(value = $state.name, label = "Name", submit = fn() { $state.sent = $state.sent + 1; });
    }
}
@@@
@sample;
"#,
    );
    let id = node(&h, "field.input").locate();
    assert_eq!(node(&h, "field.input").label().as_deref(), Some("Name"));
    h.focus(id);
    h.settle().unwrap();
    h.type_text("Ada");
    h.settle().unwrap();
    assert_eq!(text_state(&mut h, "name"), "Ada");
    assert_eq!(check::text(&node(&h, "field.input")), "Ada");
    h.key("Enter").unwrap();
    h.settle().unwrap();
    assert_eq!(num(&mut h, "sent"), "1");
    assert_eq!(text_state(&mut h, "name"), "Ada");
}

const SLIDER: &str = r#"$state {
    level: int 0..10 = 5;
}

widget sample() {
    view {
        @slider(value = $state.level, label = "Level");
    }
}
@@@
@sample;
"#;

#[test]
fn a_slider_moves_by_its_variables_step_and_stops_at_its_ends() {
    let mut h = common::mount(SLIDER);
    {
        let n = node(&h, "slider.input");
        assert_eq!(n.role(), Role::Slider);
        assert_eq!(n.numeric_value(), Some(5.0));
        assert_eq!((n.min_numeric_value(), n.max_numeric_value(), n.numeric_value_step()), (Some(0.0), Some(10.0), Some(1.0)));
    }
    let id = node(&h, "slider.input").locate();
    h.focus(id);
    h.settle().unwrap();
    h.key("ArrowRight").unwrap();
    h.key("ArrowRight").unwrap();
    h.settle().unwrap();
    assert_eq!(num(&mut h, "level"), "7");
    assert!(node(&h, "slider.input").is_focused(), "the arrows keep the focus on the slider");
    h.key("End").unwrap();
    h.key("ArrowRight").unwrap();
    h.settle().unwrap();
    assert_eq!(num(&mut h, "level"), "10");
    h.key("Home").unwrap();
    h.settle().unwrap();
    assert_eq!(num(&mut h, "level"), "0");
}

#[test]
fn a_slider_takes_only_what_it_can_reach_and_the_rest_goes_through_the_page() {
    let mut h = common::mount(SLIDER);
    h.page().act("s0/s0", Act::Write { input: "value".into(), value: Value::Num(mkp_egui::runtime::Num::int(7)) });
    h.settle().unwrap();
    assert_eq!(num(&mut h, "level"), "7");
    // past its end: the page refuses it, as the web's does
    h.page().act("s0/s0", Act::Write { input: "value".into(), value: Value::Num(mkp_egui::runtime::Num::int(11)) });
    h.settle().unwrap();
    assert_eq!(num(&mut h, "level"), "7");
    let refused = h.page().page_mut().take_outcome().refused;
    assert_eq!(refused.len(), 1);
    assert_eq!(refused[0].code.as_deref(), Some("contracts.outside"));
}

#[test]
fn an_overlay_opens_from_its_anchor_and_escape_closes_it() {
    let mut h = common::mount(
        r#"$state {
    open: bool = false;
}

widget sample() {
    view {
        @overlay(label = "More", open = $state.open) {
            anchor {
                @label(value = "More");
            }
            body {
                @label(value = "The rest");
            }
        }
    }
}
@@@
@sample;
"#,
    );
    assert!(!has(&h, "overlay.body"), "closed, its body isn't shown");
    // ...but it is kept on the page, as the web keeps it hidden
    assert!(h.page().shown().contains("s0/s2"));
    let at = center(&h, "overlay.anchor");
    h.click_at(at);
    h.settle().unwrap();
    assert_eq!(h.page().page().state_value("open").map(|v| v.to_ir()), Some(Value::Bool(true).to_ir()));
    {
        let body = node(&h, "overlay.body");
        assert_eq!(body.role(), Role::Dialog);
        assert_eq!(body.label().as_deref(), Some("More"));
        assert_eq!(check::text(&body), "The rest");
    }
    h.key("Escape").unwrap();
    h.settle().unwrap();
    assert!(!has(&h, "overlay.body"));
    assert!(node(&h, "overlay.anchor").is_focused(), "the focus goes back to the anchor");
}

#[test]
fn blocks_have_their_roles_and_words() {
    let h = common::mount("# A *title*\n\nSome **bold** words and `code`.\n\n- one\n- [x] done\n\n$$\nx^2\n$$\n");
    let all = check::all(h.root());
    let heading = all.iter().find(|n| n.role() == Role::Heading).unwrap();
    assert_eq!(heading.level(), Some(1));
    assert_eq!(heading.label().as_deref(), Some("A title"));
    let para = all.iter().find(|n| n.role() == Role::Paragraph).unwrap();
    assert_eq!(check::text(para), "Some bold words and code.");
    let list = all.iter().find(|n| n.role() == Role::List).unwrap();
    assert_eq!(list.class_name(), Some("ul"));
    let task = all.iter().find(|n| n.author_id() == Some("item.check")).unwrap();
    assert_eq!(task.label().as_deref(), Some("Done"));
    assert!(task.is_disabled());
    // egui draws no maths: the formula shows as its TeX, and is named by it
    let math = all.iter().find(|n| n.role() == Role::Math).unwrap();
    assert_eq!(math.label().as_deref(), Some("x^2"));
    assert_eq!(check::text(math), "x^2");
}

#[test]
fn an_extern_nobody_supplies_shows_its_markdown_and_is_reported() {
    let doc = std::fs::read_to_string(common::repo().join("targets/checks/cases/packs/a-pack-supplies-its-externs.mkp.md")).unwrap();
    let page = Page::new(common::ir(&doc, &["targets/checks/packs/badge"]), PageOptions::default()).unwrap();
    let mut h = Headless::new(MkpPage::new(page).follow_theme(false), egui::vec2(640.0, 480.0), false);
    h.settle().unwrap();
    // neither of the pack's externs is ours: both show their Markdown
    assert_eq!(h.page().page().missing(), vec!["badge/badge".to_string(), "badge/seal".to_string()]);
    assert!(check::all(h.root()).iter().any(|n| n.role() == Role::Blockquote));

    // the pack's own widget for egui, registered as an app registers it
    fn badge(ui: &mut egui::Ui, p: &Props<'_>, ctx: &mut Ctx<'_>) {
        let text = format!("{}: {}", p.text("label"), p.text("count"));
        ctx.root(ui, egui::UiBuilder::new().accessibility_role(Role::Status).accessibility_label(text.clone()), |ui, _| {
            ui.label(text);
        });
    }
    let page = Page::new(common::ir(&doc, &["targets/checks/packs/badge"]), PageOptions::default()).unwrap();
    let mut h = Headless::new(MkpPage::new(page).follow_theme(false).widget("badge/badge", || badge as fn(&mut egui::Ui, &Props<'_>, &mut Ctx<'_>)), egui::vec2(640.0, 480.0), false);
    h.settle().unwrap();
    assert_eq!(h.page().page().missing(), vec!["badge/seal".to_string()]);
    assert_eq!(node(&h, "badge@s1/s0").label().as_deref(), Some("Votes: 2"));
    let at = center(&h, "press@s1/s1");
    h.click_at(at);
    h.settle().unwrap();
    assert_eq!(node(&h, "badge@s1/s0").label().as_deref(), Some("Votes: 3"));
}

#[test]
fn an_apps_widget_replaces_ours() {
    struct Shout;
    impl mkp_egui::Widget for Shout {
        fn show(&mut self, ui: &mut egui::Ui, p: &Props<'_>, ctx: &mut Ctx<'_>) {
            let loud = p.text("value").to_uppercase();
            ctx.root(ui, egui::UiBuilder::new(), |ui, _| {
                ui.label(loud);
            });
        }
    }
    let page = Page::new(common::ir("widget sample() {\n    view {\n        @label(value = \"quiet\");\n    }\n}\n@@@\n@sample;\n", &[]), PageOptions::default()).unwrap();
    let mut h = Headless::new(MkpPage::new(page).widget("core/label", || Shout), egui::vec2(320.0, 240.0), false);
    h.settle().unwrap();
    assert_eq!(check::text(&node(&h, "label@s0/s0")), "QUIET");
    assert!(h.page().page().missing().is_empty());
}

const PLANE: &str = r#"widget sample() {
    view {
        @plane(label = "A map", width = size.M, aspect = 2, bounds = region { from = point { x = -400, y = -300 }, to = point { x = 400, y = 300 } }) {
            items {
                @spot(at = point { x = 100, y = 40 }, anchor = anchor.SW) {
                    @label(value = "Home");
                }
            }
        }
    }
}
@@@
@sample;
"#;

fn region(v: Option<&Value>) -> Option<((f64, f64), (f64, f64))> {
    mkp_egui::values::region(v)
}

#[test]
fn a_spot_reports_its_box_from_the_fixed_sizes() {
    let mut h = common::mount(PLANE);
    let spot = h.page().page().find("s0/s1").cloned().unwrap();
    // "Home" is 4 characters of 8 by 20, its south-west corner on its point
    assert_eq!(region(spot.props.get("box")), Some(((100.0, 40.0), (132.0, 60.0))));
    let plane = h.page().page().find("s0/s0").cloned().unwrap();
    assert_eq!(region(plane.props.get("drawn")), Some(((-160.0, -80.0), (160.0, 80.0))));
}

#[test]
fn a_spot_reports_its_box_from_what_egui_drew() {
    let mut h = common::mount_measured(PLANE, &[]);
    let spot = h.page().page().find("s0/s1").cloned().unwrap();
    let ((fx, fy), (tx, ty)) = region(spot.props.get("box")).expect("a box, after the first layout");
    assert_eq!((fx, fy), (100.0, 40.0));
    // the label's own size in points, which the plane's zoom never changes
    let label = check::rect(&node(&h, "label@s0/s2")).unwrap();
    assert_eq!((tx - fx, ty - fy), (label.width().round() as f64, label.height().round() as f64));
    // and its box stays put while the reader pans: no write while the view moves
    let view = center(&h, "plane.view");
    h.drag(view, egui::vec2(-100.0, 0.0));
    h.settle().unwrap();
    let plane = h.page().page().find("s0/s0").cloned().unwrap();
    assert_eq!(mkp_egui::values::point(plane.props.get("center")), Some((100.0, 0.0)));
    let again = h.page().page().find("s0/s1").cloned().unwrap();
    assert_eq!(region(again.props.get("box")), Some(((fx, fy), (tx, ty))));
}

#[test]
fn the_plane_pans_with_the_arrow_keys_and_zooms_only_within_its_range() {
    let mut h = common::mount(PLANE);
    let id = node(&h, "plane.view").locate();
    h.focus(id);
    h.settle().unwrap();
    h.key("ArrowRight").unwrap();
    h.key("ArrowUp").unwrap();
    // zoom_range is 1..1 by default: + does nothing
    h.key("Equal").unwrap();
    h.settle().unwrap();
    let plane = h.page().page().find("s0/s0").cloned().unwrap();
    assert_eq!(mkp_egui::values::point(plane.props.get("center")), Some((40.0, 40.0)));
    assert_eq!(mkp_egui::values::num(plane.props.get("zoom")), Some(1.0));
}

#[test]
fn a_layout_that_never_settles_is_held() {
    // the graphs example's edge labels get new keys at every redraw, so their own boxes are never
    // kept: egui, which lays out every frame, stops after a few frames instead of running on
    let doc = std::fs::read_to_string(common::repo().join("targets/checks/cases/graphs/release-flow.mkp.md")).unwrap();
    let mut h = common::mount_with(&doc, &["examples/graphs"]);
    assert!(h.harness.try_run().is_ok());
    let nodes: Vec<_> = (0..3).map(|k| h.page().page().find(&format!("s1/s5[{}]/s7", k)).and_then(|d| region(d.props.get("box")))).collect();
    assert!(nodes.iter().all(Option::is_some), "the graph's nodes have their boxes: {:?}", nodes);
}

#[test]
fn a_widget_that_failed_is_a_notice() {
    let h = common::mount(
        r#"$state {
    parts: int 0... = 0;
}

widget share() {
    view {
        @label(value = "Each: \{100 / $state.parts}");
    }
}
@@@
@share;
"#,
    );
    let alert = check::all(h.root()).into_iter().find(|n| n.role() == Role::Alert).expect("a notice");
    assert!(alert.label().unwrap_or_default().contains("failed"));
}

#[test]
fn the_page_follows_egui_s_theme() {
    let page = Page::new(common::ir("Hello\n", &[]), MkpPage::options()).unwrap();
    let mut h = Headless::new(MkpPage::new(page), egui::vec2(320.0, 240.0), true);
    h.settle().unwrap();
    let md = h.page().page().eval(&mkp_egui::runtime::ir::Expr::Get(mkp_egui::runtime::ir::Get::Extern("core/page.theme".into()))).unwrap();
    assert_eq!(mkp_egui::values::case(Some(&md)), Some("DARK"));
}

#[test]
fn the_example_s_page_draws_every_widget_it_uses() {
    let h = common::mount_measured(include_str!("../examples/demo.mkp.md"), &[]);
    let mut h = h;
    assert!(h.page().page().missing().is_empty());
    let all = check::all(h.root());
    for role in [Role::Heading, Role::TextInput, Role::Slider, Role::CheckBox, Role::Math] {
        assert!(all.iter().any(|n| n.role() == role), "no {:?} on the page", role);
    }
    assert!(all.iter().any(|n| n.author_id() == Some("plane.view")));
    assert!(h.page().take_errors().is_empty());
}

#[test]
fn two_pages_share_a_window() {
    let page = |text: &str| Page::new(common::ir(text, &[]), MkpPage::options()).unwrap();
    let mut a = MkpPage::new(page(PRESS)).id(egui::Id::unique("a"));
    let mut b = MkpPage::new(page(PRESS)).id(egui::Id::unique("b"));
    let mut h = egui_kittest::Harness::builder().with_size(egui::vec2(640.0, 480.0)).with_accessibility_check(false).build_ui(move |ui| {
        a.show(ui);
        b.show(ui);
    });
    h.run();
    // each page's press is in the tree once, with an id of its own
    let presses: Vec<_> = check::all(h.kittest_state().root()).into_iter().filter(|n| n.author_id() == Some("press@s0/s0")).map(|n| n.id()).collect();
    assert_eq!(presses.len(), 2);
    assert_ne!(presses[0], presses[1]);
}

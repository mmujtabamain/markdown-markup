//! Layout: flex as egui's horizontal and vertical layouts, grid as columns placed by hand (with
//! spans and explicit rows and columns), cell as a grid item, and sizing as the limits it says.
//! Lengths are core's tokens.

use std::collections::HashMap;

use egui::accesskit::{Orientation, Role};
use egui::{Align, Layout, Rect, Sense, Shape, Stroke, Ui, UiBuilder};
use xtmd_runtime::Drawn;

use super::kit;
use crate::values::{case, field, list, num};
use crate::{a11y, Act, Ctx, Props, Widget};

/// Which sides an edge draws: top, right, bottom, left.
fn edges(name: Option<&str>) -> [bool; 4] {
    match name {
        Some("TOP") => [true, false, false, false],
        Some("RIGHT") => [false, true, false, false],
        Some("BOTTOM") => [false, false, true, false],
        Some("LEFT") => [false, false, false, true],
        Some("X") => [false, true, false, true],
        Some("Y") => [true, false, true, false],
        _ => [true, true, true, true],
    }
}

/// The look flex and grid share: padding, fill, stroke on its edges, radius and shadow.
struct Look {
    pad: f32,
    gap: f32,
    fill: Option<egui::Color32>,
    stroke: Option<egui::Color32>,
    edges: [bool; 4],
    radius: f32,
    shadow: Option<egui::Color32>,
}

fn look_of(p: &Props<'_>, ctx: &Ctx<'_>) -> Look {
    Look {
        pad: ctx.length(p.get("pad")).unwrap_or(0.0),
        gap: ctx.length(p.get("gap")).unwrap_or(0.0),
        fill: ctx.color(p.get("fill")),
        stroke: ctx.color(p.get("stroke")),
        edges: edges(p.case("edge")),
        radius: ctx.length(p.get("radius")).unwrap_or(0.0).min(999.0),
        shadow: crate::values::inner(p.get("shadow")).and_then(|s| {
            let v = ctx.look().value(ctx.page(), Some(s));
            ctx.color(field(v.as_ref(), "tone"))
        }),
    }
}

/// Paints the box behind what was drawn in it.
fn paint_box(ui: &Ui, idx: egui::layers::ShapeIdx, rect: Rect, l: &Look) {
    let mut shapes = Vec::new();
    if let Some(s) = l.shadow {
        shapes.push(Shape::rect_filled(rect.translate(egui::vec2(0.0, 1.0)).expand(1.5), l.radius, s));
    }
    if let Some(f) = l.fill {
        shapes.push(Shape::rect_filled(rect, l.radius, f));
    }
    if let Some(c) = l.stroke {
        let st = Stroke::new(1.0, c);
        if l.edges == [true; 4] {
            shapes.push(Shape::rect_stroke(rect, l.radius, st, egui::StrokeKind::Inside));
        } else {
            let r = rect.shrink(0.5);
            let sides = [[r.left_top(), r.right_top()], [r.right_top(), r.right_bottom()], [r.left_bottom(), r.right_bottom()], [r.left_top(), r.left_bottom()]];
            for (k, on) in l.edges.iter().enumerate() {
                if *on {
                    shapes.push(Shape::line_segment(sides[k], st));
                }
            }
        }
    }
    kit::fill_behind(ui, idx, Shape::Vec(shapes));
}

/// The ARIA group a run of tabs, options or radios makes.
fn group_role(nodes: &[Drawn]) -> Option<Role> {
    if nodes.is_empty() || !nodes.iter().all(|n| n.widget == "core/press") {
        return None;
    }
    let first = case(nodes[0].props.get("kind"));
    if !nodes.iter().all(|n| case(n.props.get("kind")) == first) {
        return None;
    }
    match first {
        Some("TAB") => Some(Role::TabList),
        Some("OPTION") => Some(Role::ListBox),
        Some("RADIO") => Some(Role::RadioGroup),
        _ => None,
    }
}

/// A container whose click does something: clickable, and pressed from the keyboard too (egui
/// gives a focused clickable Enter and Space). Its click is taken here.
fn clicks(ctx: &mut Ctx<'_>, response: &egui::Response, on: bool) {
    while let Some(a) = ctx.take_act() {
        match a {
            Act::Event { name, .. } if name == "click" && on => ctx.event("click", Vec::new()),
            other => ctx.decline(other),
        }
    }
    if on && response.clicked() {
        response.request_focus();
        ctx.event("click", Vec::new());
    }
}

pub fn flex(ui: &mut Ui, p: &Props<'_>, ctx: &mut Ctx<'_>) {
    let across = p.case("axis") == Some("X");
    let l = look_of(p, ctx);
    let label = p.text("label");
    let kids = p.slot("children");
    let on = ctx.listens("click");
    let cross = match p.case("align") {
        Some("START") | Some("BASELINE") => Align::Min,
        Some("CENTER") => Align::Center,
        Some("END") => Align::Max,
        _ => Align::Min,
    };
    let stretch = matches!(p.case("align"), None | Some("STRETCH"));
    let main = match p.case("justify") {
        Some("CENTER") => Align::Center,
        Some("END") => Align::Max,
        _ => Align::Min,
    };
    let mut layout = if across { Layout::left_to_right(cross) } else { Layout::top_down(cross) };
    layout = layout.with_main_wrap(p.flag("wrap", false)).with_cross_justify(stretch && !across).with_main_align(main);
    let role = if on { Role::Button } else { group_role(kids).unwrap_or(if label.is_empty() { Role::GenericContainer } else { Role::Group }) };
    let mut b = UiBuilder::new().layout(layout).accessibility_role(role);
    if on {
        b = b.sense(Sense::click());
    }
    if !label.is_empty() {
        b = b.accessibility_label(label);
    }
    let r = ctx.root(ui, b, |ui, ctx| {
        a11y::edit(ui, ui.unique_id(), |n| {
            n.set_class_name(if across { "x" } else { "y" });
            if group_role(kids).is_some() {
                n.set_orientation(if across { Orientation::Horizontal } else { Orientation::Vertical });
            }
        });
        let idx = kit::behind(ui);
        ui.spacing_mut().item_spacing = egui::vec2(l.gap, l.gap);
        let inner = egui::Frame::new().inner_margin(l.pad).show(ui, |ui| {
            ui.spacing_mut().item_spacing = egui::vec2(l.gap, l.gap);
            for d in kids {
                ctx.child(ui, d);
            }
        });
        let rect = inner.response.rect;
        paint_box(ui, idx, rect, &l);
        if on && ui.response().has_focus() {
            kit::focus_ring(ui, rect, l.radius);
        }
    });
    clicks(ctx, &r.response, on);
}

/// One track of a grid's columns: a share of the room left, or a length.
#[derive(Clone, Copy, Debug)]
enum Track {
    Fr(f32),
    Len(f32),
}

fn tracks(p: &Props<'_>, ctx: &Ctx<'_>) -> Vec<Track> {
    let c = p.get("cols");
    match case(c) {
        Some("EQUAL") => vec![Track::Fr(1.0); num(field(c, "count")).unwrap_or(1.0).round().max(1.0) as usize],
        Some("TRACKS") => list(field(c, "of"))
            .into_iter()
            .map(|t| match case(Some(t)) {
                Some("FR") => Track::Fr(num(field(Some(t), "share")).unwrap_or(1.0) as f32),
                Some("CH") => Track::Len(num(field(Some(t), "count")).unwrap_or(1.0) as f32 * 8.0),
                Some("SIZE") => Track::Len(ctx.length(field(Some(t), "of")).unwrap_or(80.0)),
                // a track sized to its content: a share of what is left
                _ => Track::Fr(1.0),
            })
            .collect(),
        _ => vec![Track::Fr(1.0)],
    }
}

/// Columns placed by hand: each child in its cell, a cell child by its row, column and span; a row
/// as high as its highest cell in the last frame.
#[derive(Default)]
pub struct Grid {
    rows: HashMap<usize, f32>,
}

impl Widget for Grid {
    fn show(&mut self, ui: &mut Ui, p: &Props<'_>, ctx: &mut Ctx<'_>) {
        let l = look_of(p, ctx);
        let on = ctx.listens("click");
        let tracks = tracks(p, ctx);
        let kids = p.slot("children");
        let n = tracks.len().max(1);
        let mut b = UiBuilder::new().accessibility_role(if on { Role::Button } else { Role::GenericContainer });
        if on {
            b = b.sense(Sense::click());
        }
        let rows = &mut self.rows;
        let r = ctx.root(ui, b, |ui, ctx| {
            let idx = kit::behind(ui);
            let inner = egui::Frame::new().inner_margin(l.pad).show(ui, |ui| {
                let room = kit::room(ui);
                let width = if room.is_finite() { room } else { crate::measure::PAGE_WIDTH as f32 / 2.0 };
                let fixed: f32 = tracks.iter().map(|t| if let Track::Len(x) = t { *x } else { 0.0 }).sum();
                let shares: f32 = tracks.iter().map(|t| if let Track::Fr(x) = t { *x } else { 0.0 }).sum();
                let room = (width - fixed - l.gap * (n as f32 - 1.0)).max(0.0);
                let widths: Vec<f32> = tracks.iter().map(|t| match t { Track::Len(x) => *x, Track::Fr(s) => if shares > 0.0 { room * s / shares } else { 0.0 } }).collect();
                let mut xs = vec![0.0; n + 1];
                for k in 0..n {
                    xs[k + 1] = xs[k] + widths[k] + if k + 1 < n { l.gap } else { 0.0 };
                }
                // where each child goes: (row, column, span), the cells' own places first
                let mut taken: HashMap<(usize, usize), bool> = HashMap::new();
                let mut places = Vec::new();
                let (mut row, mut col) = (0usize, 0usize);
                for d in kids {
                    let span = if d.widget == "core/cell" { num(d.props.get("span")).unwrap_or(1.0).round().max(1.0) as usize } else { 1 }.min(n);
                    let want_row = if d.widget == "core/cell" { num(d.props.get("row")).map(|r| (r.round().max(1.0) as usize) - 1) } else { None };
                    let want_col = if d.widget == "core/cell" { num(d.props.get("col")).map(|c| ((c.round().max(1.0) as usize) - 1).min(n - 1)) } else { None };
                    let (r, c) = match (want_row, want_col) {
                        (Some(r), Some(c)) => (r, c),
                        _ => {
                            loop {
                                if col + span > n {
                                    row += 1;
                                    col = 0;
                                }
                                if (col..col + span).all(|c| !taken.contains_key(&(row, c))) {
                                    break;
                                }
                                col += 1;
                            }
                            (want_row.unwrap_or(row), col)
                        }
                    };
                    for c in c..(c + span).min(n) {
                        taken.insert((r, c), true);
                    }
                    if want_row.is_none() || want_col.is_none() {
                        col = c + span;
                    }
                    places.push((r, c, span));
                }
                let last = places.iter().map(|p| p.0).max().map_or(0, |r| r + 1);
                let mut ys = vec![0.0; last + 1];
                for k in 0..last {
                    ys[k + 1] = ys[k] + rows.get(&k).copied().unwrap_or(20.0) + if k + 1 < last { l.gap } else { 0.0 };
                }
                let origin = ui.cursor().min;
                let mut heights: HashMap<usize, f32> = HashMap::new();
                for (d, (r, c, span)) in kids.iter().zip(places) {
                    let min = origin + egui::vec2(xs[c], ys[r]);
                    let w = xs[(c + span).min(n)] - xs[c] - if c + span < n { l.gap } else { 0.0 };
                    let cell = Rect::from_min_size(min, egui::vec2(w.max(0.0), f32::INFINITY));
                    let mut child = ui.new_child(UiBuilder::new().max_rect(cell).layout(Layout::top_down(Align::Min)));
                    ctx.child(&mut child, d);
                    let h = child.min_rect().height();
                    let e = heights.entry(r).or_insert(0.0);
                    *e = e.max(h);
                }
                let total = Rect::from_min_size(origin, egui::vec2(width, ys[last]));
                ui.allocate_rect(total, Sense::hover());
                if heights.iter().any(|(k, h)| rows.get(k).is_none_or(|was| (was - h).abs() > 0.5)) || rows.len() != heights.len() {
                    ui.ctx().request_repaint();
                }
                *rows = heights;
            });
            let rect = inner.response.rect;
            paint_box(ui, idx, rect, &l);
            if on && ui.response().has_focus() {
                kit::focus_ring(ui, rect, l.radius);
            }
        });
        clicks(ctx, &r.response, on);
    }
}

pub fn cell(ui: &mut Ui, p: &Props<'_>, ctx: &mut Ctx<'_>) {
    let place = match p.case("place") {
        Some("CENTER") => Some(Align::Center),
        Some("END") => Some(Align::Max),
        Some("START") | Some("BASELINE") => Some(Align::Min),
        _ => None,
    };
    let layout = match place {
        Some(a) => Layout::top_down(a),
        None => Layout::top_down(Align::Min).with_cross_justify(true),
    };
    ctx.root(ui, UiBuilder::new().layout(layout), |ui, ctx| {
        ctx.slot(ui, "child");
    });
}

pub fn sizing(ui: &mut Ui, p: &Props<'_>, ctx: &mut Ctx<'_>) {
    let len = |k: &str| ctx.length(p.get(k));
    let (basis, min_w, min_h, max_w, max_h) = (len("basis"), len("min_width"), len("min_height"), len("max_width"), len("max_height"));
    let grow = p.num("grow").unwrap_or(0.0);
    let aspect = p.num("aspect");
    ctx.root(ui, UiBuilder::new().layout(Layout::top_down(Align::Min)), |ui, ctx| {
        if let Some(w) = max_w {
            ui.set_max_width(w);
        }
        if let Some(h) = max_h {
            ui.set_max_height(h);
        }
        let mut least = basis.unwrap_or(0.0).max(min_w.unwrap_or(0.0));
        let room = kit::room(ui);
        if grow > 0.0 && room.is_finite() {
            // a grown item takes the room left on its line
            least = least.max(room);
        }
        if let Some(w) = max_w {
            least = least.min(w);
        }
        ui.set_min_width(least);
        if let Some(h) = min_h {
            ui.set_min_height(h);
        }
        if let Some(a) = aspect.filter(|a| *a > 0.0) {
            ui.set_min_height(ui.min_rect().width().max(least) / a as f32);
        }
        ctx.slot(ui, "child");
    });
}

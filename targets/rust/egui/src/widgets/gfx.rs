//! core.gfx painted with egui: a canvas (or a plane) gives its shapes a space (its units, y up,
//! onto the ui's points), layers are groups with an opacity and a clip, and shapes are painted in
//! it, each with a node of its own when it has a name or an event. `place` puts ordinary widgets at
//! a point; `handle` is dragged; `shade` is painted on the CPU from its shader, bounded as
//! @mkp/dom's is.

use std::rc::Rc;
use std::time::{Duration, Instant};

use egui::accesskit::Role;
use egui::{Color32, Pos2, Rect, Sense, Shape as EShape, Stroke, Ui, UiBuilder};
use mkp_eval::value::Record;
use mkp_runtime::{Num, Value};

use super::kit;
use crate::values::{self, exact, field, list, num, places_for, point, region, to_f64, to_num};
use crate::{a11y, Act, Ctx, Props, Space, Widget};

/// The space shapes are drawn in: the canvas's or plane's, or, outside any, points from the ui's
/// cursor, y up.
fn space_of(ui: &Ui, ctx: &Ctx<'_>) -> Space {
    ctx.space().unwrap_or_else(|| {
        let rect = Rect::from_min_size(ui.cursor().min, egui::vec2(320.0, 320.0));
        Space::canvas(rect, (0.0, 320.0), (0.0, 320.0))
    })
}

/// A stroke's width in points: a stroke token, or stroke.PX's number.
fn stroke_width(p: &Props<'_>, ctx: &Ctx<'_>) -> f32 {
    let v = ctx.look().value(ctx.page(), p.get("width"));
    match v {
        Some(Value::Num(n)) => to_f64(&n) as f32,
        _ => 1.0,
    }
}

fn faded(c: Color32, opacity: f32) -> Color32 {
    c.gamma_multiply(opacity.clamp(0.0, 1.0))
}

// ---- canvas

pub fn canvas(ui: &mut Ui, p: &Props<'_>, ctx: &mut Ctx<'_>) {
    let ends = |k: &str| match values::range(p.get(k)) {
        Some((lo, hi, _)) => (lo.unwrap_or(-1.0), hi.unwrap_or(1.0)),
        None => (-1.0, 1.0),
    };
    let (xr, yr) = (ends("x"), ends("y"));
    let w = ctx.length(p.get("width")).unwrap_or(320.0);
    let aspect = p.num("aspect").unwrap_or((xr.1 - xr.0) / (yr.1 - yr.0).max(f64::MIN_POSITIVE));
    let h = w / (if aspect > 0.0 { aspect as f32 } else { 1.0 });
    let label = p.text("label");
    let on = ctx.listens("click");
    let line = ctx.core_color("LINE");
    let mut b = UiBuilder::new().accessibility_role(Role::Group);
    if !label.is_empty() {
        b = b.accessibility_label(label);
    }
    ctx.root(ui, b, |ui, ctx| {
        let surface = ctx.sub_id("surface");
        let (rect, _) = ui.allocate_exact_size(egui::vec2(w, h), Sense::hover());
        let r = ui.interact(rect, surface, if on { Sense::click() } else { Sense::hover() });
        ui.painter().rect_stroke(rect, 0.0, Stroke::new(1.0, line.gamma_multiply(0.6)), egui::StrokeKind::Inside);
        a11y::edit(ui, surface, |n| n.set_role(if on { Role::Button } else { Role::Canvas }));
        a11y::bounds(ui, surface, rect);
        ctx.part(ui, surface, "surface");
        let space = Space::canvas(rect, xr, yr);
        let mut inside = ui.new_child(UiBuilder::new().max_rect(rect).layout(egui::Layout::top_down(egui::Align::Min)));
        inside.set_clip_rect(rect.intersect(ui.clip_rect()));
        ctx.in_space(space, |ctx| ctx.slot(&mut inside, "layers"));
        if on && r.clicked() {
            if let Some(pos) = r.interact_pointer_pos() {
                let (x, y) = space.to_units(pos);
                let pl = places_for(space.units_per_px);
                ctx.event("click", vec![values::point_value(to_num(x, pl), to_num(y, pl))]);
            }
        }
    });
}

// ---- layer

pub fn layer(ui: &mut Ui, p: &Props<'_>, ctx: &mut Ctx<'_>) {
    let space = space_of(ui, ctx);
    let opacity = p.num("opacity").unwrap_or(1.0) as f32;
    let clip = region(p.get("clip")).map(|(a, b)| Rect::from_two_pos(space.to_screen(a), space.to_screen(b)));
    let area = clip.map_or(space.rect, |c| c.intersect(space.rect));
    let all = if space.bounded { space.rect } else { ui.clip_rect() };
    ctx.root(ui, UiBuilder::new().max_rect(all), |ui, ctx| {
        ui.set_opacity(opacity);
        let shapes = ctx.sub_id("shapes");
        let mut s = ui.new_child(UiBuilder::new().scope_id(shapes).max_rect(all));
        if let Some(c) = clip {
            s.set_clip_rect(c.intersect(s.clip_rect()));
        }
        ctx.part(&s, shapes, "shapes");
        ctx.slot(&mut s, "shapes");
        a11y::bounds(&s, shapes, area);
        drop(s);
        if space.bounded {
            ui.expand_to_include_rect(space.rect);
        }
    });
}

// ---- circle and path

/// A circle or a path: painted in its space, with a node when it has a name or an event. A press
/// on it clicks it; the pointer or the keyboard's focus on it enters it.
#[derive(Default)]
pub struct Shape {
    inside: bool,
}

impl Widget for Shape {
    fn show(&mut self, ui: &mut Ui, p: &Props<'_>, ctx: &mut Ctx<'_>) {
        let space = space_of(ui, ctx);
        let circle = ctx.drawn().widget == "core/circle";
        let opacity = p.num("opacity").unwrap_or(1.0) as f32;
        let width = stroke_width(p, ctx);
        let fill = ctx.color(p.get("fill")).map(|c| faded(c, opacity));
        let stroke = ctx.color(p.get("stroke")).map(|c| faded(c, opacity));
        let label = p.text("label");
        let click = ctx.listens("click");
        let hover = ctx.listens("enter") || ctx.listens("leave");
        // what is painted, and the box a pointer finds it in
        let (shapes, bbox, line_box, head_box) = if circle {
            let c = space.to_screen(point(p.get("at")).unwrap_or((0.0, 0.0)));
            let r = space.len(p.num("r").unwrap_or(0.0)).abs();
            let mut out = Vec::new();
            if let Some(f) = fill {
                out.push(EShape::circle_filled(c, r, f));
            }
            if let Some(s) = stroke {
                out.push(EShape::circle_stroke(c, r, Stroke::new(width, s)));
            }
            let b = Rect::from_center_size(c, egui::vec2(2.0 * r, 2.0 * r));
            (out, b, b, None)
        } else {
            let pts: Vec<Pos2> = list(p.get("points")).into_iter().filter_map(|v| point(Some(v))).map(|q| space.to_screen(q)).collect();
            let closed = p.flag("closed", false);
            let dash = p.flag("dash", false);
            let mut out = Vec::new();
            if closed && pts.len() > 2 {
                if let Some(f) = fill {
                    out.push(EShape::convex_polygon(pts.clone(), f, Stroke::NONE));
                }
            }
            if let Some(s) = stroke {
                let st = Stroke::new(width, s);
                let mut line = pts.clone();
                if closed && pts.len() > 2 {
                    line.push(pts[0]);
                }
                if dash {
                    out.extend(EShape::dashed_line(&line, st, width * 4.0, width * 3.0));
                } else {
                    out.push(EShape::line(line, st));
                }
            }
            let lb = Rect::from_points(&pts);
            // the head at the last point, along the last segment, in the stroke's colour
            let kind = p.case("head").unwrap_or("NONE");
            let mut head = None;
            if let (Some(a), Some(b), true) = (pts.len().checked_sub(2).map(|k| pts[k]), pts.last().copied(), kind != "NONE") {
                let d = (b - a).normalized();
                let size = 4.0 + width * 3.0;
                let color = stroke.unwrap_or(Color32::TRANSPARENT);
                if kind == "ARROW" {
                    let back = b - d * size;
                    let n = egui::vec2(-d.y, d.x) * size * 0.5;
                    out.push(EShape::convex_polygon(vec![b, back + n, back - n], color, Stroke::NONE));
                    head = Some(Rect::from_points(&[b, back + n, back - n]));
                } else {
                    out.push(EShape::circle_filled(b, size * 0.4, color));
                    head = Some(Rect::from_center_size(b, egui::vec2(size * 0.8, size * 0.8)));
                }
            }
            let bbox = head.map_or(lb, |h| lb.union(h));
            (out, bbox, lb, head)
        };
        let bbox = bbox.expand(if circle { 0.0 } else { (width / 2.0).max(2.0) });
        let sense = if click { Sense::click() } else if hover { Sense::hover() | Sense::focusable_noninteractive() } else { Sense::hover() };
        let named = !label.is_empty();
        let role = if click { Role::Button } else if named { Role::Image } else { Role::GenericContainer };
        let mut b = UiBuilder::new().max_rect(bbox).sense(sense).accessibility_role(role);
        if named {
            b = b.accessibility_label(label);
        }
        let r = ctx.root(ui, b, |ui, ctx| {
            ui.painter().extend(shapes);
            ui.expand_to_include_rect(bbox);
            if !circle {
                let line = ctx.sub_id("line");
                a11y::node(ui, line, line_box, Role::GraphicsSymbol);
                ctx.part(ui, line, "line");
                if let Some(h) = head_box {
                    let id = ctx.sub_id("head");
                    a11y::node(ui, id, h, Role::GraphicsSymbol);
                    ctx.part(ui, id, "head");
                }
            }
            if ui.response().has_focus() {
                kit::focus_ring(ui, bbox, 2.0);
            }
        });
        let resp = r.response;
        while let Some(a) = ctx.take_act() {
            match a {
                Act::Event { name, .. } if name == "click" && click => ctx.event("click", Vec::new()),
                Act::Event { name, .. } if (name == "enter" || name == "leave") && hover => ctx.event(&name, Vec::new()),
                other => ctx.decline(other),
            }
        }
        // inside while the pointer is over it, or while the keyboard's focus is on it
        if hover {
            let now = resp.hovered() || resp.has_focus();
            if now != self.inside {
                self.inside = now;
                ctx.event(if now { "enter" } else { "leave" }, Vec::new());
            }
        }
        if click && resp.clicked() {
            resp.request_focus();
            ctx.event("click", Vec::new());
        }
    }
}

// ---- place: ordinary widgets at a point

/// Widgets at a point of the canvas, hung from it by their anchor, nudged in points, y up.
#[derive(Default)]
pub struct Place {
    size: egui::Vec2,
}

impl Widget for Place {
    fn show(&mut self, ui: &mut Ui, p: &Props<'_>, ctx: &mut Ctx<'_>) {
        let space = space_of(ui, ctx);
        let at = space.to_screen(point(p.get("at")).unwrap_or((0.0, 0.0)));
        let nudge = point(p.get("nudge")).unwrap_or((0.0, 0.0));
        let at = at + egui::vec2(nudge.0 as f32, -nudge.1 as f32);
        let anchor = p.case("anchor").unwrap_or("CENTER").to_string();
        let opacity = p.num("opacity").unwrap_or(1.0) as f32;
        let label = p.text("label");
        let rect = kit::anchored(at, &anchor, self.size);
        let mut size = self.size;
        ctx.root(ui, UiBuilder::new().max_rect(Rect::from_min_size(rect.min, egui::vec2(f32::INFINITY, f32::INFINITY))), |ui, ctx| {
            ui.set_opacity(opacity);
            let id = ctx.sub_id("box");
            let mut b = UiBuilder::new().scope_id(id).layout(egui::Layout::top_down(egui::Align::Min)).sizing_pass();
            if !label.is_empty() {
                b = b.accessibility_role(Role::Group).accessibility_label(label.clone());
            }
            let r = ui.scope_builder(b, |ui| {
                ctx.part(ui, id, "box");
                ctx.slot(ui, "child");
            });
            a11y::bounds(ui, id, r.response.rect);
            size = r.response.rect.size();
        });
        if (size - self.size).length() > 0.5 {
            self.size = size;
            ui.ctx().request_repaint();
        }
    }
}

// ---- handle

/// A point the reader drags, or moves with the arrow keys: 8 points a press, 40 with Shift.
#[derive(Default)]
pub struct Handle;

impl Widget for Handle {
    fn show(&mut self, ui: &mut Ui, p: &Props<'_>, ctx: &mut Ctx<'_>) {
        let space = space_of(ui, ctx);
        let at = point(p.get("at")).unwrap_or((0.0, 0.0));
        let c = space.to_screen(at);
        let opacity = p.num("opacity").unwrap_or(1.0) as f32;
        let tone = faded(ctx.color(p.get("tone")).unwrap_or_else(|| ctx.core_color("ACCENT")), opacity);
        let label = p.text("label");
        let shown = format!("({}, {})", exact(field(p.get("at"), "x")).map_or("0".into(), |n| n.show()), exact(field(p.get("at"), "y")).map_or("0".into(), |n| n.show()));
        let hit = Rect::from_center_size(c, egui::vec2(28.0, 28.0));
        let id = ctx.id();
        let mut want: Option<(f64, f64)> = None;
        let r = ctx.root(ui, UiBuilder::new().max_rect(hit).sense(Sense::click_and_drag()).accessibility_role(Role::Slider).accessibility_label(label), |ui, ctx| {
            ui.expand_to_include_rect(hit);
            let resp = ui.response();
            ui.painter().circle_filled(c, 7.0, tone);
            ui.painter().circle_stroke(c, 7.0, Stroke::new(1.5, ctx.core_color("SURFACE")));
            if resp.has_focus() {
                kit::focus_ring(ui, Rect::from_center_size(c, egui::vec2(14.0, 14.0)), 7.0);
            }
            a11y::edit(ui, id, |n| n.set_value(shown));
            let dot = ctx.sub_id("dot");
            a11y::node(ui, dot, Rect::from_center_size(c, egui::vec2(14.0, 14.0)), Role::GraphicsSymbol);
            ctx.part(ui, dot, "dot");
            let hitn = ctx.sub_id("hit");
            a11y::node(ui, hitn, hit, Role::GraphicsSymbol);
            ctx.part(ui, hitn, "hit");
        });
        let resp = r.response;
        if resp.is_pointer_button_down_on() || resp.drag_started() {
            // the handle's drag, not the plane's pan around it
            resp.request_focus();
        }
        if resp.dragged() {
            if let Some(pos) = resp.interact_pointer_pos() {
                want = Some(space.to_units(pos));
            }
        }
        if resp.has_focus() {
            ui.memory_mut(|m| m.set_focus_lock_filter(id, egui::EventFilter { horizontal_arrows: true, vertical_arrows: true, ..Default::default() }));
            ui.input(|i| {
                let step = space.units_per_px * if i.modifiers.shift { 40.0 } else { 8.0 };
                for (k, d) in [(egui::Key::ArrowLeft, (-step, 0.0)), (egui::Key::ArrowRight, (step, 0.0)), (egui::Key::ArrowUp, (0.0, step)), (egui::Key::ArrowDown, (0.0, -step))] {
                    if i.key_pressed(k) {
                        let from = want.unwrap_or(at);
                        want = Some((from.0 + d.0, from.1 + d.1));
                    }
                }
            });
        }
        // no act: a drag lands on whole points, so a check's exact point goes through the page
        while let Some(a) = ctx.take_act() {
            ctx.decline(a);
        }
        if let Some(q) = want {
            let k = space.keep(q);
            let pl = places_for(space.units_per_px);
            let v = values::point_value(to_num(k.0, pl), to_num(k.1, pl));
            let now = p.get("at");
            if now.is_none_or(|n| !ctx.page().equal(n, &v).unwrap_or(false)) {
                ctx.write("at", v);
            }
        }
    }
}

// ---- shade: pixels from a shader

/// At most this many pixels are worked out per shade, scaled up to its size.
pub const MAX_SHADE_PIXELS: usize = 65536;

/// A shade being painted: its sampled pixels so far, and the texture they are shown with.
#[derive(Default)]
pub struct Shade {
    sig: String,
    texture: Option<egui::TextureHandle>,
    job: Option<Job>,
    state: &'static str,
}

struct Job {
    cols: usize,
    rows: usize,
    row: usize,
    pixels: Vec<Color32>,
    /// How long its samples took so far.
    took: Duration,
}

/// The most time a whole shade's samples may take: a shader written in MKP is slow, and the
/// shade has fewer samples for it, as @mkp/dom keeps the whole shade within the step limit.
pub const SHADE_TIME: Duration = Duration::from_millis(1500);

/// A value's identity for "did it change": its IR form, with fns by their code.
fn sig(v: Option<&Value>) -> String {
    match v {
        Some(Value::Fn(c)) => format!("fn:{:p}", Rc::as_ptr(&c.body)),
        Some(v) => serde_json::to_string(&v.to_ir()).unwrap_or_default(),
        None => String::new(),
    }
}

fn num_v(n: Num) -> Value {
    Value::Num(n)
}

/// One sample's colour, from the shader: each sample has the step limit to itself.
fn sample(ctx: &Ctx<'_>, shader: &Value, at: Value, px: &Value, args: &Value) -> Result<Color32, String> {
    let c = ctx.page().apply(shader, vec![at, px.clone(), args.clone()]).map_err(|f| f.message)?;
    let ch = |n: &str, or: f64| (255.0 * num(field(c.as_ref(), n)).unwrap_or(or).clamp(0.0, 1.0)).round() as u8;
    Ok(Color32::from_rgba_unmultiplied(ch("r", 0.0), ch("g", 0.0), ch("b", 0.0), ch("a", 1.0)))
}

fn pt(x: Num, y: Num) -> Value {
    Value::Record(Rc::new(Record { ty: Rc::from("core/point"), fields: vec![(Rc::from("x"), num_v(x)), (Rc::from("y"), num_v(y))] }))
}

/// The samples' middles of one row, or of every column, across an interval cut in `n`.
fn middles(lo: Num, hi: Num, n: usize) -> (Vec<Num>, Num) {
    let half = Num::parse("0.5").unwrap();
    let px = hi.sub(lo).and_then(|d| d.div(Num::int(n as i64))).unwrap_or_else(|_| Num::zero());
    let at = (0..n).map(|i| lo.add(px.mul(Num::int(i as i64).add(half).unwrap_or(half)).unwrap_or_else(|_| Num::zero())).unwrap_or(lo)).collect();
    (at, px)
}

impl Shade {
    /// Works out rows of the job for up to `budget` of time.
    fn work(&mut self, ctx: &Ctx<'_>, shader: &Value, args: &Value, area: ((Num, Num), (Num, Num)), budget: Duration) -> Result<bool, String> {
        let Some(job) = &mut self.job else { return Ok(true) };
        let ((lx, ly), (hx, hy)) = area;
        let (xs, px) = middles(lx, hx, job.cols);
        let (ys, _) = middles(ly, hy, job.rows);
        let size = num_v(px);
        let start = Instant::now();
        let until = start + budget;
        while job.row < job.rows {
            // rows from the top: the highest y first
            let y = ys[job.rows - 1 - job.row];
            for x in &xs {
                job.pixels.push(sample(ctx, shader, pt(*x, y), &size, args)?);
            }
            job.row += 1;
            if Instant::now() > until {
                break;
            }
        }
        job.took += start.elapsed();
        if job.took > SHADE_TIME * 4 {
            return Err("the shader took too long".into());
        }
        Ok(job.row >= job.rows)
    }
}

impl Widget for Shade {
    fn show(&mut self, ui: &mut Ui, p: &Props<'_>, ctx: &mut Ctx<'_>) {
        let space = space_of(ui, ctx);
        let label = p.text("label");
        let opacity = p.num("opacity").unwrap_or(1.0) as f32;
        let area = p.get("area");
        let exact_pt = |v: Option<&Value>| Some((exact(field(v, "x"))?, exact(field(v, "y"))?));
        let corners = exact_pt(field(area, "from")).zip(exact_pt(field(area, "to")));
        let rect = region(area).map(|(a, b)| Rect::from_two_pos(space.to_screen(a), space.to_screen(b)));
        let shader = values::inner(p.get("shader")).cloned();
        let args = p.get("args").cloned().unwrap_or_else(Value::none);
        if let (Some(rect), Some(((fx, fy), (tx, ty))), Some(f @ Value::Fn(_))) = (rect, corners, &shader) {
            let lo = |a: Num, b: Num| if a < b { (a, b) } else { (b, a) };
            let ((lx, hx), (ly, hy)) = (lo(fx, tx), lo(fy, ty));
            let now = format!("{}|{}|{}|{}x{}|{}", sig(area), sig(p.get("shader")), sig(p.get("args")), rect.width().round(), rect.height().round(), ctx.look().dark());
            if now != self.sig {
                self.sig = now;
                // a coarse pass now, so something shows at once, and what one sample costs
                let (w, h) = (rect.width().max(1.0) as f64, rect.height().max(1.0) as f64);
                let scale = (ui.ctx().pixels_per_point().min(2.0) as f64).min((MAX_SHADE_PIXELS as f64 / (w * h)).sqrt());
                let (mut cols, mut rows) = (((w * scale).round() as usize).max(1), ((h * scale).round() as usize).max(1));
                let (c0, r0) = (cols.min(16), rows.min(16));
                self.job = Some(Job { cols: c0, rows: r0, row: 0, pixels: Vec::new(), took: Duration::ZERO });
                match self.work(ctx, f, &args, ((lx, ly), (hx, hy)), Duration::from_secs(5)) {
                    Ok(_) => {
                        let job = self.job.take().unwrap();
                        let per = (job.took.as_secs_f64() / (c0 * r0) as f64).max(1e-9);
                        let budget = (SHADE_TIME.as_secs_f64() / per).floor();
                        if (cols * rows) as f64 > budget {
                            let k = (budget / (cols * rows) as f64).sqrt();
                            cols = ((cols as f64 * k).floor() as usize).max(1);
                            rows = ((rows as f64 * k).floor() as usize).max(1);
                        }
                        let img = egui::ColorImage::new([c0, r0], job.pixels);
                        self.texture = Some(ui.ctx().load_texture(format!("mkp-shade-{:?}", ctx.id()), img, egui::TextureOptions::LINEAR));
                        self.state = "done";
                        if cols > c0 || rows > r0 {
                            self.job = Some(Job { cols, rows, row: 0, pixels: Vec::with_capacity(cols * rows), took: Duration::ZERO });
                            self.state = "painting";
                        }
                    }
                    Err(e) => {
                        ctx.error(format!("{}: {}", ctx.path(), e));
                        self.job = None;
                        self.state = "failed";
                    }
                }
            } else if self.job.is_some() {
                // the rest, in slices of a few milliseconds, so the window stays responsive
                match self.work(ctx, f, &args, ((lx, ly), (hx, hy)), Duration::from_millis(12)) {
                    Ok(true) => {
                        let job = self.job.take().unwrap();
                        let img = egui::ColorImage::new([job.cols, job.rows], job.pixels);
                        if let Some(t) = &mut self.texture {
                            t.set(img, egui::TextureOptions::LINEAR);
                        }
                        self.state = "done";
                    }
                    Ok(false) => {}
                    Err(e) => {
                        ctx.error(format!("{}: {}", ctx.path(), e));
                        self.job = None;
                        self.state = "failed";
                    }
                }
            }
        } else {
            self.state = if shader.is_some() { "empty" } else { "no-shader" };
        }
        if self.job.is_some() {
            ui.ctx().request_repaint();
        }
        let rect = rect.unwrap_or(Rect::NOTHING);
        let texture = self.texture.as_ref().map(|t| t.id());
        let state = self.state;
        ctx.root(ui, UiBuilder::new().max_rect(rect).accessibility_role(Role::Image).accessibility_label(label), |ui, ctx| {
            a11y::edit(ui, ui.unique_id(), |n| n.set_class_name(state));
            if rect.is_positive() {
                ui.expand_to_include_rect(rect);
                if let Some(t) = texture {
                    ui.painter().image(t, rect, Rect::from_min_max(egui::pos2(0.0, 0.0), egui::pos2(1.0, 1.0)), Color32::WHITE.gamma_multiply(opacity));
                }
                let id = ctx.sub_id("pixels");
                a11y::node(ui, id, rect, Role::Image);
                ctx.part(ui, id, "pixels");
            }
        });
    }
}

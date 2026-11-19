//! The plane (plan tab 15), in egui's `Scene` container, which pans and zooms its content. The
//! scene's units are the plane's (y flipped): at zoom 1, one unit is one point. Spots are laid
//! out unscaled inside the scene, so each one's rect there is its size in the plane's units,
//! steady while the reader moves: it goes to the layout ([`crate::Ctx::measured_spot`]), which
//! writes a box only when it changes. Dragging pans, the wheel or a pinch zooms, and with the
//! view focused the arrow keys pan and + and - zoom; each writes `center` or `zoom` through a
//! checked write.

use egui::accesskit::Role;
use egui::{Key, Rangef, Rect, Sense, Ui, UiBuilder};

use super::kit;
use crate::values::{flag, inner, num, places_for, point, region, to_num};
use crate::{a11y, Ctx, Props, Space, Widget};

/// The reader moving the view: the zoom first, then the centre, each written only when it moves.
fn moved(ctx: &mut Ctx<'_>, was: ((f64, f64), f64), center: (f64, f64), zoom: f64) {
    let (c, z) = was;
    if (zoom - z).abs() > 1e-9 {
        let nz = to_num(zoom, 3);
        if (crate::values::to_f64(&nz) - z).abs() > 1e-9 {
            ctx.write("zoom", xtmd_runtime::Value::Num(nz));
        }
    }
    let pl = places_for(1.0 / zoom);
    let (x, y) = (to_num(center.0, pl), to_num(center.1, pl));
    if (crate::values::to_f64(&x) - c.0).abs() > 1e-9 || (crate::values::to_f64(&y) - c.1).abs() > 1e-9 {
        ctx.write("center", crate::values::point_value(x, y));
    }
}

/// Widgets on a plane, panned and zoomed by egui's `Scene`.
#[derive(Default)]
pub struct Plane;

impl Widget for Plane {
    fn show(&mut self, ui: &mut Ui, p: &Props<'_>, ctx: &mut Ctx<'_>) {
        let z = p.num("zoom").unwrap_or(1.0).max(0.01);
        let c = point(p.get("center")).unwrap_or((0.0, 0.0));
        let aspect = p.num("aspect").unwrap_or(1.5).max(0.1) as f32;
        let label = p.text("label");
        let width = ctx.length(p.get("width")).unwrap_or_else(|| {
            let w = kit::room(ui);
            if w.is_finite() { w } else { crate::measure::PAGE_WIDTH as f32 }
        }).max(1.0);
        let height = width / aspect;
        let listens = ctx.listens("click");
        // how far the reader may zoom: zoom_range, counted from the zoom that fits bounds with `fit`
        let spots: Vec<_> = p.slot("items").iter().filter(|n| n.widget == "core/spot").collect();
        let boxes: Vec<_> = spots.iter().filter_map(|s| region(s.props.get("box"))).collect();
        let bounds = region(p.get("bounds")).or_else(|| {
            let mut it = boxes.iter();
            let first = *it.next()?;
            Some(it.fold(first, |a, b| ((a.0 .0.min(b.0 .0), a.0 .1.min(b.0 .1)), (a.1 .0.max(b.1 .0), a.1 .1.max(b.1 .1)))))
        });
        let mut base = 1.0;
        if let (true, Some(((fx, fy), (tx, ty)))) = (flag(p.get("fit"), false), bounds) {
            let (bw, bh) = (tx - fx, ty - fy);
            if bw != 0.0 && bh != 0.0 {
                base = (width as f64 / bw).min(width as f64 / aspect as f64 / bh);
            }
        }
        let (lo, hi) = match inner(p.get("zoom_range")) {
            Some(xtmd_runtime::Value::Range(r)) => (num(r.low.as_ref()).unwrap_or(1.0), num(r.high.as_ref()).unwrap_or(1.0)),
            _ => (1.0, 1.0),
        };
        let low = (lo * base).max(0.1);
        let high = (hi * base).min(10.0);
        while let Some(a) = ctx.take_act() {
            // an exact centre or zoom goes through the page: a drag lands on whole points
            ctx.decline(a);
        }
        let mut b = UiBuilder::new().accessibility_role(Role::Group);
        if !label.is_empty() {
            b = b.accessibility_label(label.clone());
        }
        let mut writes: Option<((f64, f64), f64)> = None;
        let mut click: Option<(f64, f64)> = None;
        ctx.root(ui, b, |ui, ctx| {
            a11y::edit(ui, ui.unique_id(), |n| {
                n.set_class_name("plane");
                n.set_role_description("plane");
            });
            let (outer, _) = ui.allocate_exact_size(egui::vec2(width, height), Sense::hover());
            ctx.measured_plane(width);
            let line = ctx.core_color("LINE");
            ui.painter().rect_stroke(outer, 4.0, egui::Stroke::new(1.0, line), egui::StrokeKind::Inside);
            let before = Rect::from_center_size(egui::pos2(c.0 as f32, -c.1 as f32), egui::vec2(width, height) / z as f32);
            let mut scene_rect = before;
            let mut child = ui.new_child(UiBuilder::new().max_rect(outer).layout(egui::Layout::top_down(egui::Align::Min)));
            child.set_clip_rect(outer.intersect(ui.clip_rect()));
            let range = Rangef::new(low.min(z) as f32, high.max(z) as f32);
            let shown = egui::Scene::new().zoom_range(range).scroll_zooms(true).max_inner_size(egui::vec2(width, height)).show(&mut child, &mut scene_rect, |ui| {
                // the background, in the plane's units: x right, y up
                let space = Space { rect: before, x: (before.left() as f64, before.right() as f64), y: (-before.bottom() as f64, -before.top() as f64), scale: (1.0, 1.0), bounded: false, units_per_px: 1.0 / z };
                ctx.in_space(space, |ctx| ctx.slot(ui, "background"));
                ctx.slot(ui, "items");
            });
            drop(child);
            let view = shown.response.id;
            let name = label.clone();
            a11y::edit(ui, view, |n| {
                n.set_role(Role::ScrollView);
                n.set_label(name);
                n.set_keyboard_shortcut("ArrowLeft ArrowRight ArrowUp ArrowDown + -");
            });
            a11y::bounds(ui, view, outer);
            ctx.part(ui, view, "view");
            let r = &shown.response;
            if r.has_focus() {
                kit::focus_ring(ui, outer, 4.0);
            }
            // the reader moved it with the pointer: the scene's rect is where it went
            if r.changed() && scene_rect != before && scene_rect.is_positive() {
                let nz = (outer.width() / scene_rect.width()) as f64;
                let nc = (scene_rect.center().x as f64, -scene_rect.center().y as f64);
                writes = Some((nc, nz));
            }
            // a click on empty space, in the plane's units
            if listens && r.clicked() {
                // the scene's pointer is in the scene's own coordinates: the plane's, y down
                if let Some(s) = r.interact_pointer_pos() {
                    let on_spot = boxes.iter().any(|((fx, fy), (tx, ty))| (s.x as f64) >= *fx && (s.x as f64) <= *tx && (-s.y as f64) >= *fy && (-s.y as f64) <= *ty);
                    if !on_spot {
                        click = Some((s.x as f64, -s.y as f64));
                    }
                }
            }
            // the keys: arrows pan by 40 points, + and - zoom about the middle
            if r.has_focus() {
                ui.memory_mut(|m| m.set_focus_lock_filter(view, egui::EventFilter { horizontal_arrows: true, vertical_arrows: true, ..Default::default() }));
                let step = 40.0 / z;
                ui.input(|i| {
                    let pans = [(Key::ArrowLeft, (-step, 0.0)), (Key::ArrowRight, (step, 0.0)), (Key::ArrowUp, (0.0, step)), (Key::ArrowDown, (0.0, -step))];
                    for (k, d) in pans {
                        if i.key_pressed(k) {
                            writes = Some(((c.0 + d.0, c.1 + d.1), z));
                        }
                    }
                    let zoom = if i.key_pressed(Key::Equals) || i.key_pressed(Key::Plus) {
                        Some(z * 1.25)
                    } else if i.key_pressed(Key::Minus) {
                        Some(z / 1.25)
                    } else {
                        None
                    };
                    if let Some(want) = zoom {
                        let nz = want.clamp(low, high);
                        if high > low && (nz - z).abs() >= 1e-6 {
                            writes = Some((c, nz));
                        }
                    }
                });
            }
        });
        if let Some((center, zoom)) = writes {
            moved(ctx, (c, z), center, zoom);
        }
        if let Some((x, y)) = click {
            let pl = places_for(1.0 / z);
            ctx.event("click", vec![crate::values::point_value(to_num(x, pl), to_num(y, pl))]);
        }
    }
}

/// A widget at a point of a plane, hung from it by its anchor and nudged; its size goes to the
/// layout, which writes its box.
#[derive(Default)]
pub struct Spot {
    size: egui::Vec2,
}

impl Widget for Spot {
    fn show(&mut self, ui: &mut Ui, p: &Props<'_>, ctx: &mut Ctx<'_>) {
        let at = point(p.get("at")).unwrap_or((0.0, 0.0));
        let nudge = point(p.get("nudge")).unwrap_or((0.0, 0.0));
        let anchor = p.case("anchor").unwrap_or("CENTER");
        let pos = egui::pos2((at.0 + nudge.0) as f32, -(at.1 + nudge.1) as f32);
        let rect = kit::anchored(pos, anchor, self.size);
        while let Some(a) = ctx.take_act() {
            ctx.decline(a);
        }
        // sized to what it holds, as a spot placed on the web is: nothing in it stretches
        let r = ctx.root(ui, UiBuilder::new().max_rect(Rect::from_min_size(rect.min, egui::vec2(f32::INFINITY, f32::INFINITY))).layout(egui::Layout::top_down(egui::Align::Min)).sizing_pass(), |ui, ctx| {
            ctx.slot(ui, "child");
        });
        let drawn = r.response.rect.size();
        ctx.measured_spot(drawn);
        if (drawn - self.size).length() > 0.25 {
            self.size = drawn;
            ui.ctx().request_repaint();
        }
    }
}

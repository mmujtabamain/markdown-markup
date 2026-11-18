//! Markdown's own blocks, drawn as egui draws text: paragraph, heading, bullets and items with task
//! boxes, quote, code, maths (as its TeX: egui has no maths renderer), table, footnote and divider.
//! Props are read as the Markdown writer reads them, so the page's words and its Markdown agree.

use egui::accesskit::{Role, Toggled};
use egui::{Align, Color32, Rect, Sense, Stroke, Ui, UiBuilder};

use super::kit::{self, Lay};
use crate::values::{self, case, list};
use crate::{a11y, Ctx, Props};

fn align_of(name: Option<&str>) -> Align {
    match name {
        Some("CENTER") => Align::Center,
        Some("END") => Align::Max,
        _ => Align::Min,
    }
}

pub fn paragraph(ui: &mut Ui, p: &Props<'_>, ctx: &mut Ctx<'_>) {
    let font = ctx.look().font(ctx.page(), "BODY");
    let color = ctx.color(p.get("tone")).unwrap_or_else(|| ctx.core_color("INK"));
    let s = kit::style(ctx, &font, color);
    let lay = Lay { align: align_of(p.case("align")), ..Lay::default() };
    ctx.root(ui, UiBuilder::new().accessibility_role(Role::Paragraph), |ui, ctx| {
        let id = ctx.sub_id("text");
        kit::rich(ui, ctx, id, p.get("value"), s, lay);
    });
}

pub fn heading(ui: &mut Ui, p: &Props<'_>, ctx: &mut Ctx<'_>) {
    let level = p.num("level").unwrap_or(1.0).round().clamp(1.0, 6.0) as usize;
    let base = ctx.look().font(ctx.page(), "HEADING");
    let body = ctx.look().font(ctx.page(), "BODY");
    let mut font = base;
    font.size = match level {
        1 => base.size * 1.36,
        2 => base.size,
        3 => base.size * 0.82,
        4 => body.size,
        5 => body.size * 0.9,
        _ => body.size * 0.85,
    };
    font.bold = true;
    let color = if level == 6 { ctx.core_color("MUTED") } else { ctx.core_color("INK") };
    let s = kit::style(ctx, &font, color);
    let words = crate::rich::words(p.get("value"));
    ctx.root(ui, UiBuilder::new().accessibility_role(Role::Heading).accessibility_label(words), |ui, ctx| {
        a11y::edit(ui, ui.unique_id(), |n| {
            n.set_level(level);
            n.set_class_name(format!("h{}", level));
        });
        let id = ctx.sub_id("text");
        kit::rich(ui, ctx, id, p.get("value"), s, Lay::default());
    });
}

pub fn bullets(ui: &mut Ui, p: &Props<'_>, ctx: &mut Ctx<'_>) {
    let ordered = p.flag("ordered", false);
    let start = p.num("start").unwrap_or(1.0) as i64;
    let items = p.slot("items");
    let tasks = items.iter().any(|i| i.widget == "core/item" && values::inner(i.props.get("done")).is_some());
    let font = ctx.look().font(ctx.page(), "BODY");
    let muted = ctx.core_color("MUTED");
    ctx.root(ui, UiBuilder::new().accessibility_role(Role::List), |ui, ctx| {
        a11y::edit(ui, ui.unique_id(), |n| n.set_class_name(if ordered { "ol" } else { "ul" }));
        ui.spacing_mut().item_spacing.y = 4.0;
        for (k, item) in items.iter().enumerate() {
            ui.horizontal_top(|ui| {
                // the marker, which a screen reader gets from the list itself
                let marker = if tasks {
                    String::new()
                } else if ordered {
                    format!("{}.", start + k as i64)
                } else {
                    "•".to_string()
                };
                let g = ui.painter().layout_no_wrap(marker, kit::font_id(&font), muted);
                let (rect, _) = ui.allocate_exact_size(egui::vec2(if tasks { 0.0 } else { 22.0 }, g.size().y), Sense::hover());
                if !tasks {
                    ui.painter().galley(egui::pos2(rect.right() - g.size().x - 4.0, rect.top()), g, muted);
                }
                ui.vertical(|ui| ctx.child(ui, item));
            });
        }
    });
}

pub fn item(ui: &mut Ui, p: &Props<'_>, ctx: &mut Ctx<'_>) {
    let done = match values::inner(p.get("done")) {
        Some(mkp_runtime::Value::Bool(b)) => Some(*b),
        _ => None,
    };
    let ink = ctx.core_color("INK");
    let accent = ctx.core_color("ACCENT");
    ctx.root(ui, UiBuilder::new().accessibility_role(Role::ListItem), |ui, ctx| {
        ui.horizontal_top(|ui| {
            if let Some(d) = done {
                // a task box shows the item's state; ticking it is for a press, so it can't change here
                let id = ctx.sub_id("check");
                let (rect, _) = ui.allocate_exact_size(egui::vec2(18.0, 18.0), Sense::hover());
                let r = Rect::from_center_size(rect.center(), egui::vec2(14.0, 14.0));
                ui.painter().rect_stroke(r, 3.0, Stroke::new(1.5, if d { accent } else { ink }), egui::StrokeKind::Inside);
                if d {
                    ui.painter().rect_filled(r, 3.0, accent);
                    let pts = [r.left_center() + egui::vec2(3.0, 0.0), r.center_bottom() + egui::vec2(-1.0, -3.5), r.right_top() + egui::vec2(-3.0, 3.5)];
                    ui.painter().line(pts.to_vec(), Stroke::new(2.0, Color32::WHITE));
                }
                ui.interact(rect, id, Sense::hover());
                a11y::edit(ui, id, |n| {
                    n.set_role(Role::CheckBox);
                    n.set_label(if d { "Done" } else { "Not done" });
                    n.set_toggled(if d { Toggled::True } else { Toggled::False });
                    n.set_disabled();
                });
                a11y::bounds(ui, id, rect);
                ctx.part(ui, id, "check");
            }
            let body = ui.scope_builder(UiBuilder::new().scope_id(ctx.sub_id("body")).layout(egui::Layout::top_down(Align::Min)), |ui| {
                ctx.part(ui, ui.unique_id(), "body");
                ctx.slot(ui, "body");
                ui.unique_id()
            });
            a11y::bounds(ui, body.inner, body.response.rect);
        });
    });
}

pub fn quote(ui: &mut Ui, _p: &Props<'_>, ctx: &mut Ctx<'_>) {
    let line = ctx.core_color("LINE");
    ctx.root(ui, UiBuilder::new().accessibility_role(Role::Blockquote), |ui, ctx| {
        let r = egui::Frame::new().inner_margin(egui::Margin { left: 14, right: 0, top: 2, bottom: 2 }).show(ui, |ui| {
            ctx.slot(ui, "body");
        });
        let rect = r.response.rect;
        ui.painter().line_segment([rect.left_top() + egui::vec2(3.0, 0.0), rect.left_bottom() + egui::vec2(3.0, 0.0)], Stroke::new(3.0, line));
    });
}

pub fn code(ui: &mut Ui, p: &Props<'_>, ctx: &mut Ctx<'_>) {
    let font = ctx.look().font(ctx.page(), "MONO");
    let ink = ctx.core_color("INK");
    let bg = if ctx.look().dark() { Color32::from_white_alpha(14) } else { Color32::from_black_alpha(10) };
    let src = p.text("src");
    let lang = p.text("lang").split_whitespace().next().unwrap_or("").to_string();
    // a block of code is a plain group to a screen reader, as a <pre> is: its text is what it says
    ctx.root(ui, UiBuilder::new().sense(Sense::focusable_noninteractive()), |ui, ctx| {
        if !lang.is_empty() {
            a11y::edit(ui, ui.unique_id(), |n| n.set_class_name(format!("language-{}", lang)));
        }
        egui::Frame::new().fill(bg).corner_radius(6.0).inner_margin(10.0).show(ui, |ui| {
            egui::ScrollArea::horizontal().id_salt(ctx.sub_id("scroll")).show(ui, |ui| {
                kit::leaf(ui, ctx.sub_id("text"), kit::plain(&src, kit::font_id(&font), ink), &src, Lay { wrap: false, ..Lay::default() });
            });
        });
        ctx.part(ui, ctx.sub_id("text"), "text");
    });
}

/// Maths, shown as its TeX: egui has no maths renderer (target.yaml's `cannot`). It is still named
/// by its TeX, as on every target.
pub fn math(ui: &mut Ui, p: &Props<'_>, ctx: &mut Ctx<'_>) {
    let font = ctx.look().font(ctx.page(), "MONO");
    let ink = ctx.core_color("INK");
    let tex = values::tex(p.get("tex"));
    let name = tex.clone();
    ctx.root(ui, UiBuilder::new().accessibility_role(Role::Math).accessibility_label(name), |ui, ctx| {
        a11y::edit(ui, ui.unique_id(), |n| n.set_class_name("math"));
        kit::leaf(ui, ctx.sub_id("tex"), kit::plain(&tex, kit::font_id(&font), ink), &tex, Lay { align: Align::Center, ..Lay::default() });
    });
}

pub fn table(ui: &mut Ui, p: &Props<'_>, ctx: &mut Ctx<'_>) {
    let font = ctx.look().font(ctx.page(), "BODY");
    let ink = ctx.core_color("INK");
    let line = ctx.core_color("LINE");
    let head = p.list("head");
    let rows = p.list("rows");
    let align: Vec<Align> = p.list("align").iter().map(|a| align_of(case(Some(a)))).collect();
    let s = kit::style(ctx, &font, ink);
    let mut bold = font;
    bold.bold = true;
    let sb = kit::style(ctx, &bold, ink);
    ctx.root(ui, UiBuilder::new().sense(Sense::focusable_noninteractive()), |ui, ctx| {
        egui::ScrollArea::horizontal().id_salt(ctx.sub_id("scroll")).show(ui, |ui| {
            let grid = ui.scope_builder(UiBuilder::new().scope_id(ctx.sub_id("grid")).accessibility_role(Role::Table), |ui| {
                ctx.part(ui, ui.unique_id(), "grid");
                egui::Grid::new(ctx.sub_id("cells")).spacing(egui::vec2(16.0, 6.0)).show(ui, |ui| {
                    let cell = |ui: &mut Ui, ctx: &mut Ctx<'_>, v: &mkp_runtime::Value, k: usize, id: egui::Id, role: Role, part: &str, s: crate::rich::Style| {
                        let a = align.get(k).copied().unwrap_or(Align::Min);
                        let r = ui.scope_builder(UiBuilder::new().scope_id(id).accessibility_role(role), |ui| {
                            ctx.part(ui, ui.unique_id(), part);
                            kit::rich(ui, ctx, id.with("text"), Some(v), s, Lay { align: a, wrap: false, ..Lay::default() });
                        });
                        a11y::bounds(ui, id, r.response.rect);
                    };
                    for (k, h) in head.iter().enumerate() {
                        cell(ui, ctx, h, k, ctx.sub_id(&format!("h{}", k)), Role::ColumnHeader, "header", sb);
                    }
                    ui.end_row();
                    for (j, row) in rows.iter().enumerate() {
                        for (k, c) in list(Some(row)).iter().enumerate() {
                            cell(ui, ctx, c, k, ctx.sub_id(&format!("c{}.{}", j, k)), Role::Cell, "cell", s);
                        }
                        ui.end_row();
                    }
                });
                ui.unique_id()
            });
            let r = grid.response.rect;
            a11y::bounds(ui, grid.inner, r);
            // the rule under the header row
            if !head.is_empty() {
                let y = r.top() + font.size * font.line + 3.0;
                ui.painter().hline(r.x_range(), y, Stroke::new(1.0, line));
            }
        });
    });
}

pub fn footnote(ui: &mut Ui, p: &Props<'_>, ctx: &mut Ctx<'_>) {
    let font = ctx.look().font(ctx.page(), "BODY");
    let mut small = font;
    small.size *= 0.875;
    let accent = ctx.core_color("ACCENT");
    let mark = p.text("mark");
    ctx.root(ui, UiBuilder::new().accessibility_role(Role::Note).accessibility_label(format!("Footnote {}", mark)), |ui, ctx| {
        ui.horizontal_top(|ui| {
            let id = ctx.sub_id("mark");
            let m = kit::leaf(ui, id, kit::plain(&mark, kit::font_id(&small), accent), &mark, Lay { wrap: false, ..Lay::default() });
            a11y::edit(ui, id, |n| n.set_role(Role::Link));
            ctx.part(ui, m.response.id, "mark");
            let body = ui.scope_builder(UiBuilder::new().scope_id(ctx.sub_id("body")), |ui| {
                ctx.part(ui, ui.unique_id(), "body");
                ctx.slot(ui, "body");
                ui.unique_id()
            });
            a11y::bounds(ui, body.inner, body.response.rect);
        });
    });
}

pub fn divider(ui: &mut Ui, _p: &Props<'_>, ctx: &mut Ctx<'_>) {
    let line = ctx.core_color("LINE");
    ctx.root(ui, UiBuilder::new().accessibility_role(Role::Splitter), |ui, _ctx| {
        let w = kit::room(ui);
        let (rect, _) = ui.allocate_exact_size(egui::vec2(if w.is_finite() { w } else { 160.0 }, 9.0), Sense::hover());
        ui.painter().hline(rect.x_range(), rect.center().y, Stroke::new(1.0, line));
    });
}

//! What our widgets share: text leaves with their AccessKit node, fonts from the tokens, and the
//! look of a frame.

use std::sync::Arc;

use egui::accesskit::Role;
use egui::text::{LayoutJob, TextFormat, TextWrapping};
use egui::{Align, Color32, FontFamily, FontId, Galley, Id, Pos2, Rect, Response, Sense, Ui, Vec2};

use crate::look::Font;
use crate::rich::{self, Style};
use crate::{a11y, Ctx};

/// How a leaf of text is laid out.
#[derive(Clone, Copy)]
pub struct Lay {
    pub align: Align,
    pub wrap: bool,
    /// Cut to one line, ending in an ellipsis.
    pub clip: bool,
}

impl Default for Lay {
    fn default() -> Lay {
        Lay { align: Align::Min, wrap: true, clip: false }
    }
}

/// A leaf of text drawn: where it is, and the galley painted there.
pub struct Leaf {
    pub response: Response,
    pub galley: Arc<Galley>,
    pub pos: Pos2,
}

/// A leaf of text: laid out to the ui's width, painted, and a Label node holding its words, so a
/// screen reader (and a check) reads what is shown.
pub fn leaf(ui: &mut Ui, id: Id, mut job: LayoutJob, words: &str, lay: Lay) -> Leaf {
    let avail = room(ui);
    let bounded = avail.is_finite();
    let avail = if bounded { avail.max(1.0) } else { f32::INFINITY };
    job.halign = lay.align;
    job.wrap = if lay.clip && bounded {
        TextWrapping::truncate_at_width(avail)
    } else if lay.wrap && bounded {
        TextWrapping { max_width: avail, ..Default::default() }
    } else {
        TextWrapping::no_max_width()
    };
    let galley = ui.painter().layout_job(job);
    let size = galley.size();
    let width = if lay.align == Align::Min || !bounded { size.x } else { avail.max(size.x) };
    let (rect, _) = ui.allocate_exact_size(egui::vec2(width, size.y), Sense::hover());
    let pos = match lay.align {
        Align::Min => rect.left_top(),
        Align::Center => rect.center_top(),
        Align::Max => rect.right_top(),
    };
    if ui.is_rect_visible(rect) {
        ui.painter().galley(pos, galley.clone(), Color32::PLACEHOLDER);
    }
    let response = ui.interact(rect, id, Sense::hover());
    let words = words.to_string();
    a11y::edit(ui, id, |n| {
        n.set_role(Role::Label);
        n.set_value(words);
    });
    a11y::bounds(ui, id, rect);
    Leaf { response, galley, pos }
}

/// The width a widget may take: what is left on its line, or infinite in a ui sized to its
/// content (a spot's, a place's), where a widget takes only what it needs.
pub fn room(ui: &Ui) -> f32 {
    if ui.is_sizing_pass() {
        f32::INFINITY
    } else {
        ui.available_width()
    }
}

/// One run of plain text.
pub fn plain(text: &str, font: FontId, color: Color32) -> LayoutJob {
    let mut job = LayoutJob::default();
    job.append(text, 0.0, TextFormat { font_id: font, color, ..Default::default() });
    job
}

/// A font from the tokens as egui's.
pub fn font_id(f: &Font) -> FontId {
    FontId::new(f.size, if f.mono { FontFamily::Monospace } else { FontFamily::Proportional })
}

/// How rich text is drawn in a font and colour.
pub fn style(ctx: &Ctx<'_>, f: &Font, color: Color32) -> Style {
    let code_bg = if ctx.look().dark() { Color32::from_white_alpha(18) } else { Color32::from_black_alpha(14) };
    Style { size: f.size, bold: f.bold, mono: f.mono, color, accent: ctx.core_color("ACCENT"), code_bg, line: f.line }
}

/// A rich text: one leaf, or, when its sentence holds views, flowed with them ([`rich_flow`]).
pub fn rich(ui: &mut Ui, ctx: &mut Ctx<'_>, id: Id, v: Option<&xtmd_runtime::Value>, s: Style, lay: Lay) {
    if rich::has_views(v) {
        rich_flow(ui, ctx, id, v, s);
    } else {
        rich_leaf(ui, id, v, s, lay);
    }
}

/// A rich text leaf; a click on a link in it opens the link.
pub fn rich_leaf(ui: &mut Ui, id: Id, v: Option<&xtmd_runtime::Value>, s: Style, lay: Lay) -> Leaf {
    let laid = rich::layout(v, s);
    let words = rich::words(v);
    let text = laid.job.text.clone();
    let l = leaf(ui, id, laid.job, &words, lay);
    follow_links(ui, id, &l, &text, &laid.links);
    l
}

/// A rich text whose sentence holds views: its runs of text in one wrapped line, each starting
/// where the last thing on the line ended, and each view drawn from the widget's slot where its
/// part is, as a widget of the page. A click on a link opens it.
pub fn rich_flow(ui: &mut Ui, ctx: &mut Ctx<'_>, id: Id, v: Option<&xtmd_runtime::Value>, s: Style) {
    ui.horizontal_wrapped(|ui| {
        ui.spacing_mut().item_spacing.x = 0.0;
        for (k, piece) in rich::pieces(v).into_iter().enumerate() {
            match piece {
                rich::Piece::Run(segments) => {
                    let laid = rich::layout_run(&segments, s);
                    let text = laid.job.text.clone();
                    let (pos, galley, response) = egui::Label::new(laid.job).selectable(false).wrap().layout_in_ui(ui);
                    if ui.is_rect_visible(response.rect) {
                        ui.painter().galley(pos, galley.clone(), Color32::PLACEHOLDER);
                    }
                    let words = text.clone();
                    a11y::edit(ui, response.id, |n| {
                        n.set_role(Role::Label);
                        n.set_value(words);
                    });
                    let l = Leaf { response, galley, pos };
                    follow_links(ui, id.with(k), &l, &text, &laid.links);
                }
                rich::Piece::View(slot) => ctx.slot(ui, &slot),
            }
        }
    });
}

/// A link in a leaf of rich text: the hand over it, and opened on a click.
fn follow_links(ui: &mut Ui, id: Id, l: &Leaf, text: &str, links: &[(std::ops::Range<usize>, String)]) {
    if links.is_empty() {
        return;
    }
    let r = ui.interact(l.response.rect, id.with("links"), Sense::click());
    let at = r.interact_pointer_pos().or_else(|| r.hover_pos());
    let hit = at.and_then(|p| {
        let c = l.galley.cursor_from_pos(p - l.pos);
        let byte = text.char_indices().nth(c.index.into()).map_or(text.len(), |(b, _)| b);
        links.iter().find(|(range, _)| range.contains(&byte)).map(|(_, url)| url.clone())
    });
    if hit.is_some() {
        ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
    }
    if let (true, Some(url)) = (r.clicked(), hit) {
        ui.ctx().open_url(egui::OpenUrl::new_tab(url));
    }
}

/// A slot of space kept for a shape painted under what is drawn next: the frame's fill.
pub fn behind(ui: &Ui) -> egui::layers::ShapeIdx {
    ui.painter().add(egui::Shape::Noop)
}

/// Fills a slot kept with [`behind`].
pub fn fill_behind(ui: &Ui, idx: egui::layers::ShapeIdx, shape: impl Into<egui::Shape>) {
    ui.painter().set(idx, shape);
}

/// The ring a focused widget shows.
pub fn focus_ring(ui: &Ui, rect: Rect, radius: f32) {
    let stroke = ui.visuals().selection.stroke;
    ui.painter().rect_stroke(rect.expand(2.0), radius + 2.0, egui::Stroke::new(stroke.width.max(1.5), stroke.color), egui::StrokeKind::Outside);
}

/// A rect of a size at a point, with an anchor's part of it on the point: `NE` puts its
/// top-right corner there. y points down on the screen.
pub fn anchored(at: Pos2, anchor: &str, size: Vec2) -> Rect {
    let x = if anchor.ends_with('W') {
        at.x
    } else if anchor.ends_with('E') {
        at.x - size.x
    } else {
        at.x - size.x / 2.0
    };
    let y = if anchor.starts_with('N') {
        at.y
    } else if anchor.starts_with('S') {
        at.y - size.y
    } else {
        at.y - size.y / 2.0
    };
    Rect::from_min_size(egui::pos2(x, y), size)
}

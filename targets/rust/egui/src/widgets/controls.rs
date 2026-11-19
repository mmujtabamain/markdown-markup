//! Drawing and input: label, image, icon, press, field, slider and overlay, as egui's own kinds of
//! control, with their roles and states in the AccessKit tree, so a screen reader and the keyboard
//! get them as they get egui's.

use egui::accesskit::{HasPopup, Role, Toggled};
use egui::{Align, Color32, Key, Layout, Modifiers, Rect, Sense, Stroke, Ui, UiBuilder};
use xtmd_runtime::{Num, Value};

use super::kit::{self, Lay};
use crate::values::{self, exact, inner, to_f64};
use crate::{a11y, Act, Ctx, Props, Widget};

// ---- label, image, icon

pub fn label(ui: &mut Ui, p: &Props<'_>, ctx: &mut Ctx<'_>) {
    let value = p.text("value");
    let f = ctx.look().sized(ctx.page(), p.case("font"), p.case("size"));
    let mut font = f;
    if matches!(p.case("weight"), Some("BOLD") | Some("MEDIUM")) {
        font.bold = true;
    }
    let color = ctx.color(p.get("tone")).unwrap_or_else(|| ctx.core_color("INK"));
    let align = match p.case("align") {
        Some("CENTER") => Align::Center,
        Some("END") => Align::Max,
        _ => Align::Min,
    };
    let lay = Lay { align, wrap: p.flag("wrap", true), clip: p.flag("clip", false) };
    let halo = p.flag("halo", false);
    let surface = ctx.core_color("SURFACE");
    ctx.root(ui, UiBuilder::new(), |ui, ctx| {
        // plain text: nothing in it is read as Markdown
        let mut job = kit::plain(&value, kit::font_id(&font), color);
        if font.bold {
            for sec in &mut job.sections {
                sec.format.extra_letter_spacing = 0.4;
            }
        }
        if halo {
            // an outline in the surface colour, so it reads over lines
            let mut back = kit::plain(&value, kit::font_id(&font), surface);
            back.wrap.max_width = ui.available_width();
            let g = ui.painter().layout_job(back);
            let at = ui.cursor().min;
            for d in [egui::vec2(-1.0, 0.0), egui::vec2(1.0, 0.0), egui::vec2(0.0, -1.0), egui::vec2(0.0, 1.0)] {
                ui.painter().galley(at + d, g.clone(), surface);
            }
        }
        kit::leaf(ui, ctx.sub_id("text"), job, &value, lay);
    });
}

pub fn image(ui: &mut Ui, p: &Props<'_>, ctx: &mut Ctx<'_>) {
    let alt = p.text("alt");
    let src = crate::rich::safe_src(&p.text("src"));
    let width = ctx.length(p.get("width"));
    let muted = ctx.core_color("MUTED");
    let line = ctx.core_color("LINE");
    let font = ctx.look().font(ctx.page(), "BODY");
    ctx.root(ui, UiBuilder::new().accessibility_role(Role::Image).accessibility_label(alt.clone()), |ui, _ctx| {
        let has_loaders = !ui.ctx().loaders().image.lock().is_empty();
        match (&src, has_loaders) {
            (Some(src), true) => {
                let mut img = egui::Image::new(src.clone()).alt_text(alt.clone());
                if let Some(w) = width {
                    img = img.fit_to_exact_size(egui::vec2(w, w * 2.0 / 3.0)).maintain_aspect_ratio(true);
                }
                ui.add(img);
            }
            _ => {
                // with no loader for it (or an unsafe source), the picture's place, with its alt text
                let w = width.unwrap_or(120.0);
                let (rect, _) = ui.allocate_exact_size(egui::vec2(w, (w * 2.0 / 3.0).max(24.0)), Sense::hover());
                ui.painter().rect_stroke(rect, 4.0, Stroke::new(1.0, line), egui::StrokeKind::Inside);
                let g = ui.painter().layout(alt.clone(), egui::FontId::proportional(font.size * 0.8), muted, rect.width() - 8.0);
                ui.painter().galley(rect.center() - g.size() / 2.0, g, muted);
                if src.is_none() {
                    a11y::edit(ui, ui.unique_id(), |n| n.set_description("not loaded: its source isn't safe"));
                }
            }
        }
    });
}

/// A glyph for each icon name, from the symbols egui's fonts draw.
pub fn glyph(name: &str) -> &'static str {
    match name {
        "PLAY" => "▶",
        "PAUSE" => "⏸",
        "PREV" => "⏮",
        "NEXT" => "⏭",
        "MORE" => "…",
        "LESS" => "−",
        "FIRST" => "⏪",
        "LAST" => "⏩",
        "RESET" => "⟲",
        "CHECK" => "✔",
        "CROSS" => "❌",
        "PLUS" => "+",
        "MINUS" => "−",
        "UP" => "⬆",
        "DOWN" => "⬇",
        "LEFT" => "⬅",
        "RIGHT" => "➡",
        "BAN" => "🚫",
        "ALERT" => "⚠",
        "INFO" => "ℹ",
        "HELP" => "❓",
        "LOCK" => "🔒",
        "UNLOCK" => "🔓",
        "EYE" => "👁",
        "EDIT" => "✏",
        "SEARCH" => "🔍",
        "USER" => "👤",
        "USERS" => "👥",
        "FILE" => "📄",
        "FOLDER" => "📁",
        "DATABASE" => "🗄",
        "SERVER" => "🖥",
        "CLOUD" => "☁",
        "MAIL" => "✉",
        "CLOCK" => "🕓",
        "CALENDAR" => "📅",
        "FLAG" => "⚑",
        "TARGET" => "🎯",
        "GAUGE" => "⏲",
        "LAYERS" => "🗐",
        "BRANCH" => "⎇",
        "BOX" => "📦",
        "SQUARE" => "⬛",
        "CIRCLE" => "⚫",
        "DOT" => "•",
        "STAR" => "⭐",
        "BOLT" => "⚡",
        "LINK" => "🔗",
        "KEY" => "🔑",
        "SHIELD" => "🛡",
        "CART" => "🛒",
        "CHART" => "📈",
        "CODE" => "⌨",
        "TERMINAL" => "🖳",
        "BELL" => "🔔",
        "HOME" => "🏠",
        "SETTINGS" => "⚙",
        "SLIDERS" => "🎚",
        "TRASH" => "🗑",
        "COPY" => "🗐",
        "DOWNLOAD" => "📥",
        "UPLOAD" => "📤",
        "EXPAND" => "⛶",
        "LIGHTBULB" => "💡",
        "BOOK" => "📖",
        _ => "•",
    }
}

pub fn icon(ui: &mut Ui, p: &Props<'_>, ctx: &mut Ctx<'_>) {
    let name = p.case("name").unwrap_or("DOT");
    let label = p.text("label");
    let f = ctx.look().sized(ctx.page(), None, p.case("size"));
    let color = ctx.color(p.get("tone")).unwrap_or_else(|| ctx.core_color("INK"));
    // labelled, it is a picture with a name; otherwise decoration
    let b = if label.is_empty() { UiBuilder::new() } else { UiBuilder::new().accessibility_role(Role::Image).accessibility_label(label) };
    ctx.root(ui, b, |ui, _ctx| {
        a11y::edit(ui, ui.unique_id(), |n| n.set_class_name(name.to_lowercase()));
        let g = ui.painter().layout_no_wrap(glyph(name).to_string(), egui::FontId::proportional(f.size), color);
        let (rect, _) = ui.allocate_exact_size(egui::vec2(f.size * 1.2, f.size * 1.2), Sense::hover());
        ui.painter().galley(rect.center() - g.size() / 2.0, g, color);
    });
}

// ---- press

/// Each press kind's role.
fn press_role(kind: &str) -> Role {
    match kind {
        "TAB" => Role::Tab,
        "OPTION" => Role::ListBoxOption,
        "SWITCH" => Role::Switch,
        "CHECK" => Role::CheckBox,
        "RADIO" => Role::RadioButton,
        _ => Role::Button,
    }
}

pub fn press(ui: &mut Ui, p: &Props<'_>, ctx: &mut Ctx<'_>) {
    let kind = p.case("kind").unwrap_or("BUTTON");
    let selected = p.flag("selected", false);
    let disabled = p.flag("disabled", false);
    let label = p.text("label");
    let content = !p.slot("content").is_empty();
    let tone = ctx.color(p.get("tone"));
    let font = ctx.look().font(ctx.page(), "BODY");
    let ink = ctx.core_color("INK");
    let accent = ctx.core_color("ACCENT");
    let line = ctx.core_color("LINE");
    let surface = ctx.core_color("SURFACE");
    // a click a check asks for: the same as the reader's
    while let Some(a) = ctx.take_act() {
        match a {
            Act::Event { name, .. } if name == "click" => {
                if !disabled {
                    ctx.event("click", Vec::new());
                }
            }
            other => ctx.decline(other),
        }
    }
    let mut b = UiBuilder::new().sense(Sense::click()).accessibility_role(press_role(kind)).accessibility_label(label.clone()).layout(Layout::left_to_right(Align::Center));
    if disabled {
        b = b.disabled();
    }
    let indicator = matches!(kind, "SWITCH" | "CHECK" | "RADIO");
    let framed = !indicator && kind != "PLAIN";
    let pad = if framed { egui::vec2(10.0, 4.0) } else { egui::vec2(2.0, 2.0) };
    // a row centred across takes all the height it is offered, so a press with a text gets its
    // own: its line (or its indicator) and its padding, wherever it is drawn
    let fitted = !content;
    if fitted {
        let line = ui.ctx().fonts_mut(|f| f.row_height(&kit::font_id(&font))).max(if indicator { 18.0 } else { 0.0 });
        let room = ui.available_rect_before_wrap();
        b = b.max_rect(Rect::from_min_size(room.min, egui::vec2(room.width(), line + 2.0 * pad.y)));
    }
    let r = ctx.root(ui, b, |ui, ctx| {
        let resp = ui.response();
        let id = ui.unique_id();
        a11y::edit(ui, id, |n| {
            n.set_class_name(kind.to_lowercase());
            match kind {
                "TOGGLE" | "SWITCH" | "CHECK" | "RADIO" => n.set_toggled(if selected { Toggled::True } else { Toggled::False }),
                "TAB" | "OPTION" => n.set_selected(selected),
                _ => {}
            }
        });
        let v = ui.style().interact_selectable(&resp, selected && framed);
        let bg = kit::behind(ui);
        ui.add_space(pad.x);
        let text_color = if disabled {
            ui.visuals().widgets.noninteractive.fg_stroke.color
        } else if framed && tone.is_some() {
            surface
        } else if kind == "TAB" && selected {
            accent
        } else {
            tone.unwrap_or(ink)
        };
        if indicator {
            let (rect, _) = ui.allocate_exact_size(egui::vec2(if kind == "SWITCH" { 32.0 } else { 18.0 }, 18.0), Sense::hover());
            let on = if disabled { line } else { tone.unwrap_or(accent) };
            match kind {
                "SWITCH" => {
                    let track = Rect::from_center_size(rect.center(), egui::vec2(30.0, 16.0));
                    ui.painter().rect_filled(track, 8.0, if selected { on } else { line });
                    let x = if selected { track.right() - 8.0 } else { track.left() + 8.0 };
                    ui.painter().circle_filled(egui::pos2(x, track.center().y), 6.0, Color32::WHITE);
                }
                "CHECK" => {
                    let r = Rect::from_center_size(rect.center(), egui::vec2(14.0, 14.0));
                    if selected {
                        ui.painter().rect_filled(r, 3.0, on);
                        let pts = vec![r.left_center() + egui::vec2(3.0, 0.0), r.center_bottom() + egui::vec2(-1.0, -3.5), r.right_top() + egui::vec2(-3.0, 3.5)];
                        ui.painter().line(pts, Stroke::new(2.0, Color32::WHITE));
                    } else {
                        ui.painter().rect_stroke(r, 3.0, Stroke::new(1.5, ink), egui::StrokeKind::Inside);
                    }
                }
                _ => {
                    ui.painter().circle_stroke(rect.center(), 7.0, Stroke::new(1.5, if selected { on } else { ink }));
                    if selected {
                        ui.painter().circle_filled(rect.center(), 4.0, on);
                    }
                }
            }
        }
        // with content of its own, the label is its name; with none, its text
        if content {
            let c = ui.scope_builder(UiBuilder::new().scope_id(ctx.sub_id("content")), |ui| {
                ctx.part(ui, ui.unique_id(), "content");
                ctx.slot(ui, "content");
                ui.unique_id()
            });
            a11y::bounds(ui, c.inner, c.response.rect);
            // its label is there, hidden: the name says it
            let hidden = ctx.sub_id("label");
            a11y::node(ui, hidden, Rect::from_min_size(c.response.rect.min, egui::Vec2::ZERO), Role::Label);
            a11y::edit(ui, hidden, |n| n.set_hidden());
            ctx.part(ui, hidden, "label");
        } else {
            let mut f = font;
            if kind == "TAB" && selected {
                f.bold = true;
            }
            let l = kit::leaf(ui, ctx.sub_id("label"), kit::plain(&label, kit::font_id(&f), text_color), &label, Lay { wrap: false, ..Lay::default() });
            ctx.part(ui, l.response.id, "label");
        }
        ui.add_space(pad.x);
        // a fitted press's area holds its padding already
        let rect = if fitted { ui.min_rect() } else { ui.min_rect().expand2(egui::vec2(0.0, pad.y)) };
        if framed {
            let fill = if let Some(t) = tone { if resp.hovered() { t.gamma_multiply(0.9) } else { t } } else { v.weak_bg_fill };
            kit::fill_behind(ui, bg, egui::Shape::rect_filled(rect, v.corner_radius, fill));
            if tone.is_none() {
                ui.painter().rect_stroke(rect, v.corner_radius, v.bg_stroke, egui::StrokeKind::Inside);
            }
        } else if kind == "TAB" && selected {
            ui.painter().hline(rect.x_range(), rect.bottom(), Stroke::new(2.0, accent));
        }
        if resp.has_focus() {
            kit::focus_ring(ui, rect, 4.0);
        }
        ui.allocate_rect(Rect::from_min_max(rect.min, rect.max), Sense::hover());
    });
    let resp = r.response;
    if resp.clicked() && !disabled {
        resp.request_focus();
        ctx.event("click", Vec::new());
    }
    // tabs, options and radios move along their group with the arrow keys: egui moves the focus
    // to the nearest widget that way, so a row of tabs is walked with left and right
}

// ---- field

/// A text box with its label. What is being typed is kept here, and every change is a checked
/// write of `value`; the page's value wins when it changes from outside.
#[derive(Default)]
pub struct Field {
    buf: String,
    was: Option<String>,
}

impl Widget for Field {
    fn show(&mut self, ui: &mut Ui, p: &Props<'_>, ctx: &mut Ctx<'_>) {
        let value = p.text("value");
        let label = p.text("label");
        let placeholder = p.text("placeholder");
        let lines = p.num("lines").unwrap_or(1.0).round().clamp(1.0, 20.0) as usize;
        let multi = lines > 1;
        if self.was.as_deref() != Some(value.as_str()) {
            self.buf = value.clone();
            self.was = Some(value.clone());
        }
        let mut typed = false;
        let mut submit = false;
        while let Some(a) = ctx.take_act() {
            match a {
                Act::Event { name, .. } if name == "submit" => submit = true,
                // a one-line box can't hold a line break: that write goes through the page
                Act::Write { input, value: Value::Text(t) } if input == "value" && (multi || !t.contains(['\n', '\r'])) => {
                    self.buf = t.to_string();
                    typed = true;
                }
                other => ctx.decline(other),
            }
        }
        let font = ctx.look().font(ctx.page(), "BODY");
        let ink = ctx.core_color("INK");
        let input_id = ctx.sub_id("input");
        let buf = &mut self.buf;
        ctx.root(ui, UiBuilder::new().layout(Layout::top_down(Align::Min)), |ui, ctx| {
            ui.spacing_mut().item_spacing.y = 4.0;
            let l = kit::leaf(ui, ctx.sub_id("label"), kit::plain(&label, kit::font_id(&font), ink), &label, Lay::default());
            ctx.part(ui, l.response.id, "label");
            // Enter submits a one-line field; a longer one takes Control (Command) with it
            if ui.memory(|m| m.has_focus(input_id)) {
                let key = if multi { ui.input_mut(|i| i.consume_key(Modifiers::COMMAND, Key::Enter)) } else { ui.input_mut(|i| i.consume_key(Modifiers::NONE, Key::Enter)) };
                submit |= key;
            }
            let te = if multi { egui::TextEdit::multiline(buf).desired_rows(lines) } else { egui::TextEdit::singleline(buf).return_key(None) };
            let r = ui.add(te.id(input_id).hint_text(placeholder.clone()).font(kit::font_id(&font)).desired_width(ui.available_width().min(480.0)));
            let name = label.clone();
            a11y::edit(ui, input_id, |n| n.set_label(name));
            ctx.part(ui, input_id, "input");
            typed |= r.changed();
        });
        if typed {
            if ctx.write("value", Value::text(&self.buf)) {
                self.was = Some(self.buf.clone());
            } else {
                // refused: the page's value stands
                self.buf = value;
            }
        }
        if submit {
            ctx.event("submit", Vec::new());
        }
    }
}

// ---- slider

/// A slider's ends and step, exactly.
#[derive(Clone, Copy, Debug)]
pub struct Ends {
    pub low: Num,
    pub high: Num,
    pub step: Num,
}

fn ten() -> Num {
    Num::int(10)
}

/// The ends and step a variable's type gives: `int 0..10` is 0, 10 and 1.
fn contract_ends(ctx: &Ctx<'_>) -> (Option<Num>, Option<Num>, Option<Num>) {
    let Some(t) = ctx.write_type("value") else { return (None, None, None) };
    let n = |x: Option<&xtmd_runtime::ir::Expr>| x.and_then(|x| ctx.page().value(x).ok()).and_then(|v| exact(Some(&v)));
    let c = t.contract.as_ref();
    let range = c.and_then(|c| c.range.as_ref());
    let mut step = n(c.and_then(|c| c.step.as_ref()));
    if step.is_none() && t.name == "core/int" {
        step = Some(Num::int(1));
    }
    (n(range.and_then(|r| r.low.as_ref())), n(range.and_then(|r| r.high.as_ref())), step)
}

/// A slider's ends: from `range` when it is given, then from its variable's contract, then 0..1.
pub fn ends_of(p: &Props<'_>, ctx: &Ctx<'_>) -> Ends {
    let given = match inner(p.get("range")) {
        Some(Value::Range(r)) => (exact(r.low.as_ref()), exact(r.high.as_ref()), exact(r.step.as_ref())),
        _ => (None, None, None),
    };
    let c = contract_ends(ctx);
    let low = given.0.or(c.0).unwrap_or_else(Num::zero);
    let mut high = given.1.or(c.1);
    let mut step = given.2.or(c.2);
    if !matches!(high, Some(h) if h > low) {
        high = Some(match step {
            Some(s) => low.add(s.mul(ten()).unwrap_or(s)).unwrap_or(low),
            None => low.add(Num::int(1)).unwrap_or(low),
        });
    }
    let high = high.unwrap_or(low);
    if !matches!(step, Some(s) if s > Num::zero()) {
        // no step anywhere: a hundredth of the way, so a drag writes a number a person would
        step = high.sub(low).and_then(|d| d.div(Num::int(100))).ok();
    }
    Ends { low, high, step: step.unwrap_or_else(|| Num::parse("0.01").unwrap()) }
}

/// The number on the slider's grid nearest a value, inside its ends, worked out exactly.
pub fn snap(x: Num, e: &Ends) -> Num {
    let steps = x.sub(e.low).and_then(|d| d.div(e.step)).map(|k| k.round()).unwrap_or_else(|_| Num::zero());
    let k = if steps.is_negative() { Num::zero() } else { steps };
    let v = e.low.add(k.mul(e.step).unwrap_or_else(|_| Num::zero())).unwrap_or(e.low);
    if v > e.high {
        let last = e.high.sub(e.low).and_then(|d| d.div(e.step)).map(|k| k.floor()).unwrap_or_else(|_| Num::zero());
        return e.low.add(last.mul(e.step).unwrap_or_else(|_| Num::zero())).unwrap_or(e.low);
    }
    v
}

/// A number picked by dragging, or with the arrow keys by its step, Home and End to its ends.
#[derive(Default)]
pub struct Slider;

impl Widget for Slider {
    fn show(&mut self, ui: &mut Ui, p: &Props<'_>, ctx: &mut Ctx<'_>) {
        let e = ends_of(p, ctx);
        let value = p.exact("value");
        let disabled = p.flag("disabled", false);
        let label = p.text("label");
        let font = ctx.look().font(ctx.page(), "BODY");
        let ink = ctx.core_color("INK");
        let accent = ctx.core_color("ACCENT");
        let line = ctx.core_color("LINE");
        let mut want: Option<Num> = None;
        while let Some(a) = ctx.take_act() {
            match a {
                // only what a drag can reach: on the grid, between the ends
                Act::Write { input, value: Value::Num(x) } if input == "value" && x >= e.low && x <= e.high && snap(x, &e) == x => {
                    if !disabled {
                        want = Some(x);
                    }
                }
                other => ctx.decline(other),
            }
        }
        let input_id = ctx.sub_id("input");
        let shown = value.map(|v| v.show()).unwrap_or_default();
        ctx.root(ui, UiBuilder::new().layout(Layout::top_down(Align::Min)), |ui, ctx| {
            ui.spacing_mut().item_spacing.y = 4.0;
            let l = kit::leaf(ui, ctx.sub_id("label"), kit::plain(&label, kit::font_id(&font), ink), &label, Lay::default());
            ctx.part(ui, l.response.id, "label");
            ui.horizontal(|ui| {
                let width = ui.available_width().clamp(80.0, 240.0);
                let (rect, _) = ui.allocate_exact_size(egui::vec2(width, 22.0), Sense::hover());
                let sense = if disabled { Sense::hover() } else { Sense::click_and_drag() };
                let r = ui.interact(rect, input_id, sense);
                let span = to_f64(&e.high.sub(e.low).unwrap_or_else(|_| Num::int(1)));
                let frac = value.map_or(0.0, |v| ((to_f64(&v) - to_f64(&e.low)) / span).clamp(0.0, 1.0));
                let rail = Rect::from_center_size(rect.center(), egui::vec2(rect.width() - 12.0, 4.0));
                let x = rail.left() + rail.width() * frac as f32;
                let on = if disabled { line } else { accent };
                ui.painter().rect_filled(rail, 2.0, line);
                ui.painter().rect_filled(Rect::from_min_max(rail.min, egui::pos2(x, rail.max.y)), 2.0, on);
                ui.painter().circle_filled(egui::pos2(x, rect.center().y), 7.0, on);
                if r.has_focus() {
                    kit::focus_ring(ui, Rect::from_center_size(egui::pos2(x, rect.center().y), egui::vec2(14.0, 14.0)), 7.0);
                }
                if !disabled {
                    if r.is_pointer_button_down_on() || r.dragged() {
                        if let Some(pos) = r.interact_pointer_pos() {
                            let f = ((pos.x - rail.left()) / rail.width()).clamp(0.0, 1.0) as f64;
                            let x = values::to_num(to_f64(&e.low) + f * span, 12);
                            want = Some(snap(x, &e));
                        }
                    }
                    if r.is_pointer_button_down_on() || r.drag_started() || r.clicked() {
                        r.request_focus();
                    }
                    if r.has_focus() {
                        ui.memory_mut(|m| m.set_focus_lock_filter(input_id, egui::EventFilter { horizontal_arrows: true, vertical_arrows: true, ..Default::default() }));
                        let now = value.unwrap_or(e.low);
                        let by = |k: i64| snap(now.add(e.step.mul(Num::int(k)).unwrap_or_else(|_| Num::zero())).unwrap_or(now).max_with(e.low).min_with(e.high), &e);
                        ui.input(|i| {
                            if i.key_pressed(Key::ArrowRight) || i.key_pressed(Key::ArrowUp) {
                                want = Some(by(1));
                            }
                            if i.key_pressed(Key::ArrowLeft) || i.key_pressed(Key::ArrowDown) {
                                want = Some(by(-1));
                            }
                            if i.key_pressed(Key::PageUp) {
                                want = Some(by(10));
                            }
                            if i.key_pressed(Key::PageDown) {
                                want = Some(by(-10));
                            }
                            if i.key_pressed(Key::Home) {
                                want = Some(e.low);
                            }
                            if i.key_pressed(Key::End) {
                                want = Some(snap(e.high, &e));
                            }
                        });
                    }
                }
                let name = label.clone();
                let text = shown.clone();
                a11y::edit(ui, input_id, |n| {
                    n.set_role(Role::Slider);
                    n.set_label(name);
                    if let Some(v) = value {
                        n.set_numeric_value(to_f64(&v));
                        n.set_value(text);
                    }
                    n.set_min_numeric_value(to_f64(&e.low));
                    n.set_max_numeric_value(to_f64(&e.high));
                    n.set_numeric_value_step(to_f64(&e.step));
                    if disabled {
                        n.set_disabled();
                    }
                });
                a11y::bounds(ui, input_id, rect);
                ctx.part(ui, input_id, "input");
                let v = kit::leaf(ui, ctx.sub_id("value"), kit::plain(&shown, kit::font_id(&font), ink), &shown, Lay { wrap: false, ..Lay::default() });
                ctx.part(ui, v.response.id, "value");
            });
        });
        if let Some(w) = want {
            if value != Some(w) {
                ctx.write("value", Value::Num(w));
            }
        }
    }
}

/// `max`/`min` on exact numbers.
trait Clamp {
    fn max_with(self, o: Num) -> Num;
    fn min_with(self, o: Num) -> Num;
}

impl Clamp for Num {
    fn max_with(self, o: Num) -> Num {
        if self < o {
            o
        } else {
            self
        }
    }

    fn min_with(self, o: Num) -> Num {
        if self > o {
            o
        } else {
            self
        }
    }
}

// ---- overlay

/// Content shown over the page from its anchor: a popover, a menu, a dialog or a tooltip. The
/// reader opening or closing it writes `open`, then tells `open_changed`.
#[derive(Default)]
pub struct Overlay {
    body: Option<Rect>,
}

impl Widget for Overlay {
    fn show(&mut self, ui: &mut Ui, p: &Props<'_>, ctx: &mut Ctx<'_>) {
        let mode = p.case("mode").unwrap_or("POPOVER");
        let tooltip = mode == "TOOLTIP";
        let open = p.flag("open", false);
        let label = p.text("label");
        let mut want: Option<bool> = None;
        while let Some(a) = ctx.take_act() {
            match a {
                Act::Write { input, value: Value::Bool(b) } if input == "open" => {
                    if b != open {
                        want = Some(b);
                    }
                }
                other => ctx.decline(other),
            }
        }
        let anchor_id = ctx.sub_id("anchor");
        let body_id = ctx.sub_id("body");
        let root_id = ctx.id();
        let surface = ctx.core_color("SURFACE");
        let line = ctx.core_color("LINE");
        let anchor_words: String = p.slot("anchor").iter().map(|d| values::text(d.props.get("value")).to_string() + &values::text(d.props.get("label"))).collect::<Vec<_>>().join(" ");
        let mut refocus = false;
        let body_was = self.body;
        let mut body_now = None;
        ctx.root(ui, UiBuilder::new(), |ui, ctx| {
            // the anchor: a button around what the anchor slot holds
            let sense = if tooltip { Sense::hover() | Sense::focusable_noninteractive() } else { Sense::click() };
            let a = ui.scope_builder(UiBuilder::new().scope_id(anchor_id).sense(sense).accessibility_role(Role::Button), |ui| {
                ctx.part(ui, anchor_id, "anchor");
                ctx.slot(ui, "anchor");
            });
            let ar = a.response;
            let name = if anchor_words.trim().is_empty() { label.clone() } else { anchor_words.trim().to_string() };
            a11y::edit(ui, anchor_id, |n| {
                n.set_label(name);
                if !tooltip {
                    n.set_expanded(open);
                    n.set_has_popup(HasPopup::Dialog);
                }
            });
            a11y::bounds(ui, anchor_id, ar.rect);
            if ar.has_focus() {
                kit::focus_ring(ui, ar.rect, 4.0);
            }
            if tooltip {
                let now = ar.hovered() || ar.has_focus();
                if now != open {
                    want = Some(now);
                }
            } else if ar.clicked() {
                want = Some(!open);
                ar.request_focus();
            }
            if open && !tooltip && ui.input(|i| i.key_pressed(Key::Escape)) {
                want = Some(false);
                refocus = true;
            }
            if open {
                let dialog = mode == "DIALOG";
                if dialog {
                    // a backdrop: a press on it closes the dialog, as Escape does
                    let screen = ui.ctx().content_rect();
                    egui::Area::new(root_id.with("backdrop")).order(egui::Order::Foreground).fixed_pos(screen.min).fade_in(false).show(ui.ctx(), |ui| {
                        let r = ui.allocate_rect(screen, Sense::click());
                        ui.painter().rect_filled(screen, 0.0, Color32::from_black_alpha(80));
                        if r.clicked() {
                            want = Some(false);
                            refocus = true;
                        }
                    });
                }
                let mut area = egui::Area::new(body_id.with("area")).order(egui::Order::Foreground).fade_in(false).accessibility_parent(root_id).interactable(!tooltip);
                area = if dialog { area.anchor(egui::Align2::CENTER_CENTER, egui::vec2(0.0, 0.0)) } else { area.fixed_pos(ar.rect.left_bottom() + egui::vec2(0.0, 4.0)) };
                let role = if tooltip { Role::Tooltip } else { Role::Dialog };
                let name = label.clone();
                let shown = area.show(ui.ctx(), |ui| {
                    let b = ui.scope_builder(UiBuilder::new().scope_id(body_id).accessibility_role(role).accessibility_label(name), |ui| {
                        ctx.part(ui, body_id, "body");
                        a11y::edit(ui, body_id, |n| n.set_class_name(mode.to_lowercase()));
                        egui::Frame::popup(ui.style()).fill(surface).stroke(Stroke::new(1.0, line)).show(ui, |ui| {
                            ctx.slot(ui, "body");
                        });
                    });
                    a11y::bounds(ui, body_id, b.response.rect);
                    b.response.rect
                });
                body_now = Some(shown.inner);
                // a press outside a popover or a menu closes it
                if !tooltip && !dialog && want.is_none() {
                    let outside = ui.input(|i| i.pointer.primary_clicked() && i.pointer.interact_pos().is_some_and(|pos| !ar.rect.contains(pos) && !body_was.is_some_and(|b| b.contains(pos))));
                    if outside {
                        want = Some(false);
                    }
                }
            } else {
                ctx.keep("body");
            }
        });
        self.body = body_now;
        if let Some(w) = want {
            if w != open {
                ctx.write("open", Value::Bool(w));
                ctx.event("open_changed", Vec::new());
            }
        }
        if refocus {
            ui.memory_mut(|m| m.request_focus(anchor_id));
        }
    }
}

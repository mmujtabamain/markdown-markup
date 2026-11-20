//! egui's two kinds of target in one window: xtmd-egui's XtmdDoc drawing an IR built ahead (run
//! time, no compiler), and XtmdLiveDoc compiling its text in the app (real time). With `--demo` it
//! drives itself (presses, a snapshot and restore, an edit, a broken draft) with a caption under it,
//! for a recording.
//!
//!   cargo run --release -p xtmd-egui-live --example targets --features app -- page.xtmd page.ir.json [--demo]

use std::time::Instant;

use xtmd_egui::doc::{DocOptions, XtmdDoc, Snapshot, State};
use xtmd_egui::runtime::Drawn;
use xtmd_egui::Act;
use xtmd_egui_live::{Followed, XtmdLiveDoc};

/// What the script does, at a time from the start.
enum Step {
    Say(&'static str),
    Press,
    Snapshot,
    Restore,
    Type(&'static str),
    Erase(usize),
    Quit,
}

const SCRIPT: &[(f32, Step)] = &[
    (0.5, Step::Say("egui's two kinds of target, in one window.")),
    (3.5, Step::Say("Run time: XtmdDoc draws an IR built ahead (xtmd build). No compiler.")),
    (6.5, Step::Say("A press: the page writes $state, checked by xtmd.")),
    (7.5, Step::Press),
    (8.8, Step::Press),
    (10.5, Step::Say("A snapshot of everything the page holds...")),
    (11.3, Step::Snapshot),
    (12.3, Step::Press),
    (13.8, Step::Say("...and restore puts it back.")),
    (14.6, Step::Restore),
    (17.0, Step::Say("Real time: XtmdLiveDoc compiles this text in the app, with xtmd-live.")),
    (19.5, Step::Say("An edit: a counter that steps by 10.")),
    (20.0, Step::Type("\n@counter(by = 10);\n")),
    (24.5, Step::Say("Compiled as it is typed, and drawn by egui.")),
    (27.5, Step::Say("A mistake: the step left out.")),
    (28.0, Step::Type("@counter(by = );")),
    (31.0, Step::Say("It doesn't compile: the error says where, and the last page stays.")),
    (35.5, Step::Say("Taking the mistake out draws it again.")),
    (36.0, Step::Erase(16)),
    (39.5, Step::Say("egui: XtmdDoc and XtmdLiveDoc, each held to the 62 conformance cases.")),
    (44.0, Step::Quit),
];

struct Demo {
    run: XtmdDoc,
    live: XtmdLiveDoc,
    text: String,
    run_state: State,
    live_state: State,
    status: (bool, String),
    saved: Option<Snapshot>,
    started: Instant,
    next: usize,
    caption: String,
    typing: Vec<char>,
    erasing: usize,
    last_key: f32,
    edited_at: Option<f32>,
    script: bool,
}

/// The line `$state` reads as: `count = 2`.
fn line(s: &State) -> String {
    s.iter().map(|(k, x)| format!("{} = {}", k, serde_json::to_value(x).ok().and_then(|v| v.get("num").and_then(|n| n.as_str()).map(str::to_string)).unwrap_or_else(|| "…".into()))).collect::<Vec<_>>().join(", ")
}

fn first_press(nodes: &[Drawn]) -> Option<String> {
    nodes.iter().find_map(|n| if n.widget == "core/press" { Some(n.path.clone()) } else { n.slots.values().find_map(|k| first_press(k)) })
}

impl Demo {
    fn act(&mut self, now: f32) {
        while self.script && self.next < SCRIPT.len() && SCRIPT[self.next].0 <= now {
            match &SCRIPT[self.next].1 {
                Step::Say(s) => self.caption = s.to_string(),
                Step::Press => {
                    if let Some(p) = first_press(self.run.page().tree()) {
                        self.run.view_mut().act(&p, Act::Event { name: "click".into(), args: Vec::new() });
                    }
                }
                Step::Snapshot => self.saved = Some(self.run.snapshot()),
                Step::Restore => {
                    if let Some(s) = self.saved.clone() {
                        self.run.restore(&s);
                        self.run_state = self.run.state();
                    }
                }
                Step::Type(t) => self.typing.extend(t.chars()),
                Step::Erase(n) => self.erasing += n,
                Step::Quit => std::process::exit(0),
            }
            self.next += 1;
        }
        // a key every 60 ms, as a person types
        if now - self.last_key > 0.06 {
            if !self.typing.is_empty() {
                self.text.push(self.typing.remove(0));
                self.last_key = now;
                self.edited_at = Some(now);
            } else if self.erasing > 0 {
                self.text.pop();
                self.erasing -= 1;
                self.last_key = now;
                self.edited_at = Some(now);
            }
        }
        // the text compiled 150 ms after the last key, as an editor would
        if self.edited_at.is_some_and(|t| now - t > 0.15) {
            self.edited_at = None;
            self.compile();
        }
    }

    fn compile(&mut self) {
        match self.live.set_text(&self.text) {
            Followed::Compiled => self.status = (true, "Compiled in the app".into()),
            Followed::Broken => self.status = (false, self.live.why().unwrap_or_default().replace("page.xtmd doesn't compile", "Doesn't compile")),
            Followed::Same => {}
        }
    }
}

impl eframe::App for Demo {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let now = self.started.elapsed().as_secs_f32();
        self.act(now);
        ui.ctx().request_repaint();
        // the window's own background, as a panel would paint it
        ui.painter().rect_filled(ui.ctx().content_rect(), 0.0, ui.visuals().panel_fill);
        let mono = egui::FontId::monospace(13.0);
        egui::Frame::new().inner_margin(16.0).show(ui, |ui| {
            ui.heading("One page, egui's two kinds of target");
            ui.add_space(8.0);
            ui.columns(2, |cols| {
                let ui = &mut cols[0];
                ui.strong("Run time: xtmd_egui::doc::XtmdDoc");
                ui.weak("XtmdDoc::open(\"page.ir.json\"): the IR xtmd build wrote. No compiler in the app.");
                ui.add_space(6.0);
                egui::Frame::group(ui.style()).show(ui, |ui| {
                    // in a scroll area, as an app draws a page (xtmd_egui::run_window)
                    egui::ScrollArea::vertical().id_salt("run").max_height(470.0).show(ui, |ui| {
                        let r = self.run.show(ui);
                        if let Some(s) = r.state {
                            self.run_state = s;
                        }
                    });
                });
                ui.label(egui::RichText::new(format!("$state: {}", line(&self.run_state))).font(mono.clone()));
                if let Some(s) = &self.saved {
                    ui.label(egui::RichText::new(format!("snapshot: {}", line(&s.state))).font(mono.clone()).weak());
                }

                let ui = &mut cols[1];
                ui.strong("Real time: xtmd_egui_live::XtmdLiveDoc");
                ui.weak("XtmdLiveDoc::new(text): compiled in the app as it changes.");
                ui.add_space(6.0);
                let edit = egui::TextEdit::multiline(&mut self.text).font(mono.clone()).desired_rows(7).desired_width(f32::INFINITY);
                egui::ScrollArea::vertical().id_salt("source").max_height(140.0).stick_to_bottom(true).show(ui, |ui| {
                    if ui.add(edit).changed() {
                        self.edited_at = Some(now);
                    }
                });
                let (ok, s) = &self.status;
                ui.colored_label(if *ok { egui::Color32::from_rgb(21, 128, 61) } else { egui::Color32::from_rgb(198, 40, 40) }, s);
                egui::Frame::group(ui.style()).show(ui, |ui| {
                    egui::ScrollArea::vertical().id_salt("live").max_height(330.0).stick_to_bottom(true).show(ui, |ui| {
                        let r = self.live.show(ui);
                        if let Some(s) = r.state {
                            self.live_state = s;
                        }
                    });
                });
                ui.label(egui::RichText::new(format!("$state: {}", line(&self.live_state))).font(mono));
            });
        });
        // the caption, at the foot of the window
        if !self.caption.is_empty() {
            let rect = ui.ctx().content_rect();
            let painter = ui.ctx().layer_painter(egui::LayerId::new(egui::Order::Foreground, egui::Id::unique("caption")));
            let galley = painter.layout(self.caption.clone(), egui::FontId::proportional(22.0), egui::Color32::WHITE, rect.width() - 160.0);
            let at = egui::pos2(rect.center().x - galley.size().x / 2.0, rect.bottom() - galley.size().y - 36.0);
            painter.rect_filled(egui::Rect::from_min_size(at, galley.size()).expand(12.0), 6.0, egui::Color32::from_rgba_unmultiplied(20, 22, 26, 230));
            painter.galley(at, galley, egui::Color32::WHITE);
        }
    }
}

fn main() -> eframe::Result {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let text = std::fs::read_to_string(&args[0]).expect("read the page's text");
    let run = XtmdDoc::open(&args[1], DocOptions { fixed_theme: true, ..DocOptions::default() }).expect("open the IR");
    let live = XtmdLiveDoc::new(&text, DocOptions { fixed_theme: true, ..DocOptions::default() });
    let run_state = run.state();
    let live_state = live.doc().map(|d| d.state()).unwrap_or_default();
    let demo = Demo {
        run,
        live,
        text,
        run_state,
        live_state,
        status: (true, "Compiled in the app".into()),
        saved: None,
        started: Instant::now(),
        next: 0,
        caption: String::new(),
        typing: Vec::new(),
        erasing: 0,
        last_key: 0.0,
        edited_at: None,
        script: args.iter().any(|a| a == "--demo"),
    };
    let options = eframe::NativeOptions { viewport: egui::ViewportBuilder::default().with_inner_size([1280.0, 800.0]).with_position([0.0, 0.0]).with_decorations(false).with_title("Extended Mark targets"), ..Default::default() };
    eframe::run_native("Extended Mark targets", options, Box::new(|cc| {
        cc.egui_ctx.set_theme(egui::Theme::Light);
        Ok(Box::new(demo))
    }))
}

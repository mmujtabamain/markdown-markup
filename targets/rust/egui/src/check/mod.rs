//! Driving a page headless, as the check adapters do: an [`MkpPage`] in egui_kittest's harness,
//! with real egui input (pointer, keys, text) aimed at the nodes of its AccessKit tree, and the
//! tree read back the way a screen reader reads it.
//!
//! Nodes are found by their author ids ([`crate::a11y`]): a widget's root by its path, its parts
//! by `<short name>.<part>`.

pub mod source;

use egui::accesskit::{self, Role, Toggled};
use egui::{Event, Key, Modifiers, PointerButton, Pos2, Rect, Vec2};
use egui_kittest::kittest::AccessKitNode;
use egui_kittest::Harness;

use crate::MkpPage;

/// Simulated time per frame: 60 frames a second.
pub const STEP_DT: f32 = 1.0 / 60.0;

/// An [`MkpPage`] in a headless harness.
pub struct Headless {
    pub harness: Harness<'static, MkpPage>,
}

impl Headless {
    /// The page in a window of a size, light or dark, its widgets 8 points from the corner.
    pub fn new(page: MkpPage, size: Vec2, dark: bool) -> Headless {
        let harness = Harness::builder()
            .with_size(size)
            .with_pixels_per_point(1.0)
            .with_step_dt(STEP_DT)
            .with_max_steps(600)
            // the checks are the judge of names, so a missing one is reported as on every target
            .with_accessibility_check(false)
            .allow_missing_glyphs()
            .with_theme(if dark { egui::Theme::Dark } else { egui::Theme::Light })
            .with_context_setup(|ctx| {
                ctx.all_styles_mut(|s| s.animation_time = 0.0);
            })
            .build_ui_state(
                |ui, page: &mut MkpPage| {
                    let screen = ui.ctx().content_rect();
                    ui.painter().rect_filled(screen, 0.0, ui.visuals().panel_fill);
                    let inner = screen.shrink(8.0);
                    ui.scope_builder(egui::UiBuilder::new().max_rect(inner), |ui| {
                        page.show(ui);
                    });
                },
                page,
            );
        Headless { harness }
    }

    pub fn page(&mut self) -> &mut MkpPage {
        self.harness.state_mut()
    }

    /// Runs frames until nothing changes: no repaint asked for, no act waiting, nothing moving.
    pub fn settle(&mut self) -> Result<(), String> {
        for _ in 0..4 {
            self.harness.try_run().map_err(|e| format!("the page did not settle: {}", e))?;
            if !self.harness.state().acting() {
                return Ok(());
            }
            self.harness.step();
        }
        Ok(())
    }

    /// The tree's root.
    pub fn root(&self) -> AccessKitNode<'_> {
        self.harness.kittest_state().root()
    }

    /// A widget's root node, by its path.
    pub fn widget(&self, path: &str) -> Option<AccessKitNode<'_>> {
        let suffix = format!("@{}", path);
        all(self.root()).into_iter().find(|n| n.author_id().is_some_and(|a| a.ends_with(&suffix) && !a[..a.len() - suffix.len()].contains('@')))
    }

    /// Clicks with the primary button at a point: the pointer moves there, presses, lets go.
    pub fn click_at(&mut self, pos: Pos2) {
        self.harness.event(Event::PointerMoved(pos));
        for pressed in [true, false] {
            self.harness.event(Event::PointerButton { pos, button: PointerButton::Primary, pressed, modifiers: Modifiers::default() });
        }
    }

    /// The pointer moved to a point.
    pub fn hover_at(&mut self, pos: Pos2) {
        self.harness.event(Event::PointerMoved(pos));
    }

    /// A drag from one point by a distance, with the primary button.
    pub fn drag(&mut self, from: Pos2, by: Vec2) {
        let to = from + by;
        self.harness.event(Event::PointerMoved(from));
        self.harness.event(Event::PointerButton { pos: from, button: PointerButton::Primary, pressed: true, modifiers: Modifiers::default() });
        for k in 1..=4 {
            self.harness.event(Event::PointerMoved(from + by * (k as f32 / 4.0)));
        }
        self.harness.event(Event::PointerButton { pos: to, button: PointerButton::Primary, pressed: false, modifiers: Modifiers::default() });
    }

    /// Asks AccessKit to focus a node, as a screen reader does.
    pub fn focus(&mut self, node: (accesskit::NodeId, accesskit::TreeId)) {
        self.harness.event(Event::AccessKitActionRequest(accesskit::ActionRequest { action: accesskit::Action::Focus, target_node: node.0, target_tree: node.1, data: None }));
    }

    /// A key pressed and let go, with its modifiers: `Enter`, `Shift+Tab`, `Control+Enter`.
    pub fn key(&mut self, combo: &str) -> Result<(), String> {
        let (mods, key) = keys(combo)?;
        if mods != Modifiers::NONE {
            self.harness.event(Event::ModifiersChanged(mods));
        }
        for pressed in [true, false] {
            self.harness.event(Event::Key { key, physical_key: None, pressed, repeat: false, modifiers: mods });
        }
        if mods != Modifiers::NONE {
            self.harness.event(Event::ModifiersChanged(Modifiers::NONE));
        }
        Ok(())
    }

    /// Text typed into what has the focus, a character at a time, each in a frame of its own.
    pub fn type_text(&mut self, text: &str) {
        for c in text.chars() {
            if c == '\n' {
                let _ = self.key("Enter");
            } else {
                self.harness.event(Event::Text(c.to_string()));
            }
        }
    }
}

/// `Shift+Tab` → (Shift, Tab). Control is Command too, as it is off the Mac.
pub fn keys(combo: &str) -> Result<(Modifiers, Key), String> {
    let mut mods = Modifiers::NONE;
    let mut parts: Vec<&str> = combo.split('+').collect();
    let last = parts.pop().unwrap_or_default();
    let key = Key::from_name(last).ok_or_else(|| format!("unknown key {}", last))?;
    for m in parts {
        match m {
            "Shift" => mods.shift = true,
            "Control" | "Ctrl" => {
                mods.ctrl = true;
                mods.command = true;
            }
            "Alt" => mods.alt = true,
            "Meta" => {
                mods.mac_cmd = true;
                mods.command = true;
            }
            other => return Err(format!("unknown modifier {}", other)),
        }
    }
    Ok((mods, key))
}

/// Every node under one, itself first, in the order the tree holds them.
pub fn all(root: AccessKitNode<'_>) -> Vec<AccessKitNode<'_>> {
    let mut out = Vec::new();
    let mut stack = vec![root];
    while let Some(n) = stack.pop() {
        out.push(n);
        let kids: Vec<_> = n.children().collect();
        stack.extend(kids.into_iter().rev());
    }
    out
}

/// A node's box on the screen, in points; `None` when it has none.
pub fn rect(n: &AccessKitNode<'_>) -> Option<Rect> {
    let b = n.bounding_box()?;
    Some(Rect::from_min_max(egui::pos2(b.x0 as f32, b.y0 as f32), egui::pos2(b.x1 as f32, b.y1 as f32)))
}

/// What a node shows: a text box's or a label's value; otherwise its children's words, one block
/// per line; a leaf with neither, its name.
pub fn text(n: &AccessKitNode<'_>) -> String {
    if matches!(n.role(), Role::TextInput | Role::MultilineTextInput | Role::Label) || n.data().value().is_some() && n.children().len() == 0 {
        return n.data().value().map(str::to_string).unwrap_or_default();
    }
    let kids: Vec<String> = n.children().filter(|k| !k.is_hidden()).map(|k| text(&k)).filter(|t| !t.is_empty()).collect();
    if kids.is_empty() {
        if n.children().len() == 0 {
            return n.data().label().map(str::to_string).unwrap_or_default();
        }
        return String::new();
    }
    kids.join("\n")
}

/// The accessible name.
pub fn name(n: &AccessKitNode<'_>) -> Option<String> {
    n.label()
}

/// AccessKit's role as the WAI-ARIA role a contract names; other roles by their own name.
pub fn aria_role(role: Role) -> String {
    match role {
        Role::Button | Role::DefaultButton => "button".into(),
        Role::CheckBox => "checkbox".into(),
        Role::Switch => "switch".into(),
        Role::Slider | Role::SpinButton => "slider".into(),
        Role::TextInput | Role::MultilineTextInput | Role::SearchInput | Role::EmailInput | Role::NumberInput | Role::PasswordInput | Role::PhoneNumberInput | Role::UrlInput => "textbox".into(),
        Role::Heading => "heading".into(),
        Role::Status => "status".into(),
        Role::GenericContainer => "generic".into(),
        Role::Image => "img".into(),
        Role::Tab => "tab".into(),
        Role::TabList => "tablist".into(),
        Role::ListBoxOption => "option".into(),
        Role::ListBox => "listbox".into(),
        Role::RadioButton => "radio".into(),
        Role::RadioGroup => "radiogroup".into(),
        Role::Dialog => "dialog".into(),
        Role::Tooltip => "tooltip".into(),
        Role::Group => "group".into(),
        Role::List => "list".into(),
        Role::ListItem => "listitem".into(),
        Role::Paragraph => "paragraph".into(),
        Role::Alert => "alert".into(),
        Role::Link => "link".into(),
        Role::Math => "math".into(),
        Role::Note => "note".into(),
        Role::Blockquote => "blockquote".into(),
        Role::Table => "table".into(),
        Role::Cell => "cell".into(),
        Role::ColumnHeader => "columnheader".into(),
        Role::Splitter => "separator".into(),
        other => format!("{:?}", other).to_lowercase(),
    }
}

/// Whether a node is chosen: selected, or a pressed toggle, a checked switch or box.
pub fn selected(n: &AccessKitNode<'_>) -> bool {
    n.is_selected().unwrap_or(false) || n.toggled() == Some(Toggled::True)
}

/// Whether a node is checked, or `None` when it can't be.
pub fn checked(n: &AccessKitNode<'_>) -> Option<bool> {
    n.toggled().map(|t| t == Toggled::True)
}

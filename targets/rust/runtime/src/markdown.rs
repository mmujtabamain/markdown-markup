//! Markdown out (page 1, plan tab 13): the page written as Markdown with the values it has now,
//! in one spelling for each block and mark. A port of @mkp/runtime's `markdown.ts`, reading the
//! live page: `$state`, the page's values and each widget's own variables as they are. The
//! blocks are written by mkp-markdown, as the compiler writes a page's starting Markdown.

use std::collections::BTreeMap;
use std::rc::Rc;

use mkp_eval::interp::R;
use mkp_eval::{Binding, FailKind, Failure, Machine, Value};
use mkp_ir::ir::{Expr, Node};
use mkp_markdown::{join_runs, Align, Block, Inline, Item};

use crate::page::{join, Env, Rt};

enum Piece {
    Block(Block),
    Item(Item),
}

fn field<'a>(v: Option<&'a Value>, name: &str) -> Option<&'a Value> {
    match v? {
        Value::Record(r) => r.get(name),
        Value::Case(c) => c.values.iter().find(|(k, _)| &**k == name).map(|(_, x)| x),
        _ => None,
    }
}

fn text_of(v: Option<&Value>) -> String {
    match v {
        Some(Value::Text(t)) => t.to_string(),
        Some(Value::Num(n)) => n.show(),
        Some(Value::Opt(Some(x))) => text_of(Some(x)),
        _ => String::new(),
    }
}

fn items_of(v: Option<&Value>) -> Vec<Value> {
    match v {
        Some(Value::List(l)) => l.items.iter().map(|i| i.value.clone()).collect(),
        _ => Vec::new(),
    }
}

/// A number as JavaScript's `Number()` reads the text it shows: how the web writes a heading's
/// level and a list's start.
fn number(v: Option<&Value>) -> Option<f64> {
    match v {
        Some(Value::Num(n)) => n.show().parse::<f64>().ok(),
        _ => None,
    }
}

/// A template's text: its pieces with each hole's shown text between them.
fn template_text(v: Option<&Value>) -> String {
    let pieces = items_of(field(v, "pieces"));
    let holes = items_of(field(v, "holes"));
    let mut out = String::new();
    for (k, p) in pieces.iter().enumerate() {
        out.push_str(&text_of(Some(p)));
        if let Some(h) = holes.get(k) {
            out.push_str(&text_of(field(Some(h), "value")));
        }
    }
    out
}

/// List items that follow one another make one list, across a loop's turns too (page 3).
fn blocks_of(pieces: Vec<Piece>) -> Vec<Block> {
    let mut out: Vec<Block> = Vec::new();
    for p in pieces {
        let b = match p {
            Piece::Block(b) => b,
            Piece::Item(i) => Block::Bullets { ordered: false, start: 1, items: vec![i] },
        };
        if let (Some(Block::Bullets { ordered: o1, items: i1, .. }), Block::Bullets { ordered: o2, items: i2, .. }) = (out.last_mut(), &b) {
            if *o1 == *o2 {
                i1.extend(i2.iter().cloned());
                continue;
            }
        }
        out.push(b);
    }
    out
}

/// A block's words, for a view placed in a sentence.
fn plain(b: &Block) -> String {
    let runs = |r: &[Inline]| {
        r.iter()
            .map(|i| match i {
                Inline::Text { value, .. } | Inline::Code(value) | Inline::Math(value) => value.clone(),
                Inline::Image { alt, .. } => alt.clone(),
                _ => String::new(),
            })
            .collect::<String>()
    };
    match b {
        Block::Paragraph(r) | Block::Heading { inline: r, .. } => runs(r),
        Block::Quote(bs) => bs.iter().map(plain).collect::<Vec<_>>().join(" "),
        _ => String::new(),
    }
}

struct Writer<'r> {
    rt: &'r Rt,
    depth: u32,
}

impl Writer<'_> {
    fn nodes(&mut self, m: &mut Machine, nodes: &[Node], env0: &Env) -> R<Vec<Piece>> {
        let mut env = env0.clone();
        let mut out = Vec::new();
        for n in nodes {
            match n {
                Node::Declare(d) => {
                    let v = self.rt.eval_in(m, &env, &d.let_.value)?;
                    env.bindings.push((Rc::from(d.let_.name.as_str()), Binding::Value(v)));
                }
                Node::For(f) => {
                    // rows by position for paths, and by item for identity, as drawing walks them
                    for (k, row) in self.rt.keyed_rows(m, f, &env)?.into_iter().enumerate() {
                        let mut bindings = env.bindings.clone();
                        bindings.extend(row.bindings);
                        let key = env.key.clone().unwrap_or_else(|| env.path.clone());
                        let inner = Env { owner: env.owner, bindings, path: join(&env.path, &format!("{}[{}]", f.site, k)), key: Some(join(&key, &format!("{}[{}]", f.site, row.key))) };
                        out.extend(self.nodes(m, &f.body, &inner)?);
                    }
                }
                Node::If(i) => {
                    let (nodes, inner) = self.rt.pick_branch(m, i, &env)?;
                    out.extend(self.nodes(m, nodes, &inner)?);
                }
                Node::Match(mt) => {
                    let v = self.rt.eval_in(m, &env, &mt.value)?;
                    let mut done = false;
                    for c in &mt.cases {
                        if let Some(binds) = self.rt.matches(m, &v, &c.when)? {
                            let mut inner = env.clone();
                            inner.bindings.extend(binds);
                            out.extend(self.nodes(m, &c.then, &inner)?);
                            done = true;
                            break;
                        }
                    }
                    if !done {
                        out.extend(self.nodes(m, &mt.else_, &env)?);
                    }
                }
                Node::Place(p) => {
                    let v = self.rt.eval_in(m, &env, &p.view)?;
                    out.extend(self.view(m, &v, &env, &join(&env.path, &p.site))?);
                }
                Node::Extern(x) => {
                    let mut props = BTreeMap::new();
                    for (k, e) in &x.props {
                        props.insert(k.clone(), self.rt.eval_in(m, &env, e)?);
                    }
                    for (k, p) in &x.writes {
                        props.insert(k.clone(), m.eval_with(&env.bindings, env.owner, &Expr::Place(p.clone()))?);
                    }
                    let path = join(&env.path, &x.site);
                    out.extend(self.widget(m, &x.name, &path, props, &BTreeMap::new(), &x.slots, &env, &path.clone(), &BTreeMap::new())?);
                }
                Node::Use(u) => {
                    let key = join(env.key.as_deref().unwrap_or(&env.path), &u.site);
                    out.extend(self.widget(m, &u.name, &join(&env.path, &u.site), BTreeMap::new(), &u.args, &u.slots, &env, &key, &u.events)?);
                }
            }
        }
        Ok(out)
    }

    fn view(&mut self, m: &mut Machine, v: &Value, env: &Env, path: &str) -> R<Vec<Piece>> {
        let view = match v {
            Value::Opt(Some(x)) => return self.view(m, x, env, path),
            Value::List(l) => {
                let mut out = Vec::new();
                for (k, i) in l.items.iter().enumerate() {
                    out.extend(self.view(m, &i.value, env, &format!("{}[{}]", path, k))?);
                }
                return Ok(out);
            }
            Value::View(view) => view.clone(),
            _ => return Ok(Vec::new()),
        };
        if &*view.widget == "#slot" {
            return match view.args.get("id").and_then(|id| self.rt.held_slot(id)) {
                Some((nodes, at)) => self.nodes(m, &nodes, &at),
                None => Ok(Vec::new()),
            };
        }
        let made = Env { owner: view.owner, bindings: view.captured.clone(), path: env.path.clone(), key: None };
        // a widget written in MKP is given the view's arguments, as drawing gives them: entered
        // with none, it would be written with its inputs' defaults (and an instance the page drew
        // at the same key would be left without its inputs until the next redraw)
        let args: BTreeMap<String, Expr> = view.args.iter().map(|(k, x)| (k.clone(), x.to_ir())).collect();
        self.widget(m, &view.widget, path, view.args.clone(), &args, &view.slots, &made, path, &view.events)
    }

    fn slot(&mut self, m: &mut Machine, slots: &BTreeMap<String, Vec<Node>>, name: &str, env: &Env) -> R<Vec<Piece>> {
        match slots.get(name) {
            Some(nodes) => self.nodes(m, nodes, env),
            None => Ok(Vec::new()),
        }
    }

    /// A widget: Markdown's own blocks are written directly; any other widget writes its
    /// markdown. `key` and `events` are the call's, as drawing gives them: entering a widget to
    /// write its Markdown finds the instance the page drew.
    #[allow(clippy::too_many_arguments)]
    fn widget(&mut self, m: &mut Machine, name: &str, path: &str, props: BTreeMap<String, Value>, args: &BTreeMap<String, Expr>, slots: &BTreeMap<String, Vec<Node>>, env: &Env, key: &str, events: &BTreeMap<String, String>) -> R<Vec<Piece>> {
        self.depth += 1;
        if self.depth > 64 {
            self.depth -= 1;
            return Err(Failure::new(FailKind::Limit(mkp_eval::interp::Limit::Depth), format!("{} places itself more than 64 deep", name)));
        }
        let out = self.widget_inner(m, name, path, props, args, slots, env, key, events);
        self.depth -= 1;
        match out {
            Ok(out) => Ok(out),
            Err(f) => {
                if name.starts_with("core/") && !self.rt.s.templates.contains_key(name) {
                    return Err(f);
                }
                if self.rt.defect("no-notice") {
                    return Ok(Vec::new());
                }
                // a widget that fails is a notice in its place, a quote in Markdown (page 6)
                let short = name.rsplit('/').next().unwrap_or(name);
                let notice = Inline::Text { value: format!("{} failed: {}", short, f.message), bold: false, italic: false, strike: false, link: None };
                Ok(vec![Piece::Block(Block::Quote(vec![Block::Paragraph(vec![notice])]))])
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn widget_inner(&mut self, m: &mut Machine, name: &str, path: &str, props: BTreeMap<String, Value>, args: &BTreeMap<String, Expr>, slots: &BTreeMap<String, Vec<Node>>, env: &Env, key: &str, events: &BTreeMap<String, String>) -> R<Vec<Piece>> {
        let p = |k: &str| props.get(k);
        let block = |b: Block| Ok(vec![Piece::Block(b)]);
        match name {
            "core/paragraph" => {
                let runs = self.inline(m, p("value"))?;
                return if runs.is_empty() { Ok(Vec::new()) } else { block(Block::Paragraph(runs)) };
            }
            "core/heading" => {
                let level = number(p("level")).map_or(1.0, |l| l.clamp(1.0, 6.0)).floor() as u8;
                let inline = self.inline(m, p("value"))?;
                return block(Block::Heading { level, inline });
            }
            "core/bullets" => {
                let ordered = matches!(p("ordered"), Some(Value::Bool(true)));
                let start = number(p("start")).map_or(1, |s| s as i64);
                let items: Vec<Item> = self
                    .slot(m, slots, "items", env)?
                    .into_iter()
                    .map(|x| match x {
                        Piece::Item(i) => i,
                        Piece::Block(b) => Item { done: None, blocks: vec![b] },
                    })
                    .collect();
                return if items.is_empty() { Ok(Vec::new()) } else { block(Block::Bullets { ordered, start, items }) };
            }
            "core/item" => {
                let done = match p("done") {
                    Some(Value::Opt(Some(d))) => d.as_bool(),
                    Some(Value::Bool(b)) => Some(*b),
                    _ => None,
                };
                let blocks = blocks_of(self.slot(m, slots, "body", env)?);
                return Ok(vec![Piece::Item(Item { done, blocks })]);
            }
            "core/quote" => {
                let blocks = blocks_of(self.slot(m, slots, "body", env)?);
                return block(Block::Quote(blocks));
            }
            "core/code" => return block(Block::Code { lang: text_of(p("lang")), src: text_of(p("src")) }),
            "core/math" => return block(Block::Math(template_text(field(p("tex"), "tex")))),
            "core/divider" => return block(Block::Divider),
            "core/footnote" => {
                let blocks = blocks_of(self.slot(m, slots, "body", env)?);
                return block(Block::Footnote { mark: text_of(p("mark")), blocks });
            }
            "core/table" => {
                let mut head = Vec::new();
                for c in items_of(p("head")) {
                    head.push(self.inline(m, Some(&c))?);
                }
                let mut rows = Vec::new();
                for r in items_of(p("rows")) {
                    let mut row = Vec::new();
                    for c in items_of(Some(&r)) {
                        row.push(self.inline(m, Some(&c))?);
                    }
                    rows.push(row);
                }
                let align = items_of(p("align"))
                    .iter()
                    .map(|a| match a {
                        Value::Case(c) if &*c.name == "CENTER" => Align::Center,
                        Value::Case(c) if &*c.name == "END" => Align::End,
                        _ => Align::Start,
                    })
                    .collect();
                return block(Block::Table { head, rows, align });
            }
            _ => {}
        }
        if let Some(t) = self.rt.s.templates.get(name).cloned() {
            // a widget written in MKP: its markdown, in its instance
            let own = self.rt.enter_use(m, &t, path, args, slots, events, env, key)?;
            return self.nodes(m, &t.markdown, &own);
        }
        if let Some(w) = self.rt.s.extern_widgets.get(name).cloned() {
            let own = self.rt.enter_extern(m, &w, path, &props, slots, env)?;
            let out = self.nodes(m, &w.markdown, &own);
            self.rt.leave(&own);
            return out;
        }
        Err(Failure::ir(format!("there is no widget {} to write", name)))
    }

    /// A rich text's segments as runs; a view in a sentence puts its own Markdown's text there.
    fn inline(&mut self, m: &mut Machine, v: Option<&Value>) -> R<Vec<Inline>> {
        let mut out = Vec::new();
        for seg in items_of(field(v, "segments")) {
            let part = field(Some(&seg), "part");
            let Some(Value::Case(c)) = part else { continue };
            let marks = field(Some(&seg), "marks");
            let flag = |n: &str| matches!(field(marks, n), Some(Value::Bool(true)));
            let link = match field(marks, "link") {
                Some(Value::Opt(Some(l))) => Some(text_of(Some(l))),
                _ => None,
            };
            let text = |value: String| Inline::Text { value, bold: flag("bold"), italic: flag("italic"), strike: flag("strike"), link: link.clone() };
            match &*c.name {
                "TEXT" => out.push(text(text_of(field(part, "value")))),
                "CODE" => out.push(Inline::Code(text_of(field(part, "value")))),
                "MATH" => out.push(Inline::Math(template_text(field(field(part, "tex"), "tex")))),
                "IMAGE" => out.push(Inline::Image { src: text_of(field(part, "src")), alt: text_of(field(part, "alt")) }),
                "NOTE" => out.push(Inline::Note(text_of(field(part, "mark")))),
                "BREAK" => out.push(Inline::Break),
                "VIEW" => {
                    let child = field(part, "child").cloned().unwrap_or_else(Value::none);
                    let blocks = blocks_of(self.view(m, &child, &Env::default(), "")?);
                    let words: Vec<String> = blocks.iter().map(plain).filter(|s| !s.is_empty()).collect();
                    out.push(text(words.join(" ")));
                }
                _ => {}
            }
        }
        Ok(join_runs(out))
    }
}

/// The page's blocks, with the values it has now.
pub(crate) fn page_blocks(rt: &Rt, m: &mut Machine) -> R<Vec<Block>> {
    let Some(doc) = rt.s.templates.get("doc").cloned() else { return Ok(Vec::new()) };
    let mut w = Writer { rt, depth: 0 };
    Ok(blocks_of(w.nodes(m, &doc.markdown, &Env::default())?))
}

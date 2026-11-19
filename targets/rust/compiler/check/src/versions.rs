//! A pack's versions (page 6): what a released version provided, kept as a surface
//! (`package kit@1;`), and the promise that the same version never breaks a use of it.

use std::collections::BTreeMap;

use xtmd_ir::ir;
use xtmd_syntax::ast::{self, Item};
use xtmd_syntax::span::Span;

use crate::{codes, Checker, DefKind, Recv};

/// What a pack provides, by name: what a use can reach and so what a change can break.
#[derive(Clone, Debug, Default)]
pub(crate) struct Api {
    pub items: BTreeMap<String, ApiItem>,
}

#[derive(Clone, Debug)]
pub(crate) struct ApiItem {
    pub kind: &'static str,
    /// Where it's declared: a file of the checker and the name's span.
    pub at: Option<(usize, Span)>,
    pub members: BTreeMap<String, Member>,
    /// What a change to anywhere in it breaks, for a fn, an alias, an interface or a let.
    pub whole: Option<String>,
}

#[derive(Clone, Debug)]
pub(crate) struct Member {
    pub kind: &'static str,
    pub ty: Option<ir::Type>,
    /// Shown as written, and compared with spaces left out.
    pub default: Option<String>,
    pub required: bool,
    pub shape: String,
}

/// A difference between two versions that can break a use.
#[derive(Clone, Debug)]
pub(crate) struct Break {
    pub item: String,
    pub member: Option<String>,
    /// gone, kind, whole, type, shape, default, required or case
    pub kind: &'static str,
    pub what: String,
}

impl Checker {
    /// The pack's `pack` block: its file, the version's span, and the version.
    pub(crate) fn pack_block(&self, pack: &str) -> Option<(usize, Span, u32)> {
        let rec = self.packs.get(pack)?;
        for &f in &rec.files {
            for n in &self.files[f].ast.items {
                if let Item::Decl(ast::Decl { kind: ast::DeclKind::Pack(p), .. }) = &n.item {
                    let v = p.version.name.parse().ok()?;
                    return Some((f, p.name.span.to(p.version.span), v));
                }
            }
        }
        None
    }

    /// What `pack` provides, its types' names written as `as_pack`'s, so a surface and the pack
    /// it was taken from compare name for name.
    pub(crate) fn api(&self, pack: &str, as_pack: &str) -> Api {
        // everything the pack declares: a surface keeps what its version provided and the types
        // those name, and only what the older side has is compared
        let ty = |t: &ir::Type| rename_pack(t, pack, as_pack);
        let mut api = Api::default();
        for def in self.defs.iter().filter(|d| d.pack == pack) {
            let at = Some((def.file, def.span));
            let field = |f: &crate::FieldSym, kind: &'static str, src: &str| Member {
                kind,
                ty: Some(ty(&f.ir)),
                default: f.default.as_ref().map(|e| src[e.span.range()].to_string()),
                required: f.default.is_none() && !is_opt(&f.ir),
                shape: String::new(),
            };
            let src = self.files[def.file].src.clone();
            let mut members = BTreeMap::new();
            let (kind, whole) = match &def.kind {
                DefKind::Widget { inputs, slots, events, .. } => {
                    for i in inputs {
                        members.insert(i.name.clone(), field(i, "input", &src));
                    }
                    for s in slots {
                        members.insert(s.name.clone(), Member { kind: "slot", ty: Some(ty(&s.ir)), default: None, required: false, shape: String::new() });
                    }
                    for e in events {
                        let shape = e.params.iter().map(|p| show_ty(&ty(&p.ir))).collect::<Vec<_>>().join(", ");
                        members.insert(e.name.clone(), Member { kind: "event", ty: None, default: None, required: false, shape: format!("({})", shape) });
                    }
                    ("widget", None)
                }
                DefKind::Record { fields } => {
                    for f in fields {
                        members.insert(f.name.clone(), field(f, "field", &src));
                    }
                    ("record", None)
                }
                DefKind::Enum { cases } | DefKind::Token { cases, .. } => {
                    for c in cases {
                        let shape = c.fields.iter().map(|f| show_ty(&ty(&f.ir))).collect::<Vec<_>>().join(", ");
                        members.insert(c.name.clone(), Member { kind: "case", ty: None, default: None, required: false, shape });
                    }
                    (if matches!(def.kind, DefKind::Enum { .. }) { "enum" } else { "token" }, None)
                }
                DefKind::Alias { target } => ("type", Some(target.as_ref().map(|t| show_ty(&ty(&t.1))).unwrap_or_default())),
                DefKind::Interface { fields, fns, events, .. } => {
                    let mut parts: Vec<String> = fields.iter().map(|f| format!("{}: {}", f.name, show_ty(&ty(&f.ir)))).collect();
                    parts.extend(fns.iter().map(|f| format!("fn {}", f)));
                    parts.extend(events.iter().map(|e| format!("event {}({})", e.name, e.params.iter().map(|p| show_ty(&ty(&p.ir))).collect::<Vec<_>>().join(", "))));
                    ("interface", Some(parts.join("; ")))
                }
                DefKind::ExternType => ("type", Some("extern".into())),
            };
            api.items.insert(def.name.clone(), ApiItem { kind, at, members, whole });
        }
        for f in self.fns.iter().filter(|f| f.pack == pack && f.widget.is_none() && f.sig.is_some()) {
            let on = f.on.map(|r| match r {
                Recv::Builtin(b) => b.to_string(),
                Recv::Def(d) | Recv::Iface(d) => self.defs[d].name.clone(),
            });
            let key = match &on {
                Some(o) => format!("{}.{}", o, f.name),
                None => f.name.clone(),
            };
            let params = f.params.iter().filter(|p| !p.is_self).map(|p| show_ty(&ty(&p.ir))).collect::<Vec<_>>().join(", ");
            let ret = f.ret_ir.as_ref().map(|r| format!(": {}", show_ty(&ty(r)))).unwrap_or_default();
            api.items.insert(key, ApiItem { kind: "fn", at: Some((f.file, f.span)), members: BTreeMap::new(), whole: Some(format!("({}){}", params, ret)) });
        }
        for l in self.lets.iter().filter(|l| l.pack == pack) {
            api.items.insert(l.name.clone(), ApiItem { kind: "let", at: Some((l.file, l.span)), members: BTreeMap::new(), whole: Some(show_ty(&ty(&l.ir))) });
        }
        for c in self.channels.iter().filter(|c| c.pack == pack) {
            let mut members = BTreeMap::new();
            for v in &c.values {
                members.insert(v.name.clone(), Member { kind: "value", ty: Some(ty(&v.ir)), default: None, required: false, shape: String::new() });
            }
            for (n, ps, _, r) in &c.fns {
                let shape = format!("({}){}", ps.iter().map(|p| show_ty(&ty(&p.ir))).collect::<Vec<_>>().join(", "), r.as_ref().map(|r| format!(": {}", show_ty(&ty(r)))).unwrap_or_default());
                members.insert(n.clone(), Member { kind: "fn", ty: None, default: None, required: false, shape });
            }
            api.items.insert(c.name.clone(), ApiItem { kind: "extern", at: Some((c.file, Span::default())), members, whole: None });
        }
        // the cases a pack adds to another pack's token type, such as `color.PRIMARY`
        if let Some(rec) = self.packs.get(pack) {
            for &f in &rec.files {
                for n in &self.files[f].ast.items {
                    let Item::Decl(ast::Decl { kind: ast::DeclKind::Tokens(t), .. }) = &n.item else { continue };
                    for line in t.lines.iter() {
                        if api.items.get(&line.ty.name).map_or(false, |i| i.kind == "token") {
                            continue;
                        }
                        api.items.insert(format!("{}.{}", line.ty.name, line.case.name), ApiItem { kind: "token case", at: Some((f, line.case.span)), members: BTreeMap::new(), whole: None });
                    }
                }
            }
        }
        api
    }

    /// The promise (page 6): a pack keeps what the surface of its own version says it provided.
    pub(crate) fn check_versions(&mut self) {
        let packs: Vec<String> = (self.from.files..self.files.len()).map(|f| self.files[f].pack.clone()).filter(|p| !p.contains('@')).collect::<std::collections::BTreeSet<_>>().into_iter().collect();
        for pack in packs {
            let Some((pfile, pspan, version)) = self.pack_block(&pack) else { continue };
            // a surface of a version this pack hasn't reached
            let surfaces: Vec<(String, u32, usize)> = self
                .packs
                .iter()
                .filter_map(|(name, rec)| {
                    let v: u32 = name.strip_prefix(&format!("{}@", pack))?.parse().ok()?;
                    Some((name.clone(), v, *rec.files.first()?))
                })
                .collect();
            for (name, v, file) in &surfaces {
                if *v > version {
                    let span = self.files[*file].ast.package.as_ref().map(|p| p.item.span).unwrap_or_default();
                    self.error(*file, codes::SURFACE, span, format!("{} is a surface of a version {}@{} hasn't reached: a surface keeps what a released version provided", name, pack, version));
                }
            }
            self.check_migrations(&pack, version);
            let own = format!("{}@{}", pack, version);
            if !self.packs.contains_key(&own) {
                continue;
            }
            let old = self.api(&own, &pack);
            let new = self.api(&pack, &pack);
            for b in breaks(&old, &new) {
                let at = new.items.get(&b.item).and_then(|i| i.at).filter(|(_, s)| *s != Span::default()).unwrap_or((pfile, pspan));
                let msg = format!(
                    "{}'s surface says what this version promised, and this release changes it: {}. A change that can break a use makes a new version: write `pack {}@{}`, with a migration from {} to it",
                    own,
                    b.what,
                    pack,
                    version + 1,
                    own
                );
                self.error(at.0, codes::VERSION_BREAK, at.1, msg);
            }
        }
    }
}

/// Every change from `old` to `new` that can break a use of `old`.
pub(crate) fn breaks(old: &Api, new: &Api) -> Vec<Break> {
    let mut out = Vec::new();
    let mut push = |item: &str, member: Option<&str>, kind: &'static str, what: String| out.push(Break { item: item.to_string(), member: member.map(str::to_string), kind, what });
    for (name, o) in &old.items {
        let Some(n) = new.items.get(name) else {
            push(name, None, "gone", format!("`{}` is gone", name));
            continue;
        };
        if o.kind != n.kind {
            push(name, None, "kind", format!("`{}` was a {} and is now a {}", name, o.kind, n.kind));
            continue;
        }
        if o.whole != n.whole {
            push(name, None, "whole", format!("`{}` was `{}` and is now `{}`", name, o.whole.clone().unwrap_or_default(), n.whole.clone().unwrap_or_default()));
        }
        for (m, om) in &o.members {
            let Some(nm) = n.members.get(m) else {
                push(name, Some(m), "gone", format!("`{}` has no {} `{}` now", name, om.kind, m));
                continue;
            };
            if om.kind != nm.kind {
                push(name, Some(m), "kind", format!("`{}.{}` was a {} and is now a {}", name, m, om.kind, nm.kind));
                continue;
            }
            if let (Some(ot), Some(nt)) = (&om.ty, &nm.ty) {
                if !accepts(nt, ot) {
                    push(name, Some(m), "type", format!("`{}.{}` took `{}` and takes `{}` now", name, m, show_ty(ot), show_ty(nt)));
                }
            }
            if om.shape != nm.shape {
                push(name, Some(m), "shape", format!("`{}.{}` was `{}` and is now `{}`", name, m, om.shape, nm.shape));
            }
            let squash = |d: &Option<String>| d.as_ref().map(|t| t.split_whitespace().collect::<String>());
            if om.default.is_some() && squash(&om.default) != squash(&nm.default) {
                let now = nm.default.clone().map(|d| format!("`{}`", d)).unwrap_or_else(|| "nothing".into());
                push(name, Some(m), "default", format!("`{}.{}`'s default was `{}` and is {} now, which changes every use that leaves it out", name, m, om.default.clone().unwrap_or_default(), now));
            }
        }
        for (m, nm) in &n.members {
            if o.members.contains_key(m) {
                continue;
            }
            if nm.required && (nm.kind == "input" || nm.kind == "field") {
                push(name, Some(m), "required", format!("`{}` has a new {} `{}` with no default", name, nm.kind, m));
            }
            if nm.kind == "case" && n.kind == "enum" {
                push(name, Some(m), "case", format!("`{}` has a new case `{}`, so a `match` that listed every case no longer does", name, m));
            }
        }
    }
    out
}

/// Whether a value of `old` is one `new` takes: the same type, the same without its contract,
/// or the same in an `opt`.
fn accepts(new: &ir::Type, old: &ir::Type) -> bool {
    let same = |a: &ir::Type, b: &ir::Type| a == b;
    if same(new, old) {
        return true;
    }
    if new.contract.is_none() && old.contract.is_some() {
        let mut bare = old.clone();
        bare.contract = None;
        if same(new, &bare) {
            return true;
        }
    }
    is_opt(new) && new.args.len() == 1 && accepts(&new.args[0], old)
}

fn is_opt(t: &ir::Type) -> bool {
    t.name == "opt" || t.name.ends_with("/opt")
}

/// A type's names from `from` written as `to`'s: `kit@1/stat` as `kit/stat`.
fn rename_pack(t: &ir::Type, from: &str, to: &str) -> ir::Type {
    let mut t = t.clone();
    fn walk(t: &mut ir::Type, from: &str, to: &str) {
        if let Some(rest) = t.name.strip_prefix(&format!("{}/", from)) {
            t.name = format!("{}/{}", to, rest);
        }
        for a in t.args.iter_mut() {
            walk(a, from, to);
        }
        if let Some(r) = t.returns.as_mut() {
            walk(r, from, to);
        }
        for p in t.params.iter_mut() {
            walk(&mut p.ty, from, to);
        }
        for f in t.fields.iter_mut() {
            walk(&mut f.ty, from, to);
        }
    }
    walk(&mut t, from, to);
    t
}

/// A type as Extended Mark writes it: `list<point>`, without its pack.
pub(crate) fn show_ty(t: &ir::Type) -> String {
    let name = t.name.rsplit('/').next().unwrap_or(&t.name);
    if t.args.is_empty() {
        name.to_string()
    } else {
        format!("{}<{}>", name, t.args.iter().map(show_ty).collect::<Vec<_>>().join(", "))
    }
}

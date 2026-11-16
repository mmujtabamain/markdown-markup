//! `mkp surface <pack>`: what a pack's version provides, written as that version's surface
//! (`package kit@1;`, page 6), so later versions are held to it and migrate from it.

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use mkp_syntax::ast::{self, DeclKind, Item, Node, WidgetMember};
use mkp_syntax::{parse, Entry};

/// The surface of the pack whose files these are: its name, its version and the file's text.
pub fn surface_of(files: &[mkp_check::Source]) -> Result<(String, String, String), String> {
    let mut parsed = Vec::new();
    for s in files {
        let p = parse(&s.text, Entry::Mkp);
        let Some(f) = p.file else { return Err(format!("{}: doesn't read; mkp check says why", s.path)) };
        // the earlier versions' surfaces are not part of this one
        if f.surface.is_none() {
            parsed.push((s, f));
        }
    }
    let mut block = None;
    for (s, f) in &parsed {
        for n in &f.items {
            if let Item::Decl(ast::Decl { kind: DeclKind::Pack(p), .. }) = &n.item {
                block = Some((p.clone(), s.path.clone()));
            }
        }
    }
    let Some((pack, _)) = block else { return Err("no pack block in these files: a surface is a released version's, and the pack block says the version".into()) };
    let mut keep: std::collections::HashSet<String> = pack.lines.iter().filter_map(|l| if let ast::PackLine::Provides(ns) = l { Some(ns.iter().map(|n| n.name.clone())) } else { None }).flatten().collect();
    // and the pack's own types that what it keeps names, which a surface needs to read
    let types: std::collections::HashMap<String, String> = parsed
        .iter()
        .flat_map(|(s, f)| f.items.iter().filter_map(move |n| match &n.item {
            Item::Decl(d) if matches!(d.kind, DeclKind::Enum(_) | DeclKind::Record(_) | DeclKind::Token(_) | DeclKind::Alias(_) | DeclKind::Interface(_) | DeclKind::ExternType(_)) => Some((d.kind.name().name.clone(), s.text[d.span.range()].to_string())),
            _ => None,
        }))
        .collect();
    loop {
        let mut text = String::new();
        for (s, f) in &parsed {
            for n in &f.items {
                if let Item::Decl(d) = &n.item {
                    if signature(&d.kind, &keep).is_some() {
                        text.push_str(&s.text[d.span.range()]);
                        text.push('\n');
                    }
                }
            }
        }
        let named: Vec<String> = text.split(|c: char| !(c.is_ascii_alphanumeric() || c == '_')).filter(|w| types.contains_key(*w) && !keep.contains(*w)).map(str::to_string).collect();
        if named.is_empty() {
            break;
        }
        keep.extend(named);
    }
    let provides = keep;
    let mut imports: Vec<String> = Vec::new();
    let mut body = String::new();
    for (s, f) in &parsed {
        let mut items = Vec::new();
        for n in &f.items {
            match &n.item {
                Item::Import(_) => items.push(n.clone()),
                Item::Decl(d) => {
                    if let Some(kind) = signature(&d.kind, &provides) {
                        items.push(Node { item: Item::Decl(ast::Decl { kind, span: d.span }), ..n.clone() });
                    }
                }
                _ => {}
            }
        }
        if !items.iter().any(|n| matches!(n.item, Item::Decl(_))) {
            continue;
        }
        let file = ast::File { kind: ast::FileKind::Mkp, front_matter: None, package: None, surface: None, items, dangling: Vec::new(), divider: None, prose: None };
        let printed = mkp_syntax::printer::print(&s.text, &file);
        for line in printed.lines() {
            if line.starts_with("import ") {
                if !imports.contains(&line.to_string()) {
                    imports.push(line.to_string());
                }
            } else {
                body.push_str(line);
                body.push('\n');
            }
        }
        body.push('\n');
    }
    let mut text = format!("package {}@{};\n\n", pack.name.name, pack.version.name);
    if !imports.is_empty() {
        text.push_str(&imports.join("\n"));
        text.push_str("\n\n");
    }
    text.push_str(body.trim_matches('\n'));
    text.push('\n');
    let text = mkp_syntax::format(&text, Entry::Mkp).map_err(|d| format!("the surface doesn't read back: {}", d.first().map(|d| d.message.clone()).unwrap_or_default()))?;
    Ok((pack.name.name.clone(), pack.version.name.clone(), text))
}

/// A declaration as a surface keeps it: a widget or a fn as its signature, a record without its
/// rules, the rest as written. `None` for what the pack doesn't provide.
fn signature(kind: &DeclKind, provides: &std::collections::HashSet<String>) -> Option<DeclKind> {
    let shown = |n: &str| provides.contains(n);
    Some(match kind {
        DeclKind::Widget(w) | DeclKind::ExternWidget(w) if shown(&w.name.name) => {
            let mut w = w.clone();
            w.body = w.body.map(|mut b| {
                b.items.retain(|m| matches!(m.item, WidgetMember::Slot(_) | WidgetMember::Event(_) | WidgetMember::Param(_)));
                b
            });
            if w.body.as_ref().map_or(false, |b| b.items.is_empty()) {
                w.body = None;
            }
            DeclKind::ExternWidget(w)
        }
        // a fn added to a type comes with the pack, provided or not
        DeclKind::Fn(f) | DeclKind::ExternFn(f) if f.sig.on.is_some() || shown(&f.sig.name.name) => DeclKind::ExternFn(ast::FnDecl { sig: f.sig.clone(), body: None }),
        DeclKind::Record(r) if shown(&r.name.name) => {
            let mut r = r.clone();
            r.members.items.retain(|m| matches!(m.item, ast::Member::Field(_)));
            DeclKind::Record(r)
        }
        DeclKind::Enum(d) if shown(&d.name.name) => kind.clone(),
        DeclKind::Token(d) if shown(&d.name.name) => kind.clone(),
        DeclKind::Alias(d) if shown(&d.name.name) => kind.clone(),
        DeclKind::Interface(d) if shown(&d.name.name) => kind.clone(),
        DeclKind::ExternBlock(d) if shown(&d.name.name) => kind.clone(),
        DeclKind::ExternType(d) if shown(&d.name.name) => kind.clone(),
        DeclKind::Let(d) if shown(&d.name.name) => kind.clone(),
        DeclKind::Tokens(_) => kind.clone(),
        _ => return None,
    })
}

const USAGE: &str = "usage: mkp surface <pack folder> [--pack a,b] [-o file] [--check] [--force]
  writes <pack folder>/surfaces/<name>@<version>.mkp, what this version of the pack provides;
  --check writes nothing and fails if it is missing or differs, --force replaces one that differs";

pub fn surface_cmd(args: &[String]) -> ExitCode {
    let check = args.iter().any(|a| a == "--check");
    let force = args.iter().any(|a| a == "--force");
    let rest: Vec<String> = args.iter().filter(|a| *a != "--check" && *a != "--force").cloned().collect();
    let (dirs, deps, out) = match crate::options(&rest) {
        Ok(x) => x,
        Err(e) => {
            eprintln!("{}", e);
            return ExitCode::from(2);
        }
    };
    let Some(dir) = dirs.first() else {
        eprintln!("{}", USAGE);
        return ExitCode::from(2);
    };
    let files = match crate::pack_sources(dir) {
        Ok(f) => f,
        Err(e) => {
            eprintln!("{}", e);
            return ExitCode::from(2);
        }
    };
    let dir_path = Path::new(dir);
    let deps: Vec<mkp_check::Source> = deps.into_iter().filter(|s| !Path::new(&s.path).starts_with(dir_path)).collect();
    // the pack has to compile: a surface of a broken pack would promise what nothing provides
    let own: Vec<mkp_check::Source> = files.iter().filter(|s| parse(&s.text, Entry::Mkp).file.map_or(true, |f| f.surface.is_none())).cloned().collect();
    let c = mkp_check::compile(&crate::core_sources(), &[deps, files.iter().filter(|s| !own.iter().any(|o| o.path == s.path)).cloned().collect()], &own, "main");
    let errors: Vec<_> = c.errors().collect();
    if !errors.is_empty() {
        for d in errors {
            eprintln!("{}", d.diagnostic.render(&d.file, c.texts.get(&d.file).map(String::as_str).unwrap_or("")));
        }
        eprintln!("the pack doesn't compile, so it has no surface yet");
        return ExitCode::from(1);
    }
    let (name, version, text) = match surface_of(&files) {
        Ok(x) => x,
        Err(e) => {
            eprintln!("{}", e);
            return ExitCode::from(1);
        }
    };
    let path = out.map(PathBuf::from).unwrap_or_else(|| dir_path.join("surfaces").join(format!("{}@{}.mkp", name, version)));
    let old = std::fs::read_to_string(&path).ok();
    match (&old, check) {
        (Some(o), _) if *o == text => {
            println!("{}: {}@{}'s surface, up to date", path.display(), name, version);
            return ExitCode::SUCCESS;
        }
        (_, true) => {
            eprintln!("{}: {}@{}'s surface is {}", path.display(), name, version, if old.is_some() { "out of date" } else { "missing" });
            return ExitCode::from(1);
        }
        (Some(_), false) if !force => {
            eprintln!("{}: {}@{}'s surface is already written and differs: a released version's surface doesn't change, so make a new version (pack {}@{}), or pass --force", path.display(), name, version, name, version.parse::<u32>().map(|v| v + 1).unwrap_or(2));
            return ExitCode::from(1);
        }
        _ => {}
    }
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Err(e) = std::fs::write(&path, &text) {
        eprintln!("{}: {}", path.display(), e);
        return ExitCode::from(1);
    }
    println!("{}: wrote {}@{}'s surface", path.display(), name, version);
    ExitCode::SUCCESS
}

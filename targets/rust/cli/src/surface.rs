//! `xtmd surface <pack>`: what a pack's version provides, written as that version's surface
//! (`package kit@1;`, page 6), so later versions are held to it and migrate from it.

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use xtmd_syntax::ast::{self, DeclKind, Item, Node, WidgetMember};
use xtmd_syntax::{parse, Entry};

/// The surface of the pack whose files these are: its name, its version and the file's text.
pub fn surface_of(files: &[xtmd_check::Source]) -> Result<(String, String, String), String> {
    let mut parsed = Vec::new();
    for s in files {
        let p = parse(&s.text, Entry::Xtmd);
        let Some(f) = p.file else { return Err(format!("{}: doesn't read; xtmd check says why", s.path)) };
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
        let file = ast::File { kind: ast::FileKind::Xtmd, front_matter: None, package: None, surface: None, items, dangling: Vec::new(), divider: None, prose: None };
        let printed = xtmd_syntax::printer::print(&s.text, &file);
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
    let text = xtmd_syntax::format(&text, Entry::Xtmd).map_err(|d| format!("the surface doesn't read back: {}", d.first().map(|d| d.message.clone()).unwrap_or_default()))?;
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


pub fn surface_cmd(args: &[String]) -> ExitCode {
    let check = args.iter().any(|a| a == "--check");
    let force = args.iter().any(|a| a == "--force");
    let diff = args.iter().any(|a| a == "--diff");
    let stdout = args.iter().any(|a| a == "--stdout");
    let json = match crate::out::wants_json(args) {
        Ok(j) => j,
        Err(e) => {
            eprintln!("{}", e);
            return ExitCode::from(2);
        }
    };
    let rest: Vec<String> = args.iter().filter(|a| !matches!(a.as_str(), "--check" | "--force" | "--diff" | "--stdout")).cloned().collect();
    let (dirs, deps, out) = match crate::options(&rest) {
        Ok(x) => x,
        Err(e) => {
            eprintln!("{}", e);
            return ExitCode::from(2);
        }
    };
    let Some(dir) = dirs.first() else {
        eprintln!("{}", crate::help::of("surface").unwrap());
        return ExitCode::from(2);
    };
    if dirs.len() > 1 {
        eprintln!("xtmd surface takes one pack, and was given {}: {}", dirs.len(), dirs.join(", "));
        return ExitCode::from(2);
    }
    // the pack named is the one xtmd surface reads, not one of --pack's
    let p = Path::new(dir);
    if !p.is_dir() && !dir.ends_with(".xtpack") {
        eprintln!("{}: not a pack's folder or a .xtpack file{}", dir, if p.exists() { "" } else { ", and there is nothing by that name" });
        return ExitCode::from(2);
    }
    let files = match crate::pack_sources(dir) {
        Ok(f) => f,
        Err(e) => {
            eprintln!("{}", e.strip_prefix("--pack ").unwrap_or(&e));
            return ExitCode::from(2);
        }
    };
    if files.is_empty() {
        eprintln!("{}: no .xtpack files in it, so no pack", dir);
        return ExitCode::from(2);
    }
    let dir_path = Path::new(dir);
    // the pack's own files aren't its dependencies, however an xtmd.toml names them
    let mine = std::fs::canonicalize(dir_path).ok();
    let deps: Vec<xtmd_check::Source> = deps.into_iter().filter(|s| !Path::new(&s.path).starts_with(dir_path) && mine.as_ref().map_or(true, |m| !std::fs::canonicalize(&s.path).map_or(false, |p| p.starts_with(m)))).collect();
    // the pack has to compile: a surface of a broken pack would promise what nothing provides
    let own: Vec<xtmd_check::Source> = files.iter().filter(|s| parse(&s.text, Entry::Xtmd).file.map_or(true, |f| f.surface.is_none())).cloned().collect();
    let c = xtmd_check::compile(&crate::core_sources(), &[deps, files.iter().filter(|s| !own.iter().any(|o| o.path == s.path)).cloned().collect()], &own, "main");
    let errors: Vec<_> = c.errors().collect();
    if !errors.is_empty() {
        for d in errors {
            let text = c.texts.get(&d.file).map(String::as_str).unwrap_or("");
            if json {
                crate::out::line(crate::out::diagnostic(&d.file, text, &d.diagnostic));
            } else {
                eprintln!("{}", d.diagnostic.render(&d.file, text));
            }
        }
        return say(json, None, "doesn't compile", "the pack doesn't compile, so it has no surface yet", 1, serde_json::json!({}));
    }
    let (name, version, text) = match surface_of(&files) {
        Ok(x) => x,
        Err(e) => return say(json, None, "has no surface", &e, 1, serde_json::json!({})),
    };
    let path = out.map(PathBuf::from).unwrap_or_else(|| dir_path.join("surfaces").join(format!("{}@{}.xtpack", name, version)));
    let old = std::fs::read_to_string(&path).ok();
    let this = Some((name.as_str(), version.as_str(), path.as_path()));
    // --stdout: the surface, written nowhere; --diff: how it differs from the one written
    if stdout {
        if !json {
            crate::out::print(&text);
        }
        return say(json, this, "printed", "", 0, serde_json::json!({ "text": text }));
    }
    if diff {
        let d = if old.as_deref() != Some(text.as_str()) { crate::migrate::unified(&path.display().to_string(), old.as_deref().unwrap_or(""), &text) } else { String::new() };
        if !json {
            crate::out::print(&d);
        }
        return say(json, this, if d.is_empty() { "up to date" } else { "would change" }, "", 0, serde_json::json!({ "diff": d }));
    }
    match (&old, check) {
        (Some(o), _) if *o == text => return say(json, this, "up to date", &format!("{}: {}@{}'s surface, up to date", path.display(), name, version), 0, serde_json::json!({})),
        (_, true) => {
            let what = if old.is_some() { "out of date" } else { "missing" };
            return say(json, this, what, &format!("{}: {}@{}'s surface is {}", path.display(), name, version, what), 1, serde_json::json!({}));
        }
        (Some(_), false) if !force => {
            let why = format!("{}: {}@{}'s surface is already written and differs: a released version's surface doesn't change, so make a new version (pack {}@{}), or pass --force", path.display(), name, version, name, version.parse::<u32>().map(|v| v + 1).unwrap_or(2));
            return say(json, this, "differs", &why, 1, serde_json::json!({}));
        }
        _ => {}
    }
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Err(e) = std::fs::write(&path, &text) {
        return say(json, this, "not written", &format!("{}: {}", path.display(), e), 1, serde_json::json!({}));
    }
    say(json, this, "written", &format!("{}: wrote {}@{}'s surface", path.display(), name, version), 0, serde_json::json!({}))
}

/// What became of the surface: a line of text (on stderr when it failed), or with `--format json`
/// an object for the surface and the summary.
fn say(json: bool, surface: Option<(&str, &str, &Path)>, result: &str, text: &str, code: u8, more: serde_json::Value) -> ExitCode {
    if json {
        let mut v = serde_json::json!({ "type": "surface", "result": result });
        if let Some((name, version, path)) = surface {
            v["pack"] = serde_json::json!(name);
            v["version"] = serde_json::json!(version.parse::<u32>().ok());
            v["file"] = serde_json::json!(path.display().to_string());
        }
        if !text.is_empty() && code != 0 {
            v["why"] = serde_json::json!(text);
        }
        if let serde_json::Value::Object(m) = more {
            v.as_object_mut().unwrap().extend(m);
        }
        crate::out::line(v);
        crate::out::line(serde_json::json!({ "type": "summary", "exit": code }));
    } else if code != 0 {
        eprintln!("{}", text);
    } else if !text.is_empty() {
        crate::out::text(text);
    }
    ExitCode::from(code)
}

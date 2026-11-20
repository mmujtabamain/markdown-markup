//! The packs a file on disk is built with, as `xtmd check` finds them: the `xtmd.toml` in its folder
//! or a folder above, and its `packs = [...]`, each a folder of `.xtmdpack` files or one file,
//! relative to it. Only `xtmd lsp` reads the disk; in a browser the client gives the packs.

use std::path::{Path, PathBuf};

use xtmd_live::Source;

#[derive(serde::Deserialize, Default)]
struct Config {
    #[serde(default)]
    packs: Vec<String>,
}

/// The `xtmd.toml` for a file: in its folder, or a folder above.
pub fn find(file: &Path) -> Option<PathBuf> {
    let start = std::fs::canonicalize(file.parent()?).ok()?;
    start.ancestors().map(|d| d.join("xtmd.toml")).find(|p| p.is_file())
}

/// The files of the packs `file`'s `xtmd.toml` names, and what went wrong reading them.
pub fn packs_for(file: &Path) -> (Vec<Source>, Vec<String>) {
    let Some(config) = find(file) else { return (Vec::new(), Vec::new()) };
    let (mut out, mut wrong) = (Vec::new(), Vec::new());
    let c: Config = match std::fs::read_to_string(&config).map_err(|e| e.to_string()).and_then(|t| toml::from_str(&t).map_err(|e| e.message().to_string())) {
        Ok(c) => c,
        Err(e) => return (out, vec![format!("{}: {}", config.display(), e)]),
    };
    let dir = config.parent().map(Path::to_path_buf).unwrap_or_default();
    for p in &c.packs {
        let at = dir.join(p);
        let mut files = Vec::new();
        if at.is_dir() {
            walk(&at, &mut files);
        } else if at.extension().is_some_and(|x| x == "xtmdpack") && at.is_file() {
            files.push(at.clone());
        } else {
            wrong.push(format!("{}: packs = [\"{}\"]: not a folder or a .xtmdpack file", config.display(), p));
        }
        for f in files {
            match std::fs::read_to_string(&f) {
                Ok(text) => out.push(Source { path: f.to_string_lossy().into_owned(), text }),
                Err(e) => wrong.push(format!("{}: {}", f.display(), e)),
            }
        }
    }
    (out, wrong)
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let mut entries: Vec<PathBuf> = rd.filter_map(|e| e.ok().map(|e| e.path())).collect();
    entries.sort();
    for p in entries {
        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if p.is_dir() {
            if !name.starts_with('.') && !matches!(name, "node_modules" | "target" | "dist") {
                walk(&p, out);
            }
        } else if p.extension().is_some_and(|x| x == "xtmdpack") {
            out.push(p);
        }
    }
}

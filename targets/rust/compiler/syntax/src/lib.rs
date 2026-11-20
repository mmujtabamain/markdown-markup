//! Extended Mark's reader: the lexer, the lossless syntax tree, the parser for code and prose, and the
//! printer behind `xtmd fmt`.
//!
//! ```
//! use xtmd_syntax::{format, Entry};
//! let src = "package kit;\n\nlet limit: number = 10;\n";
//! assert_eq!(format(src, Entry::Xtmd).unwrap(), src);
//! ```

pub mod ast;
pub mod diag;
pub mod lexer;
pub mod markdown;
pub mod parser;
pub mod printer;
mod prose;
pub mod span;

pub use diag::{Diagnostic, Edit, Severity};
pub use parser::Entry;
pub use span::{Lines, Place, Span};

use ast::{File, FileKind};
use lexer::Comment;

/// What reading a source gave: its tree when it could be read, and what was found wrong.
pub struct Parsed {
    pub file: Option<File>,
    pub diagnostics: Vec<Diagnostic>,
    /// Comments the tree has no place for.
    pub orphans: Vec<Comment>,
}

impl Parsed {
    pub fn has_errors(&self) -> bool {
        self.diagnostics.iter().any(|d| d.is_error())
    }
}

/// The entry a file's name calls for: `.xtmd` is a document, `.xtmdpack` a pack's file.
pub fn entry_for(path: &str) -> Option<Entry> {
    if path.ends_with(".xtmd") {
        Some(Entry::Document)
    } else if path.ends_with(".xtmdpack") {
        Some(Entry::Xtmd)
    } else {
        None
    }
}

/// Reads a source. A syntax error stops the reading and is the last diagnostic.
pub fn parse(src: &str, entry: Entry) -> Parsed {
    let mut p = parser::Parser::new(src, entry);
    let result = (|| -> parser::R<File> {
        match entry {
            Entry::Document => p.document(),
            Entry::Xtmd => {
                let (package, surface) = p.parse_package()?;
                let (items, dangling) = p.parse_items(src.len())?;
                Ok(File { kind: FileKind::Xtmd, front_matter: None, package, surface, items, dangling, divider: None, prose: None })
            }
            _ => {
                let (items, dangling) = p.parse_items(src.len())?;
                let kind = if entry == Entry::Decls { FileKind::Document } else { FileKind::Xtmd };
                Ok(File { kind, front_matter: None, package: None, surface: None, items, dangling, divider: None, prose: None })
            }
        }
    })();
    let mut diagnostics = std::mem::take(&mut p.diags);
    let file = match result {
        Ok(f) => Some(f),
        Err(d) => {
            diagnostics.push(d);
            None
        }
    };
    diagnostics.sort_by_key(|d| (d.span.start, d.span.end));
    Parsed { file, diagnostics, orphans: std::mem::take(&mut p.orphans) }
}

/// `xtmd fmt`: the source printed back in the canonical layout. It refuses a source it can't read,
/// and one with a comment it would have to drop.
pub fn format(src: &str, entry: Entry) -> Result<String, Vec<Diagnostic>> {
    let parsed = parse(src, entry);
    let Some(file) = parsed.file else {
        return Err(parsed.diagnostics);
    };
    if !parsed.orphans.is_empty() {
        return Err(parsed
            .orphans
            .iter()
            .map(|c| {
                Diagnostic::error(
                    diag::codes::FMT_COMMENT,
                    c.span,
                    "xtmd fmt has no place to keep this comment: put it on a line of its own, or at the end of a line",
                )
            })
            .collect());
    }
    Ok(printer::print(src, &file))
}

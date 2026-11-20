//! Prose: a document below its `@@@` line, and a widget's `markdown` block.
//!
//! Prose is read a line at a time. Extended Mark's own lines come first: calls, control lines, `@slot`
//! lines and the `}` lines that end their blocks. Every other line is Markdown, whose holes are
//! found and read as expressions. Fenced code is skipped whole, and a `$$` line opens a maths
//! block that the next one closes. The Markdown blocks themselves are left as lines here.

use crate::ast::*;
use crate::diag::{codes, Diagnostic};
use crate::lexer::{hole_end, Kw, Tok, P};
use crate::parser::{Entry, Parser, R};
use crate::span::Span;

/// Where prose may run, and how much indent its lines share.
#[derive(Clone, Copy)]
pub(crate) struct Region {
    /// Spaces taken off the front of every line: the common indent of a `markdown` block, or of a
    /// block in prose.
    pub base: usize,
    pub end: usize,
}

enum Stop {
    End,
    /// A line that holds only `}`: its indent, and where the next line starts.
    Close { indent: String, next: usize },
    /// A `} else …` line: where its `}` is, and its indent.
    Else { at: usize, indent: String },
    /// A `case … {` line inside `@match`: where `case` is, and its indent.
    Case { at: usize, indent: String },
}

#[derive(Clone, Copy)]
struct Mode {
    nested: bool,
    /// Directly inside a call's block, where `@slot` lines go.
    slots: bool,
    in_match: bool,
}

struct Line<'s> {
    /// Where the line's text starts once the common indent is taken off.
    content: usize,
    end: usize,
    /// The line's text, without the common indent.
    text: &'s str,
    /// Spaces in front of the text, after the common indent.
    lead: usize,
}

impl<'s> Line<'s> {
    fn trimmed(&self) -> &'s str {
        self.text.trim()
    }
}

fn spaces(s: &str) -> usize {
    s.bytes().take_while(|c| *c == b' ').count()
}

/// What follows the quote and list-item markers that start a line, or `None` when it has none.
fn inside_quote_or_item(s: &str) -> Option<&str> {
    let mut inner = s;
    let mut found = false;
    loop {
        let b = inner.as_bytes();
        let mut k = 0;
        if b.first() == Some(&b'>') {
            k = 1;
            if matches!(b.get(1), Some(b' ') | Some(b'\t')) {
                k = 2;
            }
        } else {
            let mut m = 0;
            if matches!(b.first(), Some(b'-') | Some(b'*') | Some(b'+')) {
                m = 1;
            } else {
                let d = b.iter().take_while(|c| c.is_ascii_digit()).count();
                if (1..=9).contains(&d) && matches!(b.get(d), Some(b'.') | Some(b')')) {
                    m = d + 1;
                }
            }
            if m > 0 && matches!(b.get(m), Some(b' ') | Some(b'\t')) {
                k = m;
                while matches!(b.get(k), Some(b' ') | Some(b'\t')) {
                    k += 1;
                }
                let rest = &inner[k..];
                if rest.len() >= 3 && rest.as_bytes()[0] == b'[' && matches!(rest.as_bytes()[1], b' ' | b'x' | b'X') && rest.as_bytes()[2] == b']' {
                    let mut j = k + 3;
                    if matches!(b.get(j), Some(b' ') | Some(b'\t')) {
                        while matches!(b.get(j), Some(b' ') | Some(b'\t')) {
                            j += 1;
                        }
                        k = j;
                    }
                }
            }
        }
        if k == 0 {
            return if found { Some(inner) } else { None };
        }
        inner = &inner[k..];
        found = true;
    }
}

fn starts_xtmd_line(s: &str) -> bool {
    let b = s.as_bytes();
    b.first() == Some(&b'@') && b.get(1).map_or(false, |c| c.is_ascii_lowercase())
}

fn fence_open(s: &str) -> Option<(u8, usize)> {
    let b = s.as_bytes();
    let c = *b.first()?;
    if c != b'`' && c != b'~' {
        return None;
    }
    let n = b.iter().take_while(|x| **x == c).count();
    if n < 3 {
        return None;
    }
    if c == b'`' && s[n..].contains('`') {
        return None;
    }
    Some((c, n))
}

impl<'a> Parser<'a> {
    fn line(&self, pos: usize, region: Region) -> Line<'a> {
        let src = self.src;
        let end = src[pos..region.end].find('\n').map(|k| pos + k).unwrap_or(region.end);
        let raw = &src[pos..end];
        let strip = spaces(raw).min(region.base);
        let content = pos + strip;
        let text = &src[content..end];
        Line { content, end, text, lead: spaces(text) }
    }

    fn next_line(&self, line: &Line, region: Region) -> usize {
        (line.end + 1).min(region.end.max(line.end))
    }

    /// The rest of the line from `from` is empty; returns where the next line starts.
    fn rest_empty(&self, from: usize, code: &'static str, what: &str) -> R<usize> {
        let src = self.src;
        let end = src[from..].find('\n').map(|k| from + k).unwrap_or(src.len());
        let rest = &src[from..end];
        if !rest.trim().is_empty() {
            let skip = rest.len() - rest.trim_start().len();
            return Err(Diagnostic::error(code, Span::new(from + skip, end), what.to_string()));
        }
        Ok((end + 1).min(src.len()))
    }

    fn brace_line(&self, from: usize) -> R<usize> {
        self.rest_empty(from, codes::BRACE_LINE, "an opening brace ends its line: the block's prose starts on the next line")
    }

    /// A whole document: front matter, definitions up to the first `@@@` line, then prose.
    pub fn document(&mut self) -> R<File> {
        let src = self.src;
        let mut pos = 0;
        let mut front_matter = None;
        if src.lines().next().map(|l| l.trim_end()) == Some("---") {
            let mut off = src.find('\n').map(|k| k + 1).unwrap_or(src.len());
            let mut closed = None;
            while off < src.len() {
                let end = src[off..].find('\n').map(|k| off + k).unwrap_or(src.len());
                if src[off..end].trim_end() == "---" {
                    closed = Some((end + 1).min(src.len()));
                    break;
                }
                off = end + 1;
            }
            match closed {
                Some(end) => {
                    front_matter = Some(Span::new(0, end));
                    pos = end;
                }
                None => {
                    return Err(Diagnostic::error(
                        codes::FRONT_MATTER,
                        Span::new(0, 3),
                        "front matter is closed by a line that holds only `---`",
                    ))
                }
            }
        }
        let mut divider = None;
        let mut off = pos;
        while off < src.len() {
            let end = src[off..].find('\n').map(|k| off + k).unwrap_or(src.len());
            let line = &src[off..end];
            if spaces(line) <= 3 && line.trim() == "@@@" {
                divider = Some(Span::new(off + spaces(line), off + spaces(line) + 3));
                break;
            }
            off = end + 1;
        }
        let mut file = File {
            kind: FileKind::Document,
            front_matter,
            package: None,
            surface: None,
            items: Vec::new(),
            dangling: Vec::new(),
            divider,
            prose: None,
        };
        let prose_start = match divider {
            Some(d) => {
                self.seek(pos, d.start as usize);
                let (items, dangling) = self.parse_items(d.start as usize)?;
                file.items = items;
                file.dangling = dangling;
                let end = src[d.end as usize..].find('\n').map(|k| d.end as usize + k + 1).unwrap_or(src.len());
                end
            }
            None => pos,
        };
        let region = Region { base: 0, end: src.len() };
        let (prose, _) = self.prose(prose_start, region, Mode { nested: false, slots: false, in_match: false })?;
        file.prose = Some(prose);
        Ok(file)
    }

    /// `markdown { … }` in a widget, read as prose with its common indent taken off.
    pub(crate) fn markdown_block(&mut self) -> R<MarkdownBlock> {
        let start = self.expect_kw(Kw::Markdown)?;
        let open = self.expect(P::LBrace)?;
        let limit = self.lexer_limit();
        let src = self.src;
        let after = open.end as usize;
        let line_end = src[after..limit].find('\n').map(|k| after + k).unwrap_or(limit);
        if src[after..line_end].trim() == "}" {
            let close = after + src[after..line_end].find('}').unwrap() + 1;
            self.seek(close, limit);
            return Ok(MarkdownBlock { empty: true, prose: Prose { nodes: Vec::new() }, span: start.to(Span::at(close)) });
        }
        let first = self.brace_line(open.end as usize)?;
        let base = self.common_indent(first, limit, start.start as usize);
        let region = Region { base, end: limit };
        let (prose, stop) = self.prose(first, region, Mode { nested: true, slots: false, in_match: false })?;
        match stop {
            Stop::Close { next, .. } => {
                let close_end = self.src[..next].trim_end_matches('\n').len();
                // from the end of the `}` line, so the next token knows it starts a line
                self.seek(close_end.min(limit), limit);
                Ok(MarkdownBlock { empty: false, prose, span: start.to(Span::at(close_end)) })
            }
            _ => Err(Diagnostic::error(codes::BLOCK_UNCLOSED, start, "this markdown block is not closed by a line that holds only `}`")),
        }
    }

    /// The indent a `markdown` block's lines share: the least of its lines, up to the `}` that
    /// sits no deeper than the line the block starts on.
    fn common_indent(&self, first: usize, limit: usize, keyword: usize) -> usize {
        let src = self.src;
        let line_start = src[..keyword].rfind('\n').map(|k| k + 1).unwrap_or(0);
        let outer = spaces(&src[line_start..keyword]);
        let mut base = usize::MAX;
        let mut off = first;
        while off < limit {
            let end = src[off..limit].find('\n').map(|k| off + k).unwrap_or(limit);
            let line = &src[off..end];
            let s = spaces(line);
            if line.trim() == "}" && s <= outer {
                break;
            }
            if !line.trim().is_empty() {
                base = base.min(s);
            }
            off = end + 1;
        }
        if base == usize::MAX {
            outer + 4
        } else {
            base
        }
    }

    /// Spaces in front of the line that `pos` is on.
    fn indent_of(&self, pos: usize) -> usize {
        let start = self.src[..pos].rfind('\n').map(|k| k + 1).unwrap_or(0);
        spaces(&self.src[start..])
    }

    /// The indent of the first line from `pos` that isn't blank.
    fn first_indent(&self, mut pos: usize, end: usize) -> usize {
        let src = self.src;
        while pos < end {
            let e = src[pos..end].find('\n').map(|k| pos + k).unwrap_or(end);
            if !src[pos..e].trim().is_empty() {
                return spaces(&src[pos..e]);
            }
            pos = e + 1;
        }
        0
    }

    /// Where a node's first line starts, or none for a blank line.
    fn node_start(&self, node: &ProseNode) -> Option<usize> {
        let at = match node {
            ProseNode::Text(l) if self.src[l.span.range()].trim().is_empty() => return None,
            ProseNode::Text(l) => l.span.start,
            ProseNode::Fence(lines) | ProseNode::Maths(lines) => lines.first()?.span.start,
            ProseNode::Call(c) => c.span.start,
            ProseNode::Comment { span, .. }
            | ProseNode::If { span, .. }
            | ProseNode::For { span, .. }
            | ProseNode::Match { span, .. }
            | ProseNode::Slot { span, .. } => span.start,
        };
        Some(at as usize)
    }

    /// A block's prose, read with its common indent taken off: the least indent of the block's own
    /// lines, those that aren't blank, counting only the first line of a fence, a maths block and a
    /// block nested in it (whose lines have an indent of their own). The first line's indent is
    /// tried first; when one of the block's own lines sits less deep, the block is read again.
    fn prose_block(&mut self, first: usize, region: Region, mode: Mode) -> R<(Prose, Stop)> {
        let base = self.first_indent(first, region.end);
        let (diags, orphans) = (self.diags.len(), self.orphans.len());
        let read = self.prose(first, Region { base, end: region.end }, mode)?;
        let least = read.0.nodes.iter().filter_map(|n| self.node_start(n)).map(|at| self.indent_of(at)).min();
        match least {
            Some(least) if least < base => {
                self.diags.truncate(diags);
                self.orphans.truncate(orphans);
                self.prose(first, Region { base: least, end: region.end }, mode)
            }
            _ => Ok(read),
        }
    }

    fn prose(&mut self, mut pos: usize, region: Region, mode: Mode) -> R<(Prose, Stop)> {
        let mut nodes = Vec::new();
        let mut para_open = false;
        let mut in_list = false;
        while pos < region.end {
            let line = self.line(pos, region);
            let s = line.trimmed();
            let next = self.next_line(&line, region);

            // fenced code: skipped whole
            if line.lead <= 3 {
                if let Some((c, n)) = fence_open(&line.text[line.lead..]) {
                    let mut lines = vec![TextLine { span: Span::new(line.content, line.end), holes: Vec::new() }];
                    let mut at = next;
                    // a fence that is never closed runs to the end, as in CommonMark; in a
                    // block, that swallows the block's `}`, so the block is the one reported
                    while at < region.end {
                        let l = self.line(at, region);
                        lines.push(TextLine { span: Span::new(l.content, l.end), holes: Vec::new() });
                        at = self.next_line(&l, region);
                        let t = l.text.trim();
                        if l.lead <= 3 && t.len() >= n && t.bytes().all(|x| x == c) {
                            break;
                        }
                    }
                    nodes.push(ProseNode::Fence(lines));
                    pos = at;
                    para_open = false;
                    continue;
                }
            }

            // a maths block, between two lines that hold only $$
            if s == "$$" {
                let mut lines = vec![TextLine { span: Span::new(line.content, line.end), holes: Vec::new() }];
                let mut at = next;
                loop {
                    if at >= region.end {
                        return Err(Diagnostic::error(
                            codes::MATHS_UNCLOSED,
                            Span::new(line.content + line.lead, line.end),
                            "this maths block is not closed by a line that holds only `$$`",
                        ));
                    }
                    let l = self.line(at, region);
                    at = self.next_line(&l, region);
                    if l.trimmed() == "$$" {
                        lines.push(TextLine { span: Span::new(l.content, l.end), holes: Vec::new() });
                        break;
                    }
                    let holes = self.holes(l.content, l.end, true)?;
                    lines.push(TextLine { span: Span::new(l.content, l.end), holes });
                }
                nodes.push(ProseNode::Maths(lines));
                pos = at;
                para_open = false;
                continue;
            }

            if let Some(inner) = inside_quote_or_item(s) {
                if starts_xtmd_line(inner) || inner.starts_with("@//") || inner == "}" || inner.starts_with("} else") {
                    let at = line.content + line.lead;
                    return Err(Diagnostic::error(
                        codes::IN_QUOTE_OR_ITEM,
                        Span::new(at, line.end),
                        "a call, a control line, a comment or a closing `}` can't start inside a Markdown quote or list item: use `@quote`, or `@bullets` and `@item`, and write `\\@` to show an @ there",
                    ));
                }
            }
            if self.entry == Entry::Document && !mode.nested && s == "@@@" && line.lead <= 3 {
                return Err(Diagnostic::error(
                    codes::SECOND_DIVIDER,
                    Span::new(line.content + line.lead, line.end),
                    "only the first `@@@` line is the divider: write `\\@@@` to show one as text",
                ));
            }
            if s == "}" {
                if !mode.nested {
                    return Err(Diagnostic::error(
                        codes::STRAY_BRACE,
                        Span::new(line.content + line.lead, line.end),
                        "a closing brace with no block open: write `\\}` to show one",
                    ));
                }
                return Ok((Prose { nodes }, Stop::Close { indent: " ".repeat(line.lead), next }));
            }
            if s.starts_with("} else") {
                if !mode.nested {
                    return Err(Diagnostic::error(
                        codes::STRAY_ELSE,
                        Span::new(line.content + line.lead, line.end),
                        "`else` with no `@if` open",
                    ));
                }
                return Ok((Prose { nodes }, Stop::Else { at: line.content + line.lead, indent: " ".repeat(line.lead) }));
            }
            if mode.in_match {
                if s.starts_with("case ") || s.starts_with("case\t") {
                    return Ok((Prose { nodes }, Stop::Case { at: line.content + line.lead, indent: " ".repeat(line.lead) }));
                }
                if !s.is_empty() {
                    return Err(Diagnostic::error(
                        codes::MATCH_CASE,
                        Span::new(line.content + line.lead, line.end),
                        "`@match` holds `case … {` lines, each closed by a line that holds only `}`",
                    ));
                }
            }

            // `@//` to the end of the line is a comment (`\@//` shows one as text): it ends no
            // paragraph, as if the line weren't there
            if line.lead <= 3 && line.text[line.lead..].starts_with("@//") {
                let at = line.content + line.lead;
                nodes.push(ProseNode::Comment { indent: " ".repeat(line.lead), span: Span::new(at, line.end) });
                pos = next;
                continue;
            }

            if line.lead <= 3 && starts_xtmd_line(&line.text[line.lead..]) {
                let at = line.content + line.lead;
                let (node, after) = self.xtmd_line(&line, at, region, mode)?;
                nodes.push(node);
                pos = after;
                para_open = false;
                continue;
            }

            // a line of Markdown
            let indented_code = line.lead >= 4 && !para_open && !in_list && !s.is_empty();
            let holes = if indented_code { Vec::new() } else { self.holes(line.content, line.end, false)? };
            if s.is_empty() {
                para_open = false;
            } else if !indented_code {
                if inside_quote_or_item(s).is_some() && !s.starts_with('>') {
                    in_list = true;
                } else if line.lead == 0 {
                    in_list = false;
                }
                para_open = true;
            }
            nodes.push(ProseNode::Text(TextLine { span: Span::new(line.content, line.end), holes }));
            pos = next;
        }
        Ok((Prose { nodes }, Stop::End))
    }

    /// A line that starts with `@` and a small letter: a call, a control line or a slot.
    fn xtmd_line(&mut self, line: &Line, at: usize, region: Region, mode: Mode) -> R<(ProseNode, usize)> {
        let indent = " ".repeat(line.lead);
        let word: String = line.text[line.lead + 1..].bytes().take_while(|c| c.is_ascii_alphanumeric() || *c == b'_').map(|c| c as char).collect();
        let after = &line.text[line.lead + 1 + word.len()..];
        let control = match word.as_str() {
            "if" | "for" | "match" => after.trim_start().starts_with('('),
            "mut" => after.trim_start().starts_with("for"),
            _ => false,
        };
        if control {
            return self.control(&word, at, indent, region);
        }
        if word == "slot" {
            if !mode.slots {
                return Err(Diagnostic::error(
                    codes::SLOT_OUTSIDE,
                    Span::new(at, line.end),
                    "`@slot` is written only directly inside a call's block",
                ));
            }
            self.seek(at + 1, region.end);
            self.expect_kw(Kw::Slot)?;
            let name = self.ident("a slot's name")?;
            let open = self.expect(P::LBrace)?;
            let first = self.brace_line(open.end as usize)?;
            let (body, stop) = self.prose_block(first, region, Mode { nested: true, slots: false, in_match: false })?;
            let Stop::Close { indent: close, next } = stop else {
                return Err(Diagnostic::error(codes::BLOCK_UNCLOSED, Span::new(at, line.end), "this slot is not closed by a line that holds only `}`"));
            };
            return Ok((ProseNode::Slot { indent, name, body, close, span: Span::new(at, next) }, next));
        }

        // a call
        self.seek(at, region.end);
        let call = self.view_call(false)?;
        let not_a_call = |p: &Parser| {
            Diagnostic::error(
                codes::NOT_A_CALL,
                Span::new(at, line.end),
                format!("a line that starts with `@{}` is Extended Mark: end the call with `;` or ` {{`, or write `\\@` to show an @ as text", &p.src[call.name.span.range()]),
            )
        };
        let next_kind = match self.kind() {
            Ok(k) => k,
            Err(_) => return Err(not_a_call(self)),
        };
        if next_kind == Tok::P(P::Semi) {
            let semi = self.bump()?.span;
            let next = self.rest_empty(semi.end as usize, codes::CALL_END, "a call's line ends after its `;`")?;
            let span = Span::new(at, semi.end as usize);
            return Ok((ProseNode::Call(ProseCall { indent, call, block: None, span }), next.min(region.end)));
        }
        if next_kind == Tok::P(P::LBrace) {
            let open = self.bump()?.span;
            let first = self.brace_line(open.end as usize)?;
            let (body, stop) = self.prose_block(first, region, Mode { nested: true, slots: true, in_match: false })?;
            let Stop::Close { indent: close, next } = stop else {
                return Err(Diagnostic::error(codes::BLOCK_UNCLOSED, Span::new(at, line.end), "this block is not closed by a line that holds only `}`"));
            };
            let span = Span::new(at, next);
            return Ok((ProseNode::Call(ProseCall { indent, call, block: Some((body, close)), span }), next));
        }
        if call.args.is_none() {
            return Err(not_a_call(self));
        }
        let found = self.here()?;
        Err(Diagnostic::error(
            codes::CALL_END,
            found,
            "a call in prose ends with `;`, or with ` {` when a block follows",
        ))
    }

    fn control(&mut self, word: &str, at: usize, indent: String, region: Region) -> R<(ProseNode, usize)> {
        let start = Span::at(at);
        self.seek(at + 1, region.end);
        let inner = Mode { nested: true, slots: false, in_match: false };
        match word {
            "if" => {
                self.expect_kw(Kw::If)?;
                let mut branches = Vec::new();
                loop {
                    self.expect(P::LParen)?;
                    let cond = self.cond()?;
                    self.expect(P::RParen)?;
                    let open = self.expect(P::LBrace)?;
                    let first = self.brace_line(open.end as usize)?;
                    let (body, stop) = self.prose_block(first, region, inner)?;
                    match stop {
                        Stop::Close { indent: close, next } => {
                            branches.push((cond, body, close));
                            return Ok((ProseNode::If { indent, branches, otherwise: None, span: start.to(Span::at(next)) }, next));
                        }
                        Stop::Else { at: brace, indent: close } => {
                            branches.push((cond, body, close));
                            self.seek(brace, region.end);
                            self.expect(P::RBrace)?;
                            self.expect_kw(Kw::Else)?;
                            if self.eat_kw(Kw::If)? {
                                continue;
                            }
                            let open = self.expect(P::LBrace)?;
                            let first = self.brace_line(open.end as usize)?;
                            let (body, stop) = self.prose_block(first, region, inner)?;
                            let Stop::Close { indent: close, next } = stop else {
                                return Err(Diagnostic::error(codes::BLOCK_UNCLOSED, start, "`else` is not closed by a line that holds only `}`"));
                            };
                            return Ok((
                                ProseNode::If { indent, branches, otherwise: Some((body, close)), span: start.to(Span::at(next)) },
                                next,
                            ));
                        }
                        _ => return Err(Diagnostic::error(codes::BLOCK_UNCLOSED, start, "`@if` is not closed by a line that holds only `}`")),
                    }
                }
            }
            "for" | "mut" => {
                let loop_start = start;
                let mutable = self.eat_kw(Kw::Mut)?;
                self.expect_kw(Kw::For)?;
                let (key, name, over) = self.loop_head(loop_start)?;
                let open = self.expect(P::LBrace)?;
                let first = self.brace_line(open.end as usize)?;
                let (body, stop) = self.prose_block(first, region, inner)?;
                let Stop::Close { indent: close, next } = stop else {
                    return Err(Diagnostic::error(codes::BLOCK_UNCLOSED, start, "`@for` is not closed by a line that holds only `}`"));
                };
                Ok((ProseNode::For { indent, mutable, key, name, over, body, close, span: start.to(Span::at(next)) }, next))
            }
            _ => {
                self.expect_kw(Kw::Match)?;
                self.expect(P::LParen)?;
                let subject = self.expr()?;
                self.expect(P::RParen)?;
                let open = self.expect(P::LBrace)?;
                let mut pos = self.brace_line(open.end as usize)?;
                // the `case` lines' own indent, taken off each of them
                let inside = Region { base: self.first_indent(pos, region.end), end: region.end };
                let mut cases = Vec::new();
                loop {
                    let (_, stop) = self.prose(pos, inside, Mode { nested: true, slots: false, in_match: true })?;
                    match stop {
                        Stop::Close { indent: close, next } => {
                            return Ok((ProseNode::Match { indent, subject, cases, close, span: start.to(Span::at(next)) }, next));
                        }
                        Stop::Case { at: case_at, indent: case_indent } => {
                            self.seek(case_at, region.end);
                            self.expect_kw(Kw::Case)?;
                            let patterns = self.patterns()?;
                            let open = self.expect(P::LBrace)?;
                            let first = self.brace_line(open.end as usize)?;
                            let (body, stop) = self.prose_block(first, region, inner)?;
                            let Stop::Close { indent: close, next } = stop else {
                                return Err(Diagnostic::error(codes::BLOCK_UNCLOSED, Span::at(case_at), "this case is not closed by a line that holds only `}`"));
                            };
                            cases.push(ProseCase { indent: case_indent, patterns, body, close, span: Span::at(case_at).to(Span::at(next)) });
                            pos = next;
                        }
                        Stop::End => return Err(Diagnostic::error(codes::BLOCK_UNCLOSED, start, "`@match` is not closed by a line that holds only `}`")),
                        Stop::Else { at: e, .. } => return Err(Diagnostic::error(codes::MATCH_CASE, Span::at(e), "`@match` holds `case … {` lines")),
                    }
                }
            }
        }
    }

    /// The holes in one line of prose text, or of a maths block (which has no code spans).
    fn holes(&mut self, start: usize, end: usize, maths: bool) -> R<Vec<ProseHole>> {
        let src = self.src;
        let b = src.as_bytes();
        let mut out = Vec::new();
        let mut i = start;
        while i < end {
            let c = b[i];
            if c == b'`' && !maths {
                let n = b[i..end].iter().take_while(|x| **x == b'`').count();
                if let Some(close) = closing_ticks(&b[i + n..end], n) {
                    i += n + close + n;
                    continue;
                }
                i += n;
                continue;
            }
            if c == b'\\' {
                match b.get(i + 1) {
                    Some(b'\\') => {
                        i += 2;
                        continue;
                    }
                    Some(b'{') if i + 1 < end => {
                        let close = hole_end(src, i + 2, end, true).map_err(|d| {
                            if d.code == codes::HOLE_UNCLOSED {
                                Diagnostic::error(codes::HOLE_LINE, Span::new(i, i + 2), "a hole in prose ends on its line: `\\{` and an expression, then `}`")
                            } else {
                                d
                            }
                        })?;
                        let expr = self.hole(Span::new(i + 2, close))?;
                        out.push(ProseHole { span: Span::new(i, close + 1), expr });
                        i = close + 1;
                        continue;
                    }
                    _ => {}
                }
            }
            i += 1;
        }
        Ok(out)
    }
}

/// Where a run of exactly `n` backticks starts in `rest`, closing a code span.
fn closing_ticks(rest: &[u8], n: usize) -> Option<usize> {
    let mut j = 0;
    while j < rest.len() {
        if rest[j] == b'`' {
            let m = rest[j..].iter().take_while(|x| **x == b'`').count();
            if m == n {
                return Some(j);
            }
            j += m;
        } else {
            j += 1;
        }
    }
    None
}

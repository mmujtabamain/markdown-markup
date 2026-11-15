//! A recursive-descent parser for page 9's grammar: files, declarations, types, statements,
//! views and expressions. Prose lives in [`crate::prose`]; both share this parser's state.
//!
//! The parser stops at the first syntax error, which it returns as a diagnostic. Rules of a
//! file's structure that leave the tree readable (a widget body out of order, a `mut` at the
//! top of a file) are collected in `diags` and parsing goes on.

use std::collections::VecDeque;

use crate::ast::*;
use crate::diag::{codes, Diagnostic};
use crate::lexer::{text_parts, Comment, Kw, Lexer, Tok, Token, Trivia, P};
use crate::span::Span;

pub type R<T> = Result<T, Diagnostic>;

/// What a parse starts from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Entry {
    /// A .mkp file.
    Mkp,
    /// A .mkp.md document.
    Document,
    /// A document's definitions on their own, with no `@@@` line and no prose.
    Decls,
    /// Definitions and view statements mixed, as the spec's shorter examples are written.
    Body,
    /// Fields, each ending in `;`.
    Fields,
    /// Fn signatures, each ending in `;`.
    Sigs,
}

pub struct Parser<'a> {
    pub src: &'a str,
    lx: Lexer<'a>,
    buf: VecDeque<Token>,
    pub(crate) prev_end: usize,
    pub diags: Vec<Diagnostic>,
    /// Comments the tree has no place for. `mkp fmt` refuses to drop them.
    pub orphans: Vec<Comment>,
    pub entry: Entry,
    has_state: bool,
}

#[derive(Clone)]
pub(crate) struct Saved {
    pos: usize,
    limit: usize,
    buf: VecDeque<Token>,
    prev_end: usize,
}

fn describe(src: &str, t: &Token) -> String {
    match t.kind {
        Tok::Eof => "the end".to_string(),
        Tok::Text => "a text".to_string(),
        _ => format!("`{}`", &src[t.span.range()]),
    }
}

impl<'a> Parser<'a> {
    pub fn new(src: &'a str, entry: Entry) -> Parser<'a> {
        Parser {
            src,
            lx: Lexer::new(src, 0, src.len()),
            buf: VecDeque::new(),
            prev_end: 0,
            diags: Vec::new(),
            orphans: Vec::new(),
            entry,
            has_state: false,
        }
    }

    pub(crate) fn in_pack(&self) -> bool {
        self.entry == Entry::Mkp
    }

    // ---- tokens

    pub(crate) fn seek(&mut self, pos: usize, limit: usize) {
        self.lx = Lexer::new(self.src, pos, limit);
        self.buf.clear();
        self.prev_end = pos;
    }

    pub(crate) fn lexer_limit(&self) -> usize {
        self.lx.limit
    }

    pub(crate) fn save(&self) -> Saved {
        Saved { pos: self.lx.pos, limit: self.lx.limit, buf: self.buf.clone(), prev_end: self.prev_end }
    }

    pub(crate) fn restore(&mut self, s: Saved) {
        self.lx = Lexer::new(self.src, s.pos, s.limit);
        self.buf = s.buf;
        self.prev_end = s.prev_end;
    }

    fn fill(&mut self, n: usize) -> R<()> {
        while self.buf.len() <= n {
            let t = self.lx.next()?;
            self.buf.push_back(t);
        }
        Ok(())
    }

    pub(crate) fn peek(&mut self) -> R<&Token> {
        self.fill(0)?;
        Ok(&self.buf[0])
    }

    pub(crate) fn kind(&mut self) -> R<Tok> {
        Ok(self.peek()?.kind)
    }

    pub(crate) fn kind_at(&mut self, n: usize) -> R<Tok> {
        self.fill(n)?;
        Ok(self.buf[n].kind)
    }

    pub(crate) fn span_at(&mut self, n: usize) -> R<Span> {
        self.fill(n)?;
        Ok(self.buf[n].span)
    }

    pub(crate) fn here(&mut self) -> R<Span> {
        Ok(self.peek()?.span)
    }

    pub(crate) fn text_of(&self, span: Span) -> &'a str {
        &self.src[span.range()]
    }

    pub(crate) fn bump(&mut self) -> R<Token> {
        self.fill(0)?;
        let t = self.buf.pop_front().unwrap();
        for piece in &t.trivia {
            if let Trivia::Comment(c) = piece {
                self.orphans.push(c.clone());
            }
        }
        if t.kind != Tok::Eof {
            self.prev_end = t.span.end as usize;
        }
        Ok(t)
    }

    pub(crate) fn at(&mut self, p: P) -> R<bool> {
        Ok(self.kind()? == Tok::P(p))
    }

    pub(crate) fn at_kw(&mut self, k: Kw) -> R<bool> {
        Ok(self.kind()? == Tok::Kw(k))
    }

    pub(crate) fn eat(&mut self, p: P) -> R<bool> {
        if self.at(p)? {
            self.bump()?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    pub(crate) fn eat_kw(&mut self, k: Kw) -> R<bool> {
        if self.at_kw(k)? {
            self.bump()?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    pub(crate) fn unexpected(&mut self, what: &str) -> Diagnostic {
        match self.peek() {
            Ok(t) => {
                let t = t.clone();
                Diagnostic::error(codes::EXPECTED, t.span, format!("expected {}, found {}", what, describe(self.src, &t)))
            }
            Err(d) => d,
        }
    }

    pub(crate) fn expect(&mut self, p: P) -> R<Span> {
        if self.at(p)? {
            return Ok(self.bump()?.span);
        }
        if p == P::Semi {
            return Err(self.missing_semi());
        }
        Err(self.unexpected(&format!("`{}`", p.text())))
    }

    pub(crate) fn expect_kw(&mut self, k: Kw) -> R<Span> {
        if self.at_kw(k)? {
            return Ok(self.bump()?.span);
        }
        Err(self.unexpected(&format!("`{}`", k.word())))
    }

    fn missing_semi(&mut self) -> Diagnostic {
        let src = self.src;
        let found = match self.peek() {
            Ok(t) => describe(src, t),
            Err(d) => return d,
        };
        Diagnostic::error(
            codes::MISSING_SEMICOLON,
            Span::at(self.prev_end),
            format!("every statement ends with `;`: expected `;` here, found {}", found),
        )
    }

    pub(crate) fn semi(&mut self) -> R<()> {
        if self.eat(P::Semi)? {
            Ok(())
        } else {
            Err(self.missing_semi())
        }
    }

    /// A small name. A keyword in its place is an error that says so.
    pub(crate) fn ident(&mut self, what: &str) -> R<Ident> {
        let t = self.peek()?.clone();
        match t.kind {
            Tok::Name => {
                self.bump()?;
                self.hyphen_check(&t)?;
                Ok(Ident { name: self.text_of(t.span).to_string(), span: t.span })
            }
            Tok::Kw(k) => Err(Diagnostic::error(
                codes::KEYWORD_AS_NAME,
                t.span,
                format!("`{}` is a keyword, so it can't be {}, after a dot included", k.word(), what),
            )),
            _ => Err(self.unexpected(what)),
        }
    }

    /// A name written with a hyphen, `text-size`, is always a mistake for `text_size`.
    fn hyphen_check(&mut self, name: &Token) -> R<()> {
        if self.at(P::Minus).unwrap_or(false) {
            let minus = self.span_at(0)?;
            if minus.start == name.span.end && self.kind_at(1)? == Tok::Name && self.span_at(1)?.start == minus.end {
                let next = self.span_at(1)?;
                let joined = format!("{}_{}", self.text_of(name.span), self.text_of(next));
                return Err(Diagnostic::error(
                    codes::HYPHEN_NAME,
                    name.span.to(next),
                    format!("a name has `_` between its words, and `-` is always minus: write `{}`", joined),
                )
                .with_fix(joined));
            }
        }
        Ok(())
    }

    pub(crate) fn caps(&mut self, what: &str) -> R<Ident> {
        let t = self.peek()?.clone();
        if t.kind == Tok::Caps {
            self.bump()?;
            return Ok(Ident { name: self.text_of(t.span).to_string(), span: t.span });
        }
        Err(self.unexpected(what))
    }

    fn token_ident(&mut self) -> R<Ident> {
        let t = self.bump()?;
        Ok(Ident { name: self.text_of(t.span).to_string(), span: t.span })
    }

    // ---- comments

    /// The comments on the line that just ended, and any lined up under them.
    pub(crate) fn take_trailing(&mut self) -> R<Vec<Comment>> {
        self.fill(0)?;
        let src = self.src;
        let t = &mut self.buf[0];
        let mut out = Vec::new();
        if let Some(Trivia::Comment(_)) = t.trivia.first() {
            if let Trivia::Comment(c) = t.trivia.remove(0) {
                out.push(c);
            }
            let col = column0(src, out[0].span.start as usize);
            let mut i = 0;
            while i + 1 < t.trivia.len() {
                match (&t.trivia[i], &t.trivia[i + 1]) {
                    (Trivia::Newlines(1), Trivia::Comment(c)) if column0(src, c.span.start as usize) == col => {
                        if let Trivia::Comment(c) = t.trivia.remove(i + 1) {
                            out.push(c);
                        }
                        i += 1;
                    }
                    _ => break,
                }
            }
        }
        Ok(out)
    }

    /// The comments and blank lines in front of the next token.
    pub(crate) fn take_leading(&mut self) -> R<Vec<Leading>> {
        self.fill(0)?;
        let t = &mut self.buf[0];
        let mut out = Vec::new();
        for piece in &t.trivia {
            match piece {
                Trivia::Newlines(n) if *n >= 2 => out.push(Leading::Blank),
                Trivia::Newlines(_) => {}
                Trivia::Comment(c) => out.push(Leading::Comment(c.clone())),
            }
        }
        t.trivia.retain(|p| matches!(p, Trivia::Newlines(_)));
        Ok(out)
    }

    fn on_new_line(&mut self) -> R<bool> {
        Ok(self.peek()?.on_new_line())
    }

    /// A comma-separated list whose opening bracket was just read, up to its closing one.
    pub(crate) fn group<T>(&mut self, open: Span, close: P, mut item: impl FnMut(&mut Self) -> R<T>) -> R<Group<T>> {
        let opened = self.take_trailing()?;
        let multiline = !opened.is_empty() || self.on_new_line()?;
        let mut items = Vec::new();
        let dangling;
        loop {
            if self.at(close)? {
                dangling = self.take_leading()?;
                break;
            }
            let leading = self.take_leading()?;
            let newline = self.on_new_line()?;
            let value = item(self)?;
            let comma = self.eat(P::Comma)?;
            let trailing = self.take_trailing()?;
            items.push(Node { leading, item: value, trailing, newline });
            if !comma {
                dangling = self.take_leading()?;
                break;
            }
        }
        let end = self.expect(close)?;
        Ok(Group { items, multiline, open: opened, dangling, span: open.to(end) })
    }

    /// The members of a declaration, after its `{`, up to and including its `}`.
    pub(crate) fn body<T>(&mut self, open: Span, mut member: impl FnMut(&mut Self) -> R<T>) -> R<Body<T>> {
        let opened = self.take_trailing()?;
        let one_line = opened.is_empty() && !self.on_new_line()?;
        let mut items = Vec::new();
        loop {
            if self.at(P::RBrace)? {
                let dangling = self.take_leading()?;
                if !items.is_empty() {
                    if one_line {
                        self.layout_warning(open, "an opening brace ends its line: put each member on a line of its own");
                    } else if !self.on_new_line()? {
                        let at = self.here()?;
                        self.layout_warning(at, "a closing brace starts its own line");
                    }
                }
                let end = self.bump()?.span;
                return Ok(Body { items, open: opened, dangling, span: open.to(end) });
            }
            if self.kind()? == Tok::Eof {
                return Err(Diagnostic::error(codes::EXPECTED, open, "this `{` is never closed: expected `}`"));
            }
            let leading = self.take_leading()?;
            let newline = self.on_new_line()?;
            let value = member(self)?;
            let trailing = self.take_trailing()?;
            items.push(Node { leading, item: value, trailing, newline });
        }
    }

    /// Page 1's brace rule, in code: another layout is a warning and is read the same.
    fn layout_warning(&mut self, at: Span, message: &str) {
        self.diags.push(Diagnostic::warning(codes::LAYOUT, at, message.to_string()).with_fix("mkp fmt"));
    }

    // ---- files

    pub fn parse_items(&mut self, until: usize) -> R<(Vec<Node<Item>>, Vec<Leading>)> {
        self.seek(self.prev_end, until);
        let mut items = Vec::new();
        loop {
            if self.kind()? == Tok::Eof {
                let dangling = self.take_leading()?;
                return Ok((items, dangling));
            }
            let leading = self.take_leading()?;
            let newline = self.on_new_line()?;
            let item = self.item()?;
            let trailing = self.take_trailing()?;
            let node = Node { leading, item, trailing, newline };
            self.check_docs(&node);
            items.push(node);
        }
    }

    pub fn parse_package(&mut self) -> R<Option<Node<Ident>>> {
        if !self.at_kw(Kw::Package)? {
            let at = self.here()?;
            return Err(Diagnostic::error(
                codes::PACKAGE_LINE,
                at,
                "a .mkp file starts with its package line: `package name;`",
            ));
        }
        let leading = self.take_leading()?;
        self.bump()?;
        let name = self.ident("a package name")?;
        self.semi()?;
        let trailing = self.take_trailing()?;
        Ok(Some(Node { leading, item: name, trailing, newline: true }))
    }

    fn item(&mut self) -> R<Item> {
        match self.entry {
            Entry::Fields => {
                let f = self.field(false)?;
                self.semi()?;
                return Ok(Item::Field(f));
            }
            Entry::Sigs => {
                let sig = self.fn_sig(true)?;
                self.semi()?;
                return Ok(Item::Sig(sig));
            }
            _ => {}
        }
        let t = self.peek()?.clone();
        match t.kind {
            Tok::Kw(Kw::Import) => Ok(Item::Import(self.import()?)),
            Tok::Kw(Kw::Package) => Err(Diagnostic::error(
                codes::PACKAGE_LINE,
                t.span,
                if self.in_pack() {
                    "a file has one package line, at its top"
                } else {
                    "a document has no package line: it is a page, not a pack"
                },
            )),
            Tok::Kw(Kw::State) if self.kind_at(1)? == Tok::P(P::LBrace) => {
                let s = self.state_block()?;
                Ok(Item::State(s))
            }
            Tok::Kw(Kw::Expose) => {
                if self.in_pack() {
                    return Err(Diagnostic::error(
                        codes::EXPOSE_IN_PACK,
                        t.span,
                        "expose is written only at the top of a document, where it answers the extern channel of its name; a pack has no expose",
                    ));
                }
                Ok(Item::Expose(self.expose()?))
            }
            Tok::Kw(Kw::Mut) if self.kind_at(1)? != Tok::Kw(Kw::For) => {
                let msg = if self.in_pack() {
                    "a pack keeps no state, so a file has no `mut` at its top: a widget shares a value through a `mut` input, and the document keeps it in `$state`"
                } else {
                    "a document has no `mut` at its top: a shared value is a field of the `$state` block, read and written as `$state.name`"
                };
                Err(Diagnostic::error(codes::TOP_MUT, t.span, msg))
            }
            Tok::Name if self.text_of(t.span) == "fixture" && self.kind_at(1)? == Tok::Name => Err(Diagnostic::error(
                codes::NO_TESTS,
                t.span,
                "there are no fixtures in the language for now: core's tests are target checks",
            )),
            Tok::Kw(Kw::Pack) if !self.in_pack() && self.entry != Entry::Body => Err(Diagnostic::error(
                codes::PACK_IN_DOCUMENT,
                t.span,
                "a document has no pack block: a pack is a folder of .mkp files",
            )),
            _ => {
                if let Some(d) = self.decl()? {
                    return Ok(Item::Decl(d));
                }
                if self.entry == Entry::Body {
                    return Ok(Item::Stmt(self.stmt(BlockKind::View)?));
                }
                let where_ = if self.in_pack() { "in a .mkp file" } else { "above the `@@@` line" };
                Err(Diagnostic::error(
                    codes::DRAWING_IN_FILE,
                    t.span,
                    format!("nothing {} draws: expected a declaration, found {}", where_, describe(self.src, &t)),
                ))
            }
        }
    }

    fn import(&mut self) -> R<Import> {
        let start = self.bump()?.span;
        let mut path = vec![self.ident("a pack name")?];
        if self.eat(P::Dot)? {
            path.push(self.ident("a name the pack provides")?);
        }
        let alias = if self.eat_kw(Kw::As)? { Some(self.ident("a new name")?) } else { None };
        self.semi()?;
        Ok(Import { path, alias, span: start.to(Span::at(self.prev_end)) })
    }

    fn state_block(&mut self) -> R<StateBlock> {
        let start = self.here()?;
        if self.in_pack() {
            return Err(Diagnostic::error(
                codes::STATE_IN_PACK,
                start,
                "a pack keeps no state: `$state` is written only in a document, above its `@@@` line",
            ));
        }
        if self.has_state {
            return Err(Diagnostic::error(
                codes::STATE_TWICE,
                start,
                "a document has one `$state` block: put every shared value in it",
            ));
        }
        self.has_state = true;
        self.bump()?;
        let open = self.expect(P::LBrace)?;
        let members = self.body(open, |p| {
            if p.at_kw(Kw::Require)? {
                return Ok(Member::Require(p.require()?));
            }
            if p.at_kw(Kw::Mut)? {
                let at = p.here()?;
                return Err(Diagnostic::error(
                    codes::STATE_FIELD_MUT,
                    at,
                    "every field of `$state` can change, so it is written without `mut`",
                ));
            }
            let f = p.field(false)?;
            if f.default.is_none() {
                return Err(Diagnostic::error(
                    codes::STATE_FIELD_DEFAULT,
                    Span::at(p.prev_end),
                    format!("a field of `$state` has a starting value: `{}: type = value;`", f.name.name),
                ));
            }
            p.semi()?;
            Ok(Member::Field(f))
        })?;
        Ok(StateBlock { span: start.to(members.span), members })
    }

    fn expose(&mut self) -> R<Expose> {
        self.bump()?;
        let name = self.ident("the name of an extern channel")?;
        let open = self.expect(P::LBrace)?;
        let fns = self.body(open, |p| {
            if !p.at_kw(Kw::Fn)? {
                return Err(p.unexpected("an exposed `fn`"));
            }
            p.fn_decl(false)
        })?;
        Ok(Expose { name, fns })
    }

    /// `//@param` lines name an input or a parameter of what they document.
    fn check_docs(&mut self, node: &Node<Item>) {
        let names: Vec<String> = match &node.item {
            Item::Decl(Decl { kind: DeclKind::Widget(w) | DeclKind::ExternWidget(w), .. }) => {
                let mut out: Vec<String> = w.inputs.iter().map(|f| f.name.name.clone()).collect();
                if let Some(b) = &w.body {
                    for m in b.iter() {
                        if let WidgetMember::Param(f) = m {
                            out.push(f.name.name.clone());
                        }
                    }
                }
                out
            }
            Item::Decl(Decl { kind: DeclKind::Fn(f) | DeclKind::ExternFn(f), .. }) => {
                f.sig.params.iter().map(|p| p.name.name.clone()).collect()
            }
            _ => Vec::new(),
        };
        for c in node.docs() {
            if let Some(rest) = c.text.strip_prefix("//@param ") {
                let name = rest.split_whitespace().next().unwrap_or("");
                if !names.iter().any(|n| n == name) {
                    self.diags.push(Diagnostic::error(
                        codes::DOC_PARAM,
                        c.span,
                        format!("`//@param {}` names no input or parameter of what it documents", name),
                    ));
                }
            }
        }
    }

    // ---- declarations

    fn decl(&mut self) -> R<Option<Decl>> {
        let start = self.here()?;
        let kind = match self.kind()? {
            Tok::Kw(Kw::Enum) => DeclKind::Enum(self.enum_decl()?),
            Tok::Kw(Kw::Token) => DeclKind::Token(self.token_decl()?),
            Tok::Kw(Kw::Record) => DeclKind::Record(self.record_decl()?),
            Tok::Kw(Kw::Type) => {
                self.bump()?;
                let name = self.ident("a type's name")?;
                self.expect(P::Eq)?;
                let ty = self.ty()?;
                self.semi()?;
                DeclKind::Alias(AliasDecl { name, ty })
            }
            Tok::Kw(Kw::Interface) => DeclKind::Interface(self.interface_decl(false)?),
            Tok::Kw(Kw::Widget) if self.kind_at(1)? == Tok::Kw(Kw::Interface) => {
                self.bump()?;
                DeclKind::Interface(self.interface_decl(true)?)
            }
            Tok::Kw(Kw::Widget) => DeclKind::Widget(self.widget_decl(false)?),
            Tok::Kw(Kw::Fn) => DeclKind::Fn(self.fn_decl(false)?),
            Tok::Kw(Kw::Extern) => self.extern_decl()?,
            Tok::Kw(Kw::Pack) => DeclKind::Pack(self.pack_decl()?),
            Tok::Kw(Kw::Tokens) => DeclKind::Tokens(self.tokens_decl()?),
            Tok::Kw(Kw::Let) => {
                self.bump()?;
                let v = self.var_rest()?;
                DeclKind::Let(v)
            }
            _ => return Ok(None),
        };
        Ok(Some(Decl { kind, span: start.to(Span::at(self.prev_end)) }))
    }

    fn enum_decl(&mut self) -> R<EnumDecl> {
        self.bump()?;
        let name = self.ident("an enum's name")?;
        let generics = self.generics()?;
        let open = self.expect(P::LBrace)?;
        let cases = self.group(open, P::RBrace, |p| p.case_decl())?;
        Ok(EnumDecl { name, generics, cases })
    }

    fn case_decl(&mut self) -> R<CaseDecl> {
        if self.kind()? == Tok::Name && self.kind_at(1)? == Tok::P(P::Colon) {
            let at = self.here()?;
            return Err(Diagnostic::error(
                codes::TOKEN_SHAPE,
                at,
                "these braces hold cases, written in capitals, not fields",
            ));
        }
        let name = self.caps("a case, written in capitals")?;
        let fields = if self.at(P::LParen)? {
            let open = self.bump()?.span;
            Some(self.group(open, P::RParen, |p| {
                let f = p.field(false)?;
                if f.mutable || f.default.is_some() {
                    return Err(Diagnostic::error(
                        codes::CASE_VALUE,
                        f.span,
                        "a case's values are plain: no `mut` and no default, since a case is made with every value given",
                    ));
                }
                Ok(f)
            })?)
        } else {
            None
        };
        Ok(CaseDecl { name, fields })
    }

    fn token_decl(&mut self) -> R<TokenDecl> {
        self.bump()?;
        let name = self.ident("a token type's name")?;
        if !self.at(P::Colon)? {
            let at = self.here()?;
            return Err(Diagnostic::error(
                codes::TOKEN_SHAPE,
                at,
                format!("a token type writes the type of its values after a colon: `token {}: type {{ CASES }}`", name.name),
            ));
        }
        self.bump()?;
        let ty = self.ty()?;
        let implements = self.implements()?;
        let open = self.expect(P::LBrace)?;
        let cases = self.group(open, P::RBrace, |p| p.case_decl())?;
        Ok(TokenDecl { name, ty, implements, cases })
    }

    fn record_decl(&mut self) -> R<RecordDecl> {
        self.bump()?;
        let name = self.ident("a record's name")?;
        let generics = self.generics()?;
        let implements = self.implements()?;
        let open = self.expect(P::LBrace)?;
        let members = self.body(open, |p| {
            if p.at_kw(Kw::Require)? {
                return Ok(Member::Require(p.require()?));
            }
            let f = p.field(false)?;
            p.semi()?;
            Ok(Member::Field(f))
        })?;
        Ok(RecordDecl { name, generics, implements, members })
    }

    fn interface_decl(&mut self, widget: bool) -> R<InterfaceDecl> {
        self.expect_kw(Kw::Interface)?;
        let name = self.ident("an interface's name")?;
        let generics = self.generics()?;
        let open = self.expect(P::LBrace)?;
        let members = self.body(open, |p| {
            if p.at_kw(Kw::Fn)? {
                let sig = p.fn_sig(true)?;
                p.semi()?;
                return Ok(IfaceMember::Fn(sig));
            }
            if p.at_kw(Kw::Event)? {
                return Ok(IfaceMember::Event(p.event_decl()?));
            }
            let f = p.field(false)?;
            p.semi()?;
            Ok(IfaceMember::Field(f))
        })?;
        Ok(InterfaceDecl { widget, name, generics, members })
    }

    pub(crate) fn require(&mut self) -> R<Require> {
        self.expect_kw(Kw::Require)?;
        if self.kind()? != Tok::Text {
            return Err(self.unexpected("the rule's message, as a text: `require \"…\" {`"));
        }
        let message = self.text_lit()?;
        let body = self.block(BlockKind::Code)?;
        Ok(Require { message, body })
    }

    fn event_decl(&mut self) -> R<EventDecl> {
        self.expect_kw(Kw::Event)?;
        let name = self.ident("an event's name")?;
        let open = self.expect(P::LParen)?;
        let params = self.group(open, P::RParen, |p| p.param(true))?;
        self.semi()?;
        Ok(EventDecl { name, params })
    }

    pub(crate) fn fn_decl(&mut self, external: bool) -> R<FnDecl> {
        let sig = self.fn_sig(true)?;
        let body = if external && self.eat(P::Semi)? {
            None
        } else {
            Some(self.block(BlockKind::Code)?)
        };
        Ok(FnDecl { sig, body })
    }

    /// `fn [type [<…>] .] name [<…>] (params) [: type]`
    fn fn_sig(&mut self, typed: bool) -> R<FnSig> {
        let start = self.expect_kw(Kw::Fn)?;
        let first = self.ident("a fn's name")?;
        let first_generics = self.generics()?;
        let (on, name, generics) = if self.eat(P::Dot)? {
            let name = self.ident("a fn's name")?;
            let generics = self.generics()?;
            (Some((first, first_generics)), name, generics)
        } else {
            (None, first, first_generics)
        };
        let open = self.expect(P::LParen)?;
        let params = self.group(open, P::RParen, |p| p.param(typed))?;
        let ret = self.ret_type()?;
        Ok(FnSig { on, name, generics, params, ret, span: start.to(Span::at(self.prev_end)) })
    }

    fn ret_type(&mut self) -> R<Option<RetType>> {
        if !self.eat(P::Colon)? {
            return Ok(None);
        }
        if self.at_kw(Kw::Void)? {
            let s = self.bump()?.span;
            return Ok(Some(RetType::Void(s)));
        }
        Ok(Some(RetType::Type(self.ty()?)))
    }

    /// `[mut] self [: type]` or `[mut] name: type`. With `typed` false, as in a lambda, the type
    /// may be left out.
    fn param(&mut self, typed: bool) -> R<Param> {
        let mutable = self.eat_kw(Kw::Mut)?;
        if self.at_kw(Kw::SelfKw)? {
            let s = self.bump()?.span;
            let ty = if self.eat(P::Colon)? { Some(self.ty()?) } else { None };
            return Ok(Param { mutable, name: Ident { name: "self".into(), span: s }, is_self: true, ty });
        }
        let name = self.ident("a parameter's name")?;
        let ty = if self.eat(P::Colon)? {
            Some(self.ty()?)
        } else if typed {
            return Err(Diagnostic::error(
                codes::MISSING_TYPE,
                Span::at(self.prev_end),
                format!("a definition writes its parameters' types: `{}: type`; only a lambda may leave them out", name.name),
            ));
        } else {
            None
        };
        Ok(Param { mutable, name, is_self: false, ty })
    }

    /// `[param] [mut] name: type [= value]`
    pub(crate) fn field(&mut self, param: bool) -> R<Field> {
        let start = self.here()?;
        let mutable = self.eat_kw(Kw::Mut)?;
        let name = self.ident("a field's name")?;
        if !self.at(P::Colon)? {
            return Err(Diagnostic::error(
                codes::MISSING_TYPE,
                Span::at(self.prev_end),
                format!("`{}` writes its type: `{}: type`", name.name, name.name),
            ));
        }
        self.bump()?;
        let ty = self.ty()?;
        let default = if self.eat(P::Eq)? { Some(self.expr()?) } else { None };
        Ok(Field { mutable, param, name, ty, default, span: start.to(Span::at(self.prev_end)) })
    }

    fn widget_decl(&mut self, external: bool) -> R<WidgetDecl> {
        self.expect_kw(Kw::Widget)?;
        let name = self.ident("a widget's name")?;
        let generics = self.generics()?;
        let open = self.expect(P::LParen)?;
        let inputs = self.group(open, P::RParen, |p| p.field(false))?;
        let implements = self.implements()?;
        if external && self.eat(P::Semi)? {
            return Ok(WidgetDecl { name, generics, inputs, implements, body: None });
        }
        let open = self.expect(P::LBrace)?;
        let mut rank = 0;
        let mut out_of_order = None;
        let mut has_view = false;
        let mut has_markdown = false;
        let body = self.body(open, |p| {
            let at = p.here()?;
            let (r, m) = p.widget_member(external)?;
            if r < rank && out_of_order.is_none() {
                out_of_order = Some(at);
            }
            rank = rank.max(r);
            has_view |= matches!(m, WidgetMember::View(_));
            has_markdown |= matches!(m, WidgetMember::Markdown(_));
            Ok(m)
        })?;
        if let Some(at) = out_of_order {
            self.diags.push(Diagnostic::error(
                codes::WIDGET_ORDER,
                at,
                "a widget's body is, in order: param inputs, slots, events, require blocks, its own mut and let variables, its fns, view, and markdown",
            ));
        }
        if !external && !has_view {
            self.diags.push(Diagnostic::error(codes::WIDGET_VIEW, name.span, format!("widget `{}` has no view block", name.name)));
        }
        if !external && !has_markdown && self.in_pack() {
            self.diags.push(Diagnostic::error(
                codes::WIDGET_MARKDOWN,
                name.span,
                format!("widget `{}` has no markdown block: in a .mkp file every widget says what it is as Markdown (`markdown {{ }}` writes nothing)", name.name),
            ));
        }
        Ok(WidgetDecl { name, generics, inputs, implements, body: Some(body) })
    }

    fn widget_member(&mut self, external: bool) -> R<(u8, WidgetMember)> {
        let t = self.peek()?.clone();
        let allowed = |p: &mut Self, what: &str| -> R<()> {
            if external {
                return Err(Diagnostic::error(
                    codes::EXPECTED,
                    t.span,
                    format!("an extern widget's body holds only slots, events and a markdown block, not {}", what),
                ));
            }
            let _ = p;
            Ok(())
        };
        Ok(match t.kind {
            Tok::Kw(Kw::Param) => {
                allowed(self, "param")?;
                self.bump()?;
                let f = self.field(true)?;
                self.semi()?;
                (0, WidgetMember::Param(f))
            }
            Tok::Kw(Kw::Slot) => {
                self.bump()?;
                let name = self.ident("a slot's name")?;
                self.expect(P::Colon)?;
                let ty = self.ty()?;
                self.semi()?;
                (1, WidgetMember::Slot(SlotDecl { name, ty }))
            }
            Tok::Kw(Kw::Event) => (2, WidgetMember::Event(self.event_decl()?)),
            Tok::Kw(Kw::Require) => {
                allowed(self, "require")?;
                (3, WidgetMember::Require(self.require()?))
            }
            Tok::Kw(Kw::Mut) => {
                allowed(self, "mut")?;
                self.bump()?;
                (4, WidgetMember::Own(self.var_rest()?))
            }
            Tok::Kw(Kw::Let) => {
                allowed(self, "let")?;
                self.bump()?;
                (4, WidgetMember::Let(self.var_rest()?))
            }
            Tok::Kw(Kw::Fn) => {
                allowed(self, "fn")?;
                (5, WidgetMember::Fn(self.fn_decl(false)?))
            }
            Tok::Kw(Kw::View) => {
                allowed(self, "view")?;
                self.bump()?;
                (6, WidgetMember::View(self.block(BlockKind::View)?))
            }
            Tok::Kw(Kw::Markdown) => (7, WidgetMember::Markdown(self.markdown_block()?)),
            Tok::Kw(Kw::Expose) => {
                return Err(Diagnostic::error(
                    codes::EXPOSE_IN_WIDGET,
                    t.span,
                    "expose is written only at the top of a document: the app has no way to say which widget on the page it means",
                ))
            }
            _ => {
                return Err(self.unexpected(
                    "a widget's body: param, slot, event, require, mut, let, fn, view or markdown",
                ))
            }
        })
    }

    /// `name: type = value;` after `let` or `mut`.
    pub(crate) fn var_rest(&mut self) -> R<Var> {
        let name = self.ident("a variable's name")?;
        if !self.at(P::Colon)? {
            return Err(Diagnostic::error(
                codes::MISSING_TYPE,
                Span::at(self.prev_end),
                format!("every `let` and `mut` writes its type: `{}: type = value;`", name.name),
            ));
        }
        self.bump()?;
        let ty = self.ty()?;
        self.expect(P::Eq)?;
        let value = self.expr()?;
        self.semi()?;
        Ok(Var { name, ty, value })
    }

    fn extern_decl(&mut self) -> R<DeclKind> {
        self.bump()?;
        match self.kind()? {
            Tok::Kw(Kw::Type) => {
                self.bump()?;
                let name = self.ident("a type's name")?;
                let generics = self.generics()?;
                let implements = self.implements()?;
                self.semi()?;
                Ok(DeclKind::ExternType(ExternType { name, generics, implements }))
            }
            Tok::Kw(Kw::Fn) => Ok(DeclKind::ExternFn(self.fn_decl(true)?)),
            Tok::Kw(Kw::Widget) => Ok(DeclKind::ExternWidget(self.widget_decl(true)?)),
            Tok::Name => {
                let name = self.ident("an extern channel's name")?;
                let open = self.expect(P::LBrace)?;
                let members = self.body(open, |p| {
                    if p.at_kw(Kw::Fn)? {
                        let sig = p.fn_sig(true)?;
                        p.semi()?;
                        return Ok(ExternMember::Fn(sig));
                    }
                    let f = p.field(false)?;
                    p.semi()?;
                    Ok(ExternMember::Field(f))
                })?;
                Ok(DeclKind::ExternBlock(ExternBlock { name, members }))
            }
            _ => Err(self.unexpected("`type`, `fn`, `widget` or a channel's name after `extern`")),
        }
    }

    fn version(&mut self) -> R<Ident> {
        self.expect(P::At)?;
        if self.kind()? != Tok::Number {
            return Err(self.unexpected("a version, a whole number"));
        }
        self.token_ident()
    }

    fn pack_decl(&mut self) -> R<PackDecl> {
        self.bump()?;
        let name = self.ident("a pack's name")?;
        if !self.at(P::At)? {
            let at = self.here()?;
            return Err(Diagnostic::error(
                codes::OLD_PACK_LINE,
                at,
                format!("a pack writes its version after its name: `pack {}@1 {{`", name.name),
            ));
        }
        let version = self.version()?;
        let open = self.expect(P::LBrace)?;
        let lines = self.body(open, |p| {
            let t = p.peek()?.clone();
            let word = p.text_of(t.span);
            let line = if t.kind == Tok::Name && word == "uses" {
                p.bump()?;
                let mut refs = Vec::new();
                loop {
                    let name = p.ident("a pack's name")?;
                    let version = p.version()?;
                    refs.push(PackRef { name, version });
                    if !p.eat(P::Comma)? {
                        break;
                    }
                }
                PackLine::Uses(refs)
            } else if t.kind == Tok::Name && word == "provides" {
                p.bump()?;
                let mut names = vec![p.ident("a name")?];
                while p.eat(P::Comma)? {
                    names.push(p.ident("a name")?);
                }
                PackLine::Provides(names)
            } else if t.kind == Tok::Kw(Kw::Implements) {
                p.bump()?;
                let mut refs = Vec::new();
                loop {
                    let pack = p.ident("a pack's name")?;
                    p.expect(P::Dot)?;
                    let level = p.ident("a level")?;
                    let version = p.version()?;
                    refs.push(LevelRef { pack, level, version });
                    if !p.eat(P::Comma)? {
                        break;
                    }
                }
                PackLine::Implements(refs)
            } else {
                return Err(Diagnostic::error(
                    codes::OLD_PACK_LINE,
                    t.span,
                    "a pack block holds `uses`, `provides` and `implements` lines: `uses core@1, charts@2;`",
                ));
            };
            p.semi()?;
            Ok(line)
        })?;
        Ok(PackDecl { name, version, lines })
    }

    fn tokens_decl(&mut self) -> R<TokensDecl> {
        self.bump()?;
        let name = self.ident("the tokens block's name")?;
        let open = self.expect(P::LBrace)?;
        let lines = self.body(open, |p| {
            let ty = p.ident("a token type")?;
            p.expect(P::Dot)?;
            let case = p.caps("a token case, written in capitals")?;
            p.expect(P::Eq)?;
            let value = p.expr()?;
            p.semi()?;
            Ok(TokenLine { ty, case, value })
        })?;
        Ok(TokensDecl { name, lines })
    }

    fn generics(&mut self) -> R<Option<Generics>> {
        if !self.at(P::Lt)? {
            return Ok(None);
        }
        let start = self.bump()?.span;
        let mut params = Vec::new();
        loop {
            let t = self.peek()?.clone();
            if t.kind == Tok::Name {
                return Err(Diagnostic::error(
                    codes::SMALL_TYPE_PARAM,
                    t.span,
                    format!("a type parameter is written in capitals: `{}`", self.text_of(t.span).to_uppercase()),
                ));
            }
            let name = self.caps("a type parameter, in capitals")?;
            let mut bounds = Vec::new();
            if self.eat(P::Colon)? {
                bounds.push(self.iface_ref()?);
                while self.eat(P::Plus)? {
                    bounds.push(self.iface_ref()?);
                }
            }
            params.push(TypeParam { name, bounds });
            if !self.eat(P::Comma)? {
                break;
            }
        }
        let end = self.expect(P::Gt)?;
        Ok(Some(Generics { params, span: start.to(end) }))
    }

    fn iface_ref(&mut self) -> R<IfaceRef> {
        let name = self.ident("an interface")?;
        let mut args = Vec::new();
        if self.eat(P::Lt)? {
            loop {
                args.push(self.ty()?);
                if !self.eat(P::Comma)? {
                    break;
                }
            }
            self.expect(P::Gt)?;
        }
        let span = name.span.to(Span::at(self.prev_end));
        Ok(IfaceRef { name, args, span })
    }

    fn implements(&mut self) -> R<Vec<IfaceRef>> {
        let mut out = Vec::new();
        if self.eat_kw(Kw::Implements)? {
            loop {
                out.push(self.iface_ref()?);
                if !self.eat(P::Comma)? {
                    break;
                }
            }
        }
        Ok(out)
    }

    // ---- types

    pub(crate) fn ty(&mut self) -> R<Type> {
        let start = self.here()?;
        let t = self.peek()?.clone();
        let base = match t.kind {
            Tok::Kw(Kw::Any) => {
                self.bump()?;
                TypeBase::Any(self.iface_ref()?)
            }
            Tok::Kw(Kw::View) => {
                self.bump()?;
                TypeBase::View
            }
            Tok::Kw(Kw::SelfKw) => {
                self.bump()?;
                TypeBase::SelfType
            }
            Tok::Kw(Kw::Fn) => {
                self.bump()?;
                let open = self.expect(P::LParen)?;
                let params = self.group(open, P::RParen, |p| p.param(true))?;
                let ret = self.ret_type()?.map(Box::new);
                TypeBase::Fn { params, ret }
            }
            Tok::P(P::LBrace) => {
                let open = self.bump()?.span;
                TypeBase::Record(self.group(open, P::RBrace, |p| p.field(false))?)
            }
            Tok::Caps => {
                let name = self.caps("a type")?;
                let length = self.length()?;
                TypeBase::Param { name, length }
            }
            Tok::Name => {
                let name = self.ident("a type")?;
                let args = if self.eat(P::Lt)? {
                    let mut args = Vec::new();
                    loop {
                        args.push(self.ty()?);
                        if !self.eat(P::Comma)? {
                            break;
                        }
                    }
                    self.expect(P::Gt)?;
                    Some(args)
                } else {
                    None
                };
                let length = self.length()?;
                TypeBase::Named { name, args, length }
            }
            Tok::Kw(Kw::Implements) => {
                return Err(Diagnostic::error(
                    codes::INTERFACE_AS_TYPE,
                    t.span,
                    "`implements` is not a type: write `any chart` for any type that fits an interface, or `<T: chart>` for one",
                ))
            }
            _ => return Err(self.unexpected("a type")),
        };
        let contract = self.contract()?;
        if let (TypeBase::Named { name, .. }, Some(Contract::Range(r))) = (&base, &contract) {
            if name.name == "text" {
                return Err(Diagnostic::error(
                    codes::RANGE_ON_TEXT,
                    r.span,
                    "text has no ranges: it has a length, `text[1...]`, and `only (…)`",
                ));
            }
        }
        Ok(Type { base, contract, span: start.to(Span::at(self.prev_end)) })
    }

    fn starts_contract(&mut self) -> R<bool> {
        Ok(match self.kind()? {
            Tok::Number | Tok::Duration | Tok::Text => true,
            Tok::P(P::Minus) | Tok::P(P::LParen) | Tok::P(P::DotDotDot) => true,
            Tok::Kw(Kw::Step) | Tok::Kw(Kw::Only) => true,
            Tok::Name => matches!(self.kind_at(1)?, Tok::P(P::DotDot) | Tok::P(P::DotDotDot)),
            _ => false,
        })
    }

    fn contract(&mut self) -> R<Option<Contract>> {
        if !self.starts_contract()? {
            return Ok(None);
        }
        if self.kind()? == Tok::Text {
            let at = self.here()?;
            return Err(Diagnostic::error(
                codes::RANGE_ON_TEXT,
                at,
                "text has no ranges: it has a length, `text[1...]`, and `only (…)`",
            ));
        }
        if self.eat_kw(Kw::Step)? {
            return Ok(Some(Contract::Step(self.bound()?)));
        }
        if self.at_kw(Kw::Only)? {
            self.bump()?;
            let open = self.expect(P::LParen)?;
            let values = self.group(open, P::RParen, |p| p.expr())?;
            return Ok(Some(Contract::Only(values)));
        }
        let r = self.range_contract()?;
        if matches!(self.kind()?, Tok::P(P::Minus) | Tok::P(P::Plus) | Tok::P(P::Star) | Tok::P(P::Slash) | Tok::P(P::Percent)) {
            let at = self.here()?;
            return Err(Diagnostic::error(
                codes::BOUND,
                at,
                "a bound is a number, a name or a constant in brackets: anything longer goes in brackets, `0..(limit - 1)`",
            ));
        }
        Ok(Some(Contract::Range(r)))
    }

    fn range_contract(&mut self) -> R<RangeContract> {
        let start = self.here()?;
        let (low, high) = if self.eat(P::DotDotDot)? {
            (None, Some(self.bound()?))
        } else {
            let low = self.bound()?;
            if self.eat(P::DotDot)? {
                (Some(low), Some(self.bound()?))
            } else if self.eat(P::DotDotDot)? {
                (Some(low), None)
            } else {
                return Err(self.unexpected("`..` or `...` in a range"));
            }
        };
        let step = if self.eat_kw(Kw::Step)? { Some(self.bound()?) } else { None };
        Ok(RangeContract { low, high, step, span: start.to(Span::at(self.prev_end)) })
    }

    /// `[-] number | duration | name | (expr)`
    pub(crate) fn bound(&mut self) -> R<Bound> {
        let start = self.here()?;
        let negative = self.eat(P::Minus)?;
        let t = self.peek()?.clone();
        match t.kind {
            Tok::Number | Tok::Duration => {
                self.bump()?;
                Ok(Bound::Number {
                    negative,
                    text: self.text_of(t.span).to_string(),
                    duration: t.kind == Tok::Duration,
                    span: start.to(t.span),
                })
            }
            Tok::Name if negative => Err(Diagnostic::error(
                codes::NEGATIVE_NAME_BOUND,
                start.to(t.span),
                format!("a minus in a bound is a number's sign: write a negative name in brackets, `(-{})`", self.text_of(t.span)),
            )),
            Tok::Name => Ok(Bound::Name(self.ident("a bound")?)),
            Tok::P(P::LParen) if !negative => {
                let open = self.bump()?.span;
                let e = self.expr()?;
                let close = self.expect(P::RParen)?;
                Ok(Bound::Expr(Box::new(Expr { kind: ExprKind::Paren(Box::new(e)), span: open.to(close) })))
            }
            _ => Err(self.unexpected("a bound: a number, a name, or a constant in brackets")),
        }
    }

    fn length(&mut self) -> R<Option<Length>> {
        if !self.at(P::LBracket)? {
            return Ok(None);
        }
        self.bump()?;
        let start = self.here()?;
        let out = if self.at(P::DotDotDot)? {
            Length::Range(self.range_contract()?)
        } else {
            let b = self.bound()?;
            if self.at(P::DotDot)? || self.at(P::DotDotDot)? {
                let high = if self.eat(P::DotDot)? {
                    Some(self.bound()?)
                } else {
                    self.bump()?;
                    None
                };
                Length::Range(RangeContract { low: Some(b), high, step: None, span: start.to(Span::at(self.prev_end)) })
            } else {
                Length::Exact(b)
            }
        };
        self.expect(P::RBracket)?;
        Ok(Some(out))
    }

    // ---- blocks and statements

    pub(crate) fn block(&mut self, kind: BlockKind) -> R<Block> {
        let open = self.expect(P::LBrace)?;
        self.block_rest(kind, open)
    }

    pub(crate) fn block_rest(&mut self, kind: BlockKind, open: Span) -> R<Block> {
        let opened = self.take_trailing()?;
        let one_line = opened.is_empty() && !self.on_new_line()?;
        let mut stmts = Vec::new();
        loop {
            if self.at(P::RBrace)? {
                let dangling = self.take_leading()?;
                if !stmts.is_empty() {
                    if one_line && matches!(kind, BlockKind::Code | BlockKind::View) {
                        self.layout_warning(open, "an opening brace ends its line: put this block's statements on lines of their own");
                    } else if !one_line && !self.on_new_line()? {
                        let at = self.here()?;
                        self.layout_warning(at, "a closing brace starts its own line");
                    }
                }
                let end = self.bump()?.span;
                return Ok(Block { stmts, kind, one_line, open: opened, dangling, span: open.to(end) });
            }
            if self.kind()? == Tok::Eof {
                return Err(Diagnostic::error(codes::EXPECTED, open, "this block is never closed: expected `}`"));
            }
            let leading = self.take_leading()?;
            let newline = self.on_new_line()?;
            let stmt = self.stmt(kind)?;
            let trailing = self.take_trailing()?;
            stmts.push(Node { leading, item: stmt, trailing, newline });
        }
    }

    fn inner(kind: BlockKind) -> BlockKind {
        match kind {
            BlockKind::View => BlockKind::View,
            _ => BlockKind::Code,
        }
    }

    pub(crate) fn stmt(&mut self, kind: BlockKind) -> R<Stmt> {
        let view = kind == BlockKind::View;
        let t = self.peek()?.clone();
        match t.kind {
            Tok::Kw(Kw::Let) => {
                self.bump()?;
                Ok(Stmt::Let(self.var_rest()?))
            }
            Tok::Kw(Kw::Mut) if self.kind_at(1)? == Tok::Kw(Kw::For) => Ok(Stmt::For(self.for_stmt(kind)?)),
            Tok::Kw(Kw::Mut) if !view => {
                self.bump()?;
                Ok(Stmt::Mut(self.var_rest()?))
            }
            Tok::Kw(Kw::Mut) => Err(Diagnostic::error(
                codes::EXPECTED,
                t.span,
                "a view holds let, if, for, match and views: a widget's own `mut` variables are written in its body, before `view`",
            )),
            Tok::Kw(Kw::Return) if !view => {
                self.bump()?;
                let value = if self.at(P::Semi)? { None } else { Some(self.expr()?) };
                self.semi()?;
                Ok(Stmt::Return(value))
            }
            Tok::Kw(Kw::Invoke) if !view => {
                self.bump()?;
                let name = self.ident("an event's name")?;
                let open = self.expect(P::LParen)?;
                let args = self.group(open, P::RParen, |p| p.arg())?;
                self.semi()?;
                Ok(Stmt::Invoke { name, args })
            }
            Tok::Kw(Kw::If) => Ok(Stmt::If(self.if_stmt(kind)?)),
            Tok::Kw(Kw::For) => Ok(Stmt::For(self.for_stmt(kind)?)),
            Tok::Kw(Kw::Match) => Ok(Stmt::Match(self.match_stmt(kind)?)),
            Tok::Kw(Kw::State) if self.kind_at(1)? == Tok::P(P::LBrace) => Err(Diagnostic::error(
                codes::STATE_NOT_TOP,
                t.span,
                "a `$state` block is written once, at the top of a document; to change several fields at once, write `$state = $state with { … };`",
            )),
            Tok::Name if self.text_of(t.span) == "assert" && !matches!(self.kind_at(1)?, Tok::P(_)) => Err(Diagnostic::error(
                codes::NO_TESTS,
                t.span,
                "there is no assert: the language has no tests for now, and core's tests are target checks",
            )),
            Tok::P(P::At) => {
                let call = self.view_call(true)?;
                let has_block = call.block.is_some();
                let e = Expr { span: call.span, kind: ExprKind::View(call) };
                if !has_block {
                    self.semi()?;
                }
                Ok(Stmt::Expr(e))
            }
            _ => {
                let e = self.expr()?;
                if self.at(P::Eq)? {
                    if view {
                        let at = self.here()?;
                        return Err(Diagnostic::error(
                            codes::ASSIGN_IN_VIEW,
                            at,
                            "there is no assignment in a view: drawing never changes anything; change values in an event handler",
                        ));
                    }
                    if !is_place(&e) {
                        return Err(Diagnostic::error(
                            codes::NOT_A_PLACE,
                            e.span,
                            "only a variable, `self` or `$state`, with fields and items after it, can be assigned",
                        ));
                    }
                    self.bump()?;
                    let value = self.expr()?;
                    self.semi()?;
                    return Ok(Stmt::Assign { place: e, value });
                }
                if view {
                    // a call drawn in a view is written with `@`, so every view on the page is visible
                    if matches!(e.kind, ExprKind::Call { .. }) {
                        return Err(Diagnostic::error(codes::VIEW_NEEDS_AT, e.span, "a call that returns a view is drawn with `@`: `@tile(s);`. A view holds let, if, for, match and views"));
                    }
                    return Err(Diagnostic::error(
                        codes::EXPECTED,
                        e.span,
                        "a view holds let, if, for, match and views (`@name(…)`)",
                    ));
                }
                self.semi()?;
                Ok(Stmt::Expr(e))
            }
        }
    }

    pub(crate) fn cond(&mut self) -> R<Cond> {
        let mutable = match self.kind()? {
            Tok::Kw(Kw::Let) => false,
            Tok::Kw(Kw::Mut) => true,
            _ => return Ok(Cond::Expr(self.expr()?)),
        };
        self.bump()?;
        let name = self.ident("a name")?;
        if !self.at(P::Colon)? {
            return Err(Diagnostic::error(
                codes::MISSING_TYPE,
                Span::at(self.prev_end),
                format!("opening an opt writes the type it holds: `{} {}: type = …`", if mutable { "mut" } else { "let" }, name.name),
            ));
        }
        self.bump()?;
        let ty = self.ty()?;
        self.expect(P::Eq)?;
        let value = self.expr()?;
        Ok(Cond::Open { mutable, name, ty, value })
    }

    fn if_stmt(&mut self, kind: BlockKind) -> R<IfStmt> {
        let inner = Self::inner(kind);
        self.expect_kw(Kw::If)?;
        let mut branches = Vec::new();
        let mut otherwise = None;
        loop {
            self.expect(P::LParen)?;
            let c = self.cond()?;
            self.expect(P::RParen)?;
            let b = self.block(inner)?;
            branches.push((c, b));
            if !self.at_kw(Kw::Else)? {
                break;
            }
            self.bump()?;
            if self.eat_kw(Kw::If)? {
                continue;
            }
            otherwise = Some(self.block(inner)?);
            break;
        }
        Ok(IfStmt { branches, otherwise })
    }

    /// The `(…)` of a loop: `(x in xs)` or `(k, x in xs)`, refusing counters and while loops.
    pub(crate) fn loop_head(&mut self, loop_start: Span) -> R<(Option<Ident>, Ident, Expr)> {
        self.expect(P::LParen)?;
        let no_counter = |at: Span| {
            Diagnostic::error(
                codes::NO_COUNTER_LOOP,
                at,
                "there is no counter loop and no while loop: every loop walks a list or a range, `for (i in 0..10)`",
            )
        };
        match (self.kind()?, self.kind_at(1)?, self.kind_at(2)?) {
            (Tok::Kw(Kw::Mut), Tok::Name, Tok::Kw(Kw::In)) => {
                let at = self.here()?;
                return Err(Diagnostic::error(
                    codes::MUT_IN_FOR,
                    at,
                    "`mut` goes in front of the loop: `mut for (t in xs)`",
                ));
            }
            (Tok::Name, Tok::Kw(Kw::In), _) | (Tok::Name, Tok::P(P::Comma), Tok::Name) => {}
            _ => return Err(no_counter(loop_start)),
        }
        let first = self.ident("the loop's variable")?;
        let (key, name) = if self.eat(P::Comma)? { (Some(first), self.ident("the loop's variable")?) } else { (None, first) };
        self.expect_kw(Kw::In)?;
        let over = self.expr()?;
        let here = self.here()?;
        if self.kind()? == Tok::Name && self.text_of(here) == "by" {
            let at = self.here()?;
            return Err(Diagnostic::error(
                codes::NO_BY,
                at,
                "a loop has no `by`: rows follow their items, so a loop needs no keys",
            ));
        }
        self.expect(P::RParen)?;
        Ok((key, name, over))
    }

    fn for_stmt(&mut self, kind: BlockKind) -> R<ForStmt> {
        let start = self.here()?;
        let mutable = self.eat_kw(Kw::Mut)?;
        self.expect_kw(Kw::For)?;
        let (key, name, over) = self.loop_head(start)?;
        let body = self.block(Self::inner(kind))?;
        Ok(ForStmt { mutable, key, name, over, body })
    }

    pub(crate) fn patterns(&mut self) -> R<Vec<Pattern>> {
        if self.eat_kw(Kw::Else)? {
            return Ok(Vec::new());
        }
        let start = self.here()?;
        let mut out = vec![self.pattern()?];
        while self.eat(P::Comma)? {
            out.push(self.pattern()?);
        }
        if out.len() > 1 && out.iter().any(|p| matches!(p, Pattern::Case { binds: Some(_), .. })) {
            return Err(Diagnostic::error(
                codes::CASES_BIND_SHARED,
                start.to(Span::at(self.prev_end)),
                "cases share one body only when none of them binds a name: give the case with values its own `case`",
            ));
        }
        Ok(out)
    }

    fn pattern(&mut self) -> R<Pattern> {
        let t = self.peek()?.clone();
        match t.kind {
            Tok::Name => {
                let ty = self.ident("a type")?;
                self.expect(P::Dot)?;
                let case = self.caps("a case, in capitals")?;
                let binds = if self.at(P::LParen)? {
                    self.bump()?;
                    let mut names = Vec::new();
                    if !self.at(P::RParen)? {
                        loop {
                            names.push(self.ident("a name for the case's value")?);
                            if !self.eat(P::Comma)? {
                                break;
                            }
                        }
                    }
                    self.expect(P::RParen)?;
                    Some(names)
                } else {
                    None
                };
                Ok(Pattern::Case { ty, case, binds })
            }
            Tok::P(P::Minus) | Tok::Number => {
                let negative = self.eat(P::Minus)?;
                let n = self.peek()?.clone();
                if n.kind != Tok::Number {
                    return Err(self.unexpected("a number"));
                }
                self.bump()?;
                Ok(Pattern::Number { negative, text: self.text_of(n.span).to_string(), span: t.span.to(n.span) })
            }
            Tok::Text => Ok(Pattern::Text(self.text_lit()?)),
            Tok::Kw(Kw::True) => Ok(Pattern::Bool(true, self.bump()?.span)),
            Tok::Kw(Kw::False) => Ok(Pattern::Bool(false, self.bump()?.span)),
            _ => Err(self.unexpected("a case: `type.CASE`, a number, a text, `true`, `false` or `else`")),
        }
    }

    fn match_stmt(&mut self, kind: BlockKind) -> R<MatchStmt> {
        let span = self.expect_kw(Kw::Match)?;
        self.expect(P::LParen)?;
        let subject = self.expr()?;
        self.expect(P::RParen)?;
        let open = self.expect(P::LBrace)?;
        let inner = if kind == BlockKind::View { BlockKind::View } else { BlockKind::Case };
        let cases = self.body(open, |p| {
            let start = p.expect_kw(Kw::Case)?;
            let patterns = p.patterns()?;
            let mut body = p.block(inner)?;
            if inner == BlockKind::View && body.stmts.is_empty() {
                body.one_line = true;
            }
            Ok(MatchCase { patterns, span: start.to(body.span), body })
        })?;
        Ok(MatchStmt { subject, cases, span })
    }

    // ---- views

    /// `@name [(args)]`, and a block after it when `block` allows one.
    pub(crate) fn view_call(&mut self, block: bool) -> R<ViewCall> {
        let start = self.expect(P::At)?;
        let name = self.ident("a widget's name after `@`")?;
        let args = if self.at(P::LParen).unwrap_or(false) {
            let open = self.bump()?.span;
            let g = self.group(open, P::RParen, |p| p.arg())?;
            self.check_args(&g)?;
            Some(g)
        } else {
            None
        };
        let block = if block && self.at(P::LBrace)? { Some(self.call_block(args.as_ref())?) } else { None };
        Ok(ViewCall { name, args, block, span: start.to(Span::at(self.prev_end)) })
    }

    fn check_args(&mut self, args: &Group<Arg>) -> R<()> {
        let named = args.iter().filter(|a| a.name.is_some()).count();
        if named > 0 && named < args.len() {
            let at = args.iter().find(|a| a.name.is_none()).map(|a| a.value.span).unwrap();
            return Err(Diagnostic::error(
                codes::POSITIONAL_AFTER_NAMED,
                at,
                "a call's arguments are all named, for a widget, or all in order, for a fn",
            ));
        }
        let mut seen: Vec<&str> = Vec::new();
        for a in args.iter() {
            if let Some(n) = &a.name {
                if seen.contains(&n.name.as_str()) {
                    return Err(Diagnostic::error(codes::SET_TWICE, n.span, format!("`{}` is set twice", n.name)));
                }
                seen.push(&n.name);
            }
        }
        Ok(())
    }

    fn call_block(&mut self, args: Option<&Group<Arg>>) -> R<CallBlock> {
        let open = self.expect(P::LBrace)?;
        let named = self.kind()? == Tok::Name && matches!(self.kind_at(1)?, Tok::P(P::Eq) | Tok::P(P::LBrace));
        if !named {
            return Ok(CallBlock::Children(self.block_rest(BlockKind::View, open)?));
        }
        let mut seen: Vec<String> = args.map(|g| g.iter().filter_map(|a| a.name.as_ref().map(|n| n.name.clone())).collect()).unwrap_or_default();
        let body = self.body(open, |p| {
            if p.kind()? != Tok::Name {
                return Err(p.unexpected("`input = value;` or `slot {` in a call's named block"));
            }
            let name = p.ident("an input or a slot")?;
            if seen.contains(&name.name) {
                return Err(Diagnostic::error(codes::SET_TWICE, name.span, format!("`{}` is set twice", name.name)));
            }
            seen.push(name.name.clone());
            if p.eat(P::Eq)? {
                let value = p.expr()?;
                p.semi()?;
                Ok(NamedEntry::Input { name, value })
            } else if p.at(P::LBrace)? {
                let block = p.block(BlockKind::View)?;
                Ok(NamedEntry::Slot { name, block })
            } else {
                Err(p.unexpected("`=` or `{`"))
            }
        })?;
        Ok(CallBlock::Named(body))
    }

    fn arg(&mut self) -> R<Arg> {
        if self.kind()? == Tok::Name && self.kind_at(1)? == Tok::P(P::Eq) {
            let name = self.ident("an input")?;
            self.bump()?;
            let value = self.expr()?;
            return Ok(Arg { name: Some(name), value });
        }
        Ok(Arg { name: None, value: self.expr()? })
    }

    // ---- expressions

    pub fn expr(&mut self) -> R<Expr> {
        let cond = self.or()?;
        if self.eat(P::Question)? {
            let then = self.expr()?;
            self.expect(P::Colon)?;
            let otherwise = self.expr()?;
            let span = cond.span.to(otherwise.span);
            return Ok(Expr {
                kind: ExprKind::Ternary { cond: Box::new(cond), then: Box::new(then), otherwise: Box::new(otherwise) },
                span,
            });
        }
        Ok(cond)
    }

    fn binary(left: Expr, op: BinOp, right: Expr) -> Expr {
        let span = left.span.to(right.span);
        Expr { kind: ExprKind::Binary { op, left: Box::new(left), right: Box::new(right) }, span }
    }

    fn or(&mut self) -> R<Expr> {
        let mut left = self.and()?;
        while self.eat(P::OrOr)? {
            let right = self.and()?;
            left = Self::binary(left, BinOp::Or, right);
        }
        Ok(left)
    }

    fn and(&mut self) -> R<Expr> {
        let mut left = self.equal()?;
        while self.eat(P::AndAnd)? {
            let right = self.equal()?;
            left = Self::binary(left, BinOp::And, right);
        }
        Ok(left)
    }

    fn equal_op(&mut self) -> R<Option<BinOp>> {
        Ok(match self.kind()? {
            Tok::P(P::EqEq) => Some(BinOp::Eq),
            Tok::P(P::NotEq) => Some(BinOp::Ne),
            _ => None,
        })
    }

    fn compare_op(&mut self) -> R<Option<BinOp>> {
        Ok(match self.kind()? {
            Tok::P(P::Lt) => Some(BinOp::Lt),
            Tok::P(P::Le) => Some(BinOp::Le),
            Tok::P(P::Gt) => Some(BinOp::Gt),
            Tok::P(P::Ge) => Some(BinOp::Ge),
            Tok::Kw(Kw::In) => Some(BinOp::In),
            _ => None,
        })
    }

    fn chained(&mut self) -> Diagnostic {
        let at = self.here().unwrap_or_default();
        Diagnostic::error(
            codes::CHAINED_COMPARISON,
            at,
            "comparisons don't chain: write `a < b && b < c`",
        )
    }

    fn equal(&mut self) -> R<Expr> {
        let left = self.compare()?;
        if let Some(op) = self.equal_op()? {
            self.bump()?;
            let right = self.compare()?;
            if self.equal_op()?.is_some() {
                return Err(self.chained());
            }
            return Ok(Self::binary(left, op, right));
        }
        Ok(left)
    }

    fn compare(&mut self) -> R<Expr> {
        let left = self.sum()?;
        if let Some(op) = self.compare_op()? {
            self.bump()?;
            let right = self.sum()?;
            if self.compare_op()?.is_some() {
                return Err(self.chained());
            }
            return Ok(Self::binary(left, op, right));
        }
        Ok(left)
    }

    fn sum(&mut self) -> R<Expr> {
        let mut left = self.term()?;
        loop {
            let op = match self.kind()? {
                Tok::P(P::Plus) => BinOp::Add,
                Tok::P(P::Minus) => BinOp::Sub,
                _ => return Ok(left),
            };
            self.bump()?;
            let right = self.term()?;
            left = Self::binary(left, op, right);
        }
    }

    fn term(&mut self) -> R<Expr> {
        let mut left = self.unary()?;
        loop {
            let op = match self.kind()? {
                Tok::P(P::Star) => BinOp::Mul,
                Tok::P(P::Slash) => BinOp::Div,
                Tok::P(P::Percent) => BinOp::Rem,
                _ => return Ok(left),
            };
            self.bump()?;
            let right = self.unary()?;
            left = Self::binary(left, op, right);
        }
    }

    fn unary(&mut self) -> R<Expr> {
        let t = self.peek()?.clone();
        match t.kind {
            Tok::P(P::Bang) => {
                self.bump()?;
                let operand = self.unary()?;
                let span = t.span.to(operand.span);
                Ok(Expr { kind: ExprKind::Unary { op: UnOp::Not, operand: Box::new(operand) }, span })
            }
            Tok::P(P::Minus) => {
                self.bump()?;
                let operand = self.unary()?;
                let span = t.span.to(operand.span);
                let negated_range = || {
                    Diagnostic::error(
                        codes::NEGATED_RANGE,
                        span,
                        "a whole range can't be negated: a minus before a range's first number is that bound's sign, and `range.negate(r)` negates a range",
                    )
                };
                match operand.kind {
                    ExprKind::Range { low: Some(low), high, step } => {
                        if !matches!(low.kind, ExprKind::Number(_) | ExprKind::Duration(_)) {
                            return Err(negated_range());
                        }
                        let low_span = t.span.to(low.span);
                        let low = Expr { kind: ExprKind::Unary { op: UnOp::Neg, operand: low }, span: low_span };
                        Ok(Expr { kind: ExprKind::Range { low: Some(Box::new(low)), high, step }, span })
                    }
                    ExprKind::Range { .. } => Err(negated_range()),
                    ExprKind::Paren(ref inner) if matches!(inner.kind, ExprKind::Range { .. }) => Err(negated_range()),
                    _ => Ok(Expr { kind: ExprKind::Unary { op: UnOp::Neg, operand: Box::new(operand) }, span }),
                }
            }
            _ => self.postfix(),
        }
    }

    fn postfix(&mut self) -> R<Expr> {
        let mut e = self.primary()?;
        loop {
            match self.kind()? {
                Tok::P(P::Dot) => {
                    self.bump()?;
                    match self.kind()? {
                        Tok::Caps => {
                            let name = self.caps("a case")?;
                            let args = if self.at(P::LParen)? {
                                let open = self.bump()?.span;
                                Some(self.group(open, P::RParen, |p| p.arg())?)
                            } else {
                                None
                            };
                            let span = e.span.to(Span::at(self.prev_end));
                            e = Expr { kind: ExprKind::Case { target: Box::new(e), name, args }, span };
                        }
                        _ => {
                            let name = self.ident("a field or a fn")?;
                            let span = e.span.to(name.span);
                            e = Expr { kind: ExprKind::Field { target: Box::new(e), name }, span };
                        }
                    }
                }
                Tok::P(P::LParen) => {
                    let open = self.bump()?.span;
                    let args = self.group(open, P::RParen, |p| p.arg())?;
                    let span = e.span.to(args.span);
                    e = Expr { kind: ExprKind::Call { callee: Box::new(e), args }, span };
                }
                Tok::P(P::LBracket) => {
                    self.bump()?;
                    let index = self.expr()?;
                    let end = self.expect(P::RBracket)?;
                    let span = e.span.to(end);
                    e = Expr { kind: ExprKind::Index { target: Box::new(e), index: Box::new(index) }, span };
                }
                Tok::Kw(Kw::With) => {
                    self.bump()?;
                    let open = self.expect(P::LBrace)?;
                    let inits = self.group(open, P::RBrace, |p| p.init())?;
                    let span = e.span.to(inits.span);
                    e = Expr { kind: ExprKind::With { target: Box::new(e), inits }, span };
                }
                _ => return Ok(e),
            }
        }
    }

    fn init(&mut self) -> R<Init> {
        let mutable = self.eat_kw(Kw::Mut)?;
        let name = self.ident("a field's name")?;
        self.expect(P::Eq)?;
        let value = self.expr()?;
        Ok(Init { mutable, name, value })
    }

    /// A range's bound in an expression: a number with its sign, a duration, a name, or `(expr)`.
    fn range_bound(&mut self) -> R<Expr> {
        let t = self.peek()?.clone();
        match t.kind {
            Tok::P(P::Minus) => {
                self.bump()?;
                let n = self.peek()?.clone();
                match n.kind {
                    Tok::Number | Tok::Duration => {
                        let operand = self.atom()?;
                        Ok(Expr { span: t.span.to(operand.span), kind: ExprKind::Unary { op: UnOp::Neg, operand: Box::new(operand) } })
                    }
                    Tok::Name => Err(Diagnostic::error(
                        codes::NEGATIVE_NAME_BOUND,
                        t.span.to(n.span),
                        format!("a minus in a range is a number's sign: write a negative name in brackets, `(-{})`", self.text_of(n.span)),
                    )),
                    _ => Err(self.unexpected("a bound: a number, a name, or an expression in brackets")),
                }
            }
            Tok::Number | Tok::Duration | Tok::Name | Tok::P(P::LParen) => self.atom(),
            _ => Err(self.unexpected("a bound: a number, a name, or an expression in brackets")),
        }
    }

    fn atom(&mut self) -> R<Expr> {
        let t = self.peek()?.clone();
        match t.kind {
            Tok::Number => {
                self.bump()?;
                Ok(Expr { kind: ExprKind::Number(self.text_of(t.span).to_string()), span: t.span })
            }
            Tok::Duration => {
                self.bump()?;
                Ok(Expr { kind: ExprKind::Duration(self.text_of(t.span).to_string()), span: t.span })
            }
            Tok::Name => {
                let name = self.ident("a name")?;
                Ok(Expr { span: name.span, kind: ExprKind::Name(name) })
            }
            Tok::P(P::LParen) => {
                let open = self.bump()?.span;
                let inner = self.expr()?;
                let close = self.expect(P::RParen)?;
                Ok(Expr { kind: ExprKind::Paren(Box::new(inner)), span: open.to(close) })
            }
            _ => Err(self.unexpected("an expression")),
        }
    }

    fn maybe_range(&mut self, low: Option<Expr>, start: Span) -> R<Expr> {
        let (low, high) = if self.eat(P::DotDot)? {
            (low, Some(self.range_bound()?))
        } else {
            self.expect(P::DotDotDot)?;
            if low.is_some() {
                (low, None)
            } else {
                (None, Some(self.range_bound()?))
            }
        };
        let step = if self.eat_kw(Kw::Step)? { Some(Box::new(self.range_bound()?)) } else { None };
        Ok(Expr {
            kind: ExprKind::Range { low: low.map(Box::new), high: high.map(Box::new), step },
            span: start.to(Span::at(self.prev_end)),
        })
    }

    fn primary(&mut self) -> R<Expr> {
        let t = self.peek()?.clone();
        match t.kind {
            Tok::Name if self.kind_at(1)? == Tok::P(P::LBrace) => {
                let ty = self.ident("a record's type")?;
                let open = self.bump()?.span;
                let inits = self.group(open, P::RBrace, |p| p.init())?;
                let span = t.span.to(inits.span);
                Ok(Expr { kind: ExprKind::Record { ty: Some(ty), inits }, span })
            }
            Tok::Number | Tok::Duration | Tok::Name | Tok::P(P::LParen) => {
                let a = self.atom()?;
                if self.at(P::DotDot)? || self.at(P::DotDotDot)? {
                    let start = a.span;
                    return self.maybe_range(Some(a), start);
                }
                Ok(a)
            }
            Tok::P(P::DotDotDot) => self.maybe_range(None, t.span),
            Tok::Text => {
                let lit = self.text_lit()?;
                Ok(Expr { span: lit.span, kind: ExprKind::Text(lit) })
            }
            Tok::Kw(Kw::True) | Tok::Kw(Kw::False) => {
                self.bump()?;
                Ok(Expr { kind: ExprKind::Bool(t.kind == Tok::Kw(Kw::True)), span: t.span })
            }
            Tok::Kw(Kw::SelfKw) => {
                self.bump()?;
                Ok(Expr { kind: ExprKind::SelfValue, span: t.span })
            }
            Tok::Kw(Kw::State) => {
                if self.in_pack() {
                    self.diags.push(Diagnostic::error(
                        codes::STATE_IN_PACK,
                        t.span,
                        "a pack keeps no state, so its widgets can't read `$state`: take the value as a `mut` input, and the document passes it a field",
                    ));
                }
                self.bump()?;
                Ok(Expr { kind: ExprKind::State, span: t.span })
            }
            Tok::P(P::LBracket) => {
                let open = self.bump()?.span;
                let items = self.group(open, P::RBracket, |p| p.expr())?;
                Ok(Expr { span: items.span, kind: ExprKind::List(items) })
            }
            Tok::P(P::LBrace) => {
                let open = self.bump()?.span;
                let inits = self.group(open, P::RBrace, |p| p.init())?;
                Ok(Expr { span: inits.span, kind: ExprKind::Record { ty: None, inits } })
            }
            Tok::Kw(Kw::Try) => {
                self.bump()?;
                let inner = self.postfix()?;
                let span = t.span.to(inner.span);
                Ok(Expr { kind: ExprKind::Try(Box::new(inner)), span })
            }
            Tok::Kw(Kw::Fn) => {
                self.bump()?;
                let open = self.expect(P::LParen)?;
                let params = self.group(open, P::RParen, |p| p.param(false))?;
                let ret = self.ret_type()?;
                let body = self.block(BlockKind::Lambda)?;
                let span = t.span.to(body.span);
                Ok(Expr { kind: ExprKind::Lambda(Lambda { params, ret, body }), span })
            }
            Tok::P(P::At) => {
                let call = self.view_call(true)?;
                Ok(Expr { span: call.span, kind: ExprKind::View(call) })
            }
            Tok::Kw(k) => Err(Diagnostic::error(
                codes::KEYWORD_AS_NAME,
                t.span,
                format!("`{}` is a keyword, so it can't start an expression here", k.word()),
            )),
            _ => Err(self.unexpected("an expression")),
        }
    }

    /// A text literal, with each hole read as an expression.
    pub(crate) fn text_lit(&mut self) -> R<TextLit> {
        let t = self.bump()?;
        let parts = text_parts(self.src, t.span.start as usize, t.span.end as usize)?;
        let mut out = Vec::new();
        for part in parts {
            match part {
                crate::lexer::TextPart::Piece(s) => out.push(TextPart::Piece { raw: self.text_of(s).to_string(), span: s }),
                crate::lexer::TextPart::Hole(s) => out.push(TextPart::Hole(self.hole(s)?)),
            }
        }
        Ok(TextLit { parts: out, span: t.span })
    }

    /// The one expression of a hole whose inside is `span`.
    pub(crate) fn hole(&mut self, span: Span) -> R<Expr> {
        let saved = self.save();
        self.seek(span.start as usize, span.end as usize);
        let result = (|| {
            let e = self.expr()?;
            if self.kind()? != Tok::Eof {
                let at = self.here()?;
                return Err(Diagnostic::error(
                    codes::HOLE_ONE_EXPR,
                    at,
                    "a hole holds one expression: `\\{a} \\{b}` puts two values in",
                ));
            }
            Ok(e)
        })();
        self.restore(saved);
        result
    }
}

/// A place is a name, `self` or `$state`, with fields and items after it.
fn is_place(e: &Expr) -> bool {
    match &e.kind {
        ExprKind::Name(_) | ExprKind::SelfValue | ExprKind::State => true,
        ExprKind::Field { target, .. } | ExprKind::Index { target, .. } => is_place(target),
        _ => false,
    }
}

pub(crate) fn column0(src: &str, offset: usize) -> usize {
    let start = src[..offset].rfind('\n').map(|k| k + 1).unwrap_or(0);
    src[start..offset].chars().count()
}

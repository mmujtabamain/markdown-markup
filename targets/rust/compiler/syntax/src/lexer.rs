//! The lexer for MKP code: names, capitals, keywords, numbers, durations, texts and symbols.
//!
//! Comments and line breaks are not thrown away: each token carries the trivia in front of it,
//! so the syntax tree can keep every comment and blank line for `mkp fmt`.

use crate::diag::{codes, Diagnostic};
use crate::span::Span;
use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kw {
    Package,
    Import,
    Enum,
    Record,
    Type,
    Interface,
    Implements,
    Widget,
    Extern,
    Expose,
    Fn,
    Pack,
    Tokens,
    Mut,
    Let,
    Event,
    Invoke,
    View,
    Markdown,
    Require,
    If,
    Else,
    For,
    In,
    Match,
    Case,
    Return,
    Only,
    Step,
    Void,
    Any,
    Param,
    Slot,
    Try,
    With,
    SelfKw,
    True,
    False,
    As,
    Token,
    State,
}

pub const KEYWORDS: &[(&str, Kw)] = &[
    ("package", Kw::Package),
    ("import", Kw::Import),
    ("enum", Kw::Enum),
    ("record", Kw::Record),
    ("type", Kw::Type),
    ("interface", Kw::Interface),
    ("implements", Kw::Implements),
    ("widget", Kw::Widget),
    ("extern", Kw::Extern),
    ("expose", Kw::Expose),
    ("fn", Kw::Fn),
    ("pack", Kw::Pack),
    ("tokens", Kw::Tokens),
    ("mut", Kw::Mut),
    ("let", Kw::Let),
    ("event", Kw::Event),
    ("invoke", Kw::Invoke),
    ("view", Kw::View),
    ("markdown", Kw::Markdown),
    ("require", Kw::Require),
    ("if", Kw::If),
    ("else", Kw::Else),
    ("for", Kw::For),
    ("in", Kw::In),
    ("match", Kw::Match),
    ("case", Kw::Case),
    ("return", Kw::Return),
    ("only", Kw::Only),
    ("step", Kw::Step),
    ("void", Kw::Void),
    ("any", Kw::Any),
    ("param", Kw::Param),
    ("slot", Kw::Slot),
    ("try", Kw::Try),
    ("with", Kw::With),
    ("self", Kw::SelfKw),
    ("true", Kw::True),
    ("false", Kw::False),
    ("as", Kw::As),
    ("token", Kw::Token),
    ("$state", Kw::State),
];

impl Kw {
    pub fn word(self) -> &'static str {
        KEYWORDS.iter().find(|(_, k)| *k == self).map(|(w, _)| *w).unwrap()
    }

    pub fn from_word(word: &str) -> Option<Kw> {
        KEYWORDS.iter().find(|(w, _)| *w == word).map(|(_, k)| *k)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize)]
pub enum P {
    LBrace,
    RBrace,
    LParen,
    RParen,
    LBracket,
    RBracket,
    Lt,
    Gt,
    Le,
    Ge,
    Comma,
    Semi,
    Colon,
    Dot,
    DotDot,
    DotDotDot,
    Eq,
    EqEq,
    NotEq,
    AndAnd,
    OrOr,
    Plus,
    Minus,
    Star,
    Slash,
    Percent,
    Bang,
    Question,
    At,
}

const PUNCT: &[(&str, P)] = &[
    ("...", P::DotDotDot),
    ("..", P::DotDot),
    ("==", P::EqEq),
    ("!=", P::NotEq),
    ("<=", P::Le),
    (">=", P::Ge),
    ("&&", P::AndAnd),
    ("||", P::OrOr),
    ("{", P::LBrace),
    ("}", P::RBrace),
    ("(", P::LParen),
    (")", P::RParen),
    ("[", P::LBracket),
    ("]", P::RBracket),
    ("<", P::Lt),
    (">", P::Gt),
    (",", P::Comma),
    (";", P::Semi),
    (":", P::Colon),
    (".", P::Dot),
    ("=", P::Eq),
    ("+", P::Plus),
    ("-", P::Minus),
    ("*", P::Star),
    ("/", P::Slash),
    ("%", P::Percent),
    ("!", P::Bang),
    ("?", P::Question),
    ("@", P::At),
];

impl P {
    pub fn text(self) -> &'static str {
        PUNCT.iter().find(|(_, p)| *p == self).map(|(t, _)| *t).unwrap()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum Tok {
    /// A small name: `name`, `text_size`.
    Name,
    /// Capitals: a case after a dot, or a type parameter on its own.
    Caps,
    Kw(Kw),
    Number,
    Duration,
    /// A text literal, quotes and holes included. Its parts are read by [`text_parts`].
    Text,
    P(P),
    Eof,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Comment {
    pub span: Span,
    pub text: String,
    /// Spaces and tabs between the code before it and the comment, on its own line.
    pub gap: u32,
}

impl Comment {
    pub fn is_doc(&self) -> bool {
        self.text.starts_with("//@")
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Trivia {
    /// That many line breaks.
    Newlines(u32),
    Comment(Comment),
}

#[derive(Clone, Debug)]
pub struct Token {
    pub kind: Tok,
    pub span: Span,
    /// Comments and line breaks between the token before and this one, in order.
    pub trivia: Vec<Trivia>,
}

impl Token {
    /// Whether a line break comes before this token.
    pub fn on_new_line(&self) -> bool {
        self.trivia.iter().any(|t| matches!(t, Trivia::Newlines(_)))
    }

    pub fn is(&self, p: P) -> bool {
        self.kind == Tok::P(p)
    }

    pub fn is_kw(&self, k: Kw) -> bool {
        self.kind == Tok::Kw(k)
    }
}

pub struct Lexer<'a> {
    pub src: &'a str,
    pub pos: usize,
    pub limit: usize,
}

fn is_small(c: u8) -> bool {
    c.is_ascii_lowercase()
}

fn word_char(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_'
}

impl<'a> Lexer<'a> {
    pub fn new(src: &'a str, pos: usize, limit: usize) -> Lexer<'a> {
        Lexer { src, pos, limit }
    }

    fn byte(&self, i: usize) -> Option<u8> {
        if i < self.limit {
            self.src.as_bytes().get(i).copied()
        } else {
            None
        }
    }

    fn starts(&self, at: usize, s: &str) -> bool {
        at + s.len() <= self.limit && self.src[at..].starts_with(s)
    }

    /// The trivia from here to the next token.
    fn trivia(&mut self) -> Result<Vec<Trivia>, Diagnostic> {
        let mut out = Vec::new();
        let mut gap = 0u32;
        loop {
            match self.byte(self.pos) {
                Some(b'\n') => {
                    match out.last_mut() {
                        Some(Trivia::Newlines(n)) => *n += 1,
                        _ => out.push(Trivia::Newlines(1)),
                    }
                    self.pos += 1;
                    gap = 0;
                }
                Some(b' ') | Some(b'\t') => {
                    self.pos += 1;
                    gap += 1;
                }
                Some(b'\r') => self.pos += 1,
                Some(b'/') if self.starts(self.pos, "//") => {
                    let start = self.pos;
                    let end = self.src[start..self.limit].find('\n').map(|k| start + k).unwrap_or(self.limit);
                    let text = self.src[start..end].trim_end().to_string();
                    if text.starts_with("//@") {
                        check_doc(&text, start)?;
                    }
                    out.push(Trivia::Comment(Comment { span: Span::new(start, start + text.len()), text, gap }));
                    self.pos = end;
                    gap = 0;
                }
                _ => return Ok(out),
            }
        }
    }

    pub fn next(&mut self) -> Result<Token, Diagnostic> {
        let trivia = self.trivia()?;
        let p = self.pos;
        let kind = match self.byte(p) {
            None => Tok::Eof,
            Some(c) if c.is_ascii_digit() => self.number(p)?,
            Some(c) if c.is_ascii_alphabetic() => self.word(p)?,
            Some(b'"') => {
                self.pos = text_end(self.src, p, self.limit)?;
                Tok::Text
            }
            Some(b'$') => {
                let mut e = p + 1;
                while self.byte(e).map_or(false, word_char) {
                    e += 1;
                }
                if &self.src[p..e] == "$state" {
                    self.pos = e;
                    Tok::Kw(Kw::State)
                } else {
                    let what = if e == p + 1 { "$ on its own".to_string() } else { format!("`{}`", &self.src[p..e]) };
                    return Err(Diagnostic::error(
                        codes::DOLLAR,
                        Span::new(p, e.max(p + 1)),
                        format!("{} is not a name: `$` starts only `$state`, the document's state; maths in code is a `latex` value, written as a text literal", what),
                    ));
                }
            }
            Some(b'#') => {
                let mut e = p + 1;
                while self.byte(e).map_or(false, word_char) {
                    e += 1;
                }
                return Err(Diagnostic::error(
                    codes::ATTRIBUTE,
                    Span::new(p, e),
                    format!("MKP has no attributes, so `{}` means nothing in code: a token type is declared with `token`, a widget is pointed at through a variable that holds it, and a widget's markdown block decides what it shows", &self.src[p..e]),
                ));
            }
            Some(_) => {
                let mut found = None;
                for (text, punct) in PUNCT {
                    if self.starts(p, text) {
                        found = Some((text.len(), *punct));
                        break;
                    }
                }
                match found {
                    Some((len, punct)) => {
                        self.pos = p + len;
                        Tok::P(punct)
                    }
                    None => {
                        let c = self.src[p..].chars().next().unwrap();
                        return Err(Diagnostic::error(
                            codes::UNEXPECTED_CHAR,
                            Span::new(p, p + c.len_utf8()),
                            format!("`{}` is not part of MKP's code", c),
                        ));
                    }
                }
            }
        };
        Ok(Token { kind, span: Span::new(p, self.pos), trivia })
    }

    fn digits(&self, mut e: usize) -> usize {
        while self.byte(e).map_or(false, |c| c.is_ascii_digit() || c == b'_') {
            e += 1;
        }
        e
    }

    fn number(&mut self, p: usize) -> Result<Tok, Diagnostic> {
        let mut e = self.digits(p);
        let mut kind = Tok::Number;
        if self.byte(e) == Some(b'.') && self.byte(e + 1).map_or(false, |c| c.is_ascii_digit()) {
            e = self.digits(e + 1);
        }
        let unit = if self.starts(e, "ms") { 2 } else if self.starts(e, "s") { 1 } else { 0 };
        if unit > 0 && !self.byte(e + unit).map_or(false, word_char) {
            e += unit;
            kind = Tok::Duration;
        } else if self.byte(e).map_or(false, |c| c.is_ascii_alphabetic() || c == b'_') {
            let mut w = e;
            while self.byte(w).map_or(false, word_char) {
                w += 1;
            }
            return Err(Diagnostic::error(
                codes::NUMBER_INTO_NAME,
                Span::new(p, w),
                format!("a number can't run into a name: `{}`", &self.src[p..w]),
            ));
        }
        self.pos = e;
        Ok(kind)
    }

    fn word(&mut self, p: usize) -> Result<Tok, Diagnostic> {
        let mut e = p;
        while self.byte(e).map_or(false, word_char) {
            e += 1;
        }
        self.pos = e;
        let w = &self.src[p..e];
        let b = w.as_bytes();
        if is_small(b[0]) && b.iter().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'_') {
            return Ok(match Kw::from_word(w) {
                Some(k) => Tok::Kw(k),
                None => Tok::Name,
            });
        }
        if b[0].is_ascii_uppercase() && b.iter().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || *c == b'_') {
            return Ok(Tok::Caps);
        }
        Err(Diagnostic::error(
            codes::MIXED_CASE,
            Span::new(p, e),
            format!("`{}` mixes small letters and capitals: a name is small letters, digits and `_`, and only a case or a type parameter is written in capitals", w),
        )
        .with_fix(w.to_lowercase()))
    }
}

fn check_doc(text: &str, start: usize) -> Result<(), Diagnostic> {
    for word in ["about", "param", "deprecated"] {
        if let Some(rest) = text.strip_prefix("//@").and_then(|t| t.strip_prefix(word)) {
            if rest.starts_with(' ') && !rest.trim().is_empty() {
                return Ok(());
            }
        }
    }
    Err(Diagnostic::error(
        codes::DOC_COMMENT,
        Span::new(start, start + text.len()),
        "a doc comment is `//@about`, `//@param` or `//@deprecated`, followed by its words",
    ))
}

/// One part of a text literal: characters written as they stand, or a hole's expression.
#[derive(Clone, Debug, PartialEq)]
pub enum TextPart {
    /// Source characters, escapes not yet decoded.
    Piece(Span),
    /// The expression inside `\{…}`.
    Hole(Span),
}

/// Where a text literal that opens at `p` ends (just after its closing quote).
pub fn text_end(src: &str, p: usize, limit: usize) -> Result<usize, Diagnostic> {
    let parts = text_scan(src, p, limit)?;
    Ok(parts.1)
}

/// The parts of the text literal that opens at `p`, and where it ends.
pub fn text_parts(src: &str, p: usize, limit: usize) -> Result<Vec<TextPart>, Diagnostic> {
    Ok(text_scan(src, p, limit)?.0)
}

fn text_scan(src: &str, p: usize, limit: usize) -> Result<(Vec<TextPart>, usize), Diagnostic> {
    let b = src.as_bytes();
    let mut parts = Vec::new();
    let mut i = p + 1;
    let mut piece = i;
    loop {
        if i >= limit || b[i] == b'\n' {
            return Err(Diagnostic::error(
                codes::TEXT_LINE,
                Span::new(p, i),
                "a text literal ends on the line it starts on: write `\\n` for a line break",
            ));
        }
        match b[i] {
            b'"' => break,
            b'\\' => {
                let n = b.get(i + 1).copied();
                match n {
                    Some(b'{') => {
                        if piece < i {
                            parts.push(TextPart::Piece(Span::new(piece, i)));
                        }
                        let end = hole_end(src, i + 2, limit, true)?;
                        parts.push(TextPart::Hole(Span::new(i + 2, end)));
                        i = end + 1;
                        piece = i;
                        continue;
                    }
                    Some(b'"') | Some(b'\\') | Some(b'n') | Some(b't') => i += 2,
                    Some(b'u') => {
                        let rest = &src[i + 2..limit.min(src.len())];
                        let ok = rest.starts_with('{')
                            && rest[1..].find('}').map_or(false, |k| {
                                k >= 1 && k <= 6 && rest[1..1 + k].bytes().all(|c| c.is_ascii_hexdigit())
                                    && u32::from_str_radix(&rest[1..1 + k], 16).ok().and_then(char::from_u32).is_some()
                            });
                        if !ok {
                            return Err(Diagnostic::error(
                                codes::BAD_UNICODE,
                                Span::new(i, i + 2),
                                "`\\u` takes a Unicode number in hex, in braces: `\\u{1F600}`",
                            ));
                        }
                        i += 2 + rest.find('}').unwrap() + 1;
                    }
                    _ => {
                        let c = src[i + 1..].chars().next().unwrap_or(' ');
                        return Err(Diagnostic::error(
                            codes::UNKNOWN_ESCAPE,
                            Span::new(i, i + 1 + c.len_utf8()),
                            format!("`\\{}` is not an escape in a text: the escapes are `\\\"`, `\\\\`, `\\n`, `\\t`, `\\u{{…}}` and the hole `\\{{…}}`", c),
                        ));
                    }
                }
            }
            _ => i += 1,
        }
    }
    if piece < i {
        parts.push(TextPart::Piece(Span::new(piece, i)));
    }
    Ok((parts, i + 1))
}

/// The offset of the `}` that closes a hole whose expression starts at `start`.
/// `one_line` says the hole has to end on the line it starts on.
pub fn hole_end(src: &str, start: usize, limit: usize, one_line: bool) -> Result<usize, Diagnostic> {
    let mut lx = Lexer::new(src, start, limit);
    let mut depth = 0u32;
    loop {
        let t = match lx.next() {
            Ok(t) => t,
            // a text that runs past the line inside a hole is the hole running past it
            Err(d) if one_line && d.code == codes::TEXT_LINE => {
                return Err(Diagnostic::error(
                    codes::HOLE_UNCLOSED,
                    Span::new(start - 2, start),
                    "this hole is not closed on its line: a hole is `\\{` and an expression, then `}`",
                ))
            }
            Err(d) => return Err(d),
        };
        if one_line && t.on_new_line() {
            return Err(Diagnostic::error(
                codes::HOLE_UNCLOSED,
                Span::new(start - 2, start),
                "this hole is not closed on its line: a hole is `\\{` and an expression, then `}`",
            ));
        }
        match t.kind {
            Tok::Eof => {
                return Err(Diagnostic::error(
                    codes::HOLE_UNCLOSED,
                    Span::new(start - 2, start),
                    "this hole is not closed: a hole is `\\{` and an expression, then `}`",
                ))
            }
            Tok::P(P::LBrace) => depth += 1,
            Tok::P(P::RBrace) => {
                if depth == 0 {
                    return Ok(t.span.start as usize);
                }
                depth -= 1;
            }
            _ => {}
        }
    }
}

/// The characters a text piece stands for, with its escapes decoded.
pub fn decode_piece(raw: &str) -> String {
    let mut out = String::new();
    let mut it = raw.chars().peekable();
    while let Some(c) = it.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match it.next() {
            Some('n') => out.push('\n'),
            Some('t') => out.push('\t'),
            Some('"') => out.push('"'),
            Some('\\') => out.push('\\'),
            Some('u') => {
                let mut hex = String::new();
                it.next();
                for h in it.by_ref() {
                    if h == '}' {
                        break;
                    }
                    hex.push(h);
                }
                if let Some(ch) = u32::from_str_radix(&hex, 16).ok().and_then(char::from_u32) {
                    out.push(ch);
                }
            }
            Some(other) => {
                out.push('\\');
                out.push(other);
            }
            None => out.push('\\'),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(src: &str) -> Vec<Tok> {
        let mut lx = Lexer::new(src, 0, src.len());
        let mut out = Vec::new();
        loop {
            let t = lx.next().unwrap();
            if t.kind == Tok::Eof {
                return out;
            }
            out.push(t.kind);
        }
    }

    #[test]
    fn ranges_numbers_and_durations() {
        assert_eq!(kinds("0..10"), vec![Tok::Number, Tok::P(P::DotDot), Tok::Number]);
        assert_eq!(kinds("1..."), vec![Tok::Number, Tok::P(P::DotDotDot)]);
        assert_eq!(kinds("0.25..16"), vec![Tok::Number, Tok::P(P::DotDot), Tok::Number]);
        assert_eq!(kinds("250ms 2s"), vec![Tok::Duration, Tok::Duration]);
    }

    #[test]
    fn state_and_dollars() {
        assert_eq!(kinds("$state.x"), vec![Tok::Kw(Kw::State), Tok::P(P::Dot), Tok::Name]);
        let mut lx = Lexer::new("$abc", 0, 4);
        assert_eq!(lx.next().unwrap_err().code, codes::DOLLAR);
    }

    #[test]
    fn text_with_holes() {
        let src = r#""a \{x.join(", ")} b""#;
        let parts = text_parts(src, 0, src.len()).unwrap();
        assert_eq!(parts.len(), 3);
        assert_eq!(text_end(src, 0, src.len()).unwrap(), src.len());
    }

    #[test]
    fn comments_are_kept() {
        let src = "a // one\n\n// two\nb";
        let mut lx = Lexer::new(src, 0, src.len());
        lx.next().unwrap();
        let b = lx.next().unwrap();
        assert_eq!(b.trivia.len(), 4);
    }
}

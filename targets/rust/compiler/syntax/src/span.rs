//! Byte spans into a source text, and the line and column a span starts at.

use serde::Serialize;

/// A range of bytes in one source text.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize)]
pub struct Span {
    pub start: u32,
    pub end: u32,
}

impl Span {
    pub fn new(start: usize, end: usize) -> Span {
        Span { start: start as u32, end: end as u32 }
    }

    pub fn at(pos: usize) -> Span {
        Span::new(pos, pos)
    }

    pub fn to(self, other: Span) -> Span {
        Span { start: self.start.min(other.start), end: self.end.max(other.end) }
    }

    pub fn range(self) -> std::ops::Range<usize> {
        self.start as usize..self.end as usize
    }
}

/// A place a reader can find: a line and a column, both counted from 1, the column in characters.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct Place {
    pub line: u32,
    pub column: u32,
}

/// Where each line of a text starts, to turn byte offsets into lines and columns.
pub struct Lines<'a> {
    src: &'a str,
    starts: Vec<usize>,
}

impl<'a> Lines<'a> {
    pub fn new(src: &'a str) -> Lines<'a> {
        let mut starts = vec![0];
        for (i, b) in src.bytes().enumerate() {
            if b == b'\n' {
                starts.push(i + 1);
            }
        }
        Lines { src, starts }
    }

    pub fn place(&self, offset: u32) -> Place {
        let offset = (offset as usize).min(self.src.len());
        let line = match self.starts.binary_search(&offset) {
            Ok(k) => k,
            Err(k) => k - 1,
        };
        let start = self.starts[line];
        let column = self.src[start..offset].chars().count() + 1;
        Place { line: line as u32 + 1, column: column as u32 }
    }

    /// The column a byte offset sits at, counted from 0, in characters.
    pub fn column0(&self, offset: usize) -> usize {
        self.place(offset as u32).column as usize - 1
    }
}

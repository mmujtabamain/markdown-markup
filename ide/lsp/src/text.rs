//! Places in a text, as the protocol counts them and as xtmd does. The protocol's positions are a
//! line from 0 and a character from 0 in UTF-16 code units; xtmd's diagnostics count a line and a
//! column from 1 in characters; the resolved IR's spans are UTF-8 byte offsets.

use serde_json::{json, Value};

/// A text's lines, for turning one kind of place into another.
pub struct Text<'a> {
    src: &'a str,
    /// The byte offset each line starts at.
    starts: Vec<usize>,
}

impl<'a> Text<'a> {
    pub fn new(src: &'a str) -> Text<'a> {
        let mut starts = vec![0];
        for (k, b) in src.bytes().enumerate() {
            if b == b'\n' {
                starts.push(k + 1);
            }
        }
        Text { src, starts }
    }

    fn line_text(&self, line: usize) -> &'a str {
        let start = self.starts[line.min(self.starts.len() - 1)];
        let end = self.starts.get(line + 1).map_or(self.src.len(), |e| e - 1);
        &self.src[start..end.max(start)]
    }

    /// The protocol's position of a byte offset.
    pub fn position(&self, offset: usize) -> Value {
        let offset = offset.min(self.src.len());
        let line = match self.starts.binary_search(&offset) {
            Ok(k) => k,
            Err(k) => k - 1,
        };
        let start = self.starts[line];
        let character: usize = self.src[start..floor_char(self.src, offset)].chars().map(char::len_utf16).sum();
        json!({ "line": line, "character": character })
    }

    /// A span's range, from byte offsets.
    pub fn range(&self, start: usize, end: usize) -> Value {
        json!({ "start": self.position(start), "end": self.position(end) })
    }

    /// The byte offset of a protocol position: past the end of its line, the line's end.
    pub fn offset(&self, position: &Value) -> usize {
        let line = position["line"].as_u64().unwrap_or(0) as usize;
        if line >= self.starts.len() {
            return self.src.len();
        }
        let want = position["character"].as_u64().unwrap_or(0) as usize;
        let text = self.line_text(line);
        let (mut units, mut bytes) = (0, 0);
        for c in text.chars() {
            if units >= want {
                break;
            }
            units += c.len_utf16();
            bytes += c.len_utf8();
        }
        self.starts[line] + bytes
    }

    /// The protocol's position of xtmd's line and column, both from 1, the column in characters.
    pub fn from_xtmd(&self, line: u32, column: u32) -> Value {
        let l = (line.max(1) - 1) as usize;
        let text = self.line_text(l);
        let character: usize = text.chars().take((column.max(1) - 1) as usize).map(char::len_utf16).sum();
        json!({ "line": l, "character": character })
    }
}

fn floor_char(s: &str, mut k: usize) -> usize {
    while k > 0 && !s.is_char_boundary(k) {
        k -= 1;
    }
    k
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn positions_count_utf16_and_offsets_bytes() {
        // é is two bytes and one unit; 🙂 four bytes and two units
        let t = Text::new("ab\né🙂x\n");
        assert_eq!(t.position(0), json!({ "line": 0, "character": 0 }));
        assert_eq!(t.position(3), json!({ "line": 1, "character": 0 }));
        let x = "ab\né🙂x\n".find('x').unwrap();
        assert_eq!(t.position(x), json!({ "line": 1, "character": 3 }));
        assert_eq!(t.offset(&json!({ "line": 1, "character": 3 })), x);
        // xtmd's column 3 is the third character of the line: x
        assert_eq!(t.from_xtmd(2, 3), json!({ "line": 1, "character": 3 }));
        // past the end of a line, its end; past the last line, the text's end
        assert_eq!(t.offset(&json!({ "line": 0, "character": 99 })), 2);
        assert_eq!(t.offset(&json!({ "line": 9, "character": 0 })), "ab\né🙂x\n".len());
    }
}

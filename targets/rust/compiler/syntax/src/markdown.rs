//! Markdown's block structure: CommonMark, with GitHub's tables, task list items and
//! footnotes. The compiler splits prose into blocks here; what is inside a paragraph, a
//! heading or a table cell is left as its source, for core's `rich_text.from` to read.
//!
//! This follows CommonMark's own parsing strategy (the spec's appendix): each line first
//! continues the open blocks it can, then may start new ones, and what is left is text.
//! Holes reach it as private-use characters, so a hole never starts or ends a block.

#[derive(Clone, Debug, PartialEq)]
pub enum MdBlock {
    /// Inline source, its lines joined by `\n`.
    Paragraph(String),
    Heading { level: u8, text: String },
    Bullets { ordered: bool, start: u64, tight: bool, items: Vec<MdItem> },
    Quote(Vec<MdBlock>),
    Code { lang: String, src: String },
    /// A raw HTML block, which Extended Mark shows as text.
    Html(String),
    Table { align: Vec<Align>, head: Vec<String>, rows: Vec<Vec<String>> },
    Footnote { mark: String, blocks: Vec<MdBlock> },
    Divider,
}

#[derive(Clone, Debug, PartialEq)]
pub struct MdItem {
    /// A task box: ticked, not ticked, or none.
    pub done: Option<bool>,
    pub blocks: Vec<MdBlock>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Align {
    None,
    Start,
    Center,
    End,
}

/// A link reference definition: `[label]: destination "title"`.
#[derive(Clone, Debug, PartialEq)]
pub struct LinkDef {
    pub label: String,
    pub dest: String,
    pub title: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct MdDoc {
    pub blocks: Vec<MdBlock>,
    pub links: Vec<LinkDef>,
}

#[derive(Clone, Debug, PartialEq)]
enum Kind {
    Document,
    Quote,
    List { ordered: bool, start: u64, bullet: char, delim: char, tight: bool },
    Item { marker_offset: usize, padding: usize, done: Option<bool> },
    Footnote { label: String },
    Paragraph,
    Heading { level: u8, setext: bool },
    Thematic,
    Code { fenced: bool, fence_char: char, fence_len: usize, fence_offset: usize, info: String },
    Html { kind: u8 },
    Table { align: Vec<Align>, head: Vec<String>, rows: Vec<Vec<String>> },
}

struct Node {
    kind: Kind,
    open: bool,
    children: Vec<usize>,
    parent: Option<usize>,
    content: String,
    last_line_blank: bool,
    start_line: usize,
}

struct Parser {
    nodes: Vec<Node>,
    tip: usize,
    old_tip: usize,
    line: Vec<char>,
    line_no: usize,
    offset: usize,
    column: usize,
    next_nonspace: usize,
    next_nonspace_column: usize,
    indent: usize,
    indented: bool,
    blank: bool,
    partially_consumed_tab: bool,
    all_closed: bool,
    last_matched: usize,
    links: Vec<LinkDef>,
}

const CODE_INDENT: usize = 4;

fn is_space_or_tab(c: Option<char>) -> bool {
    matches!(c, Some(' ') | Some('\t'))
}

impl Parser {
    fn new() -> Parser {
        let doc = Node { kind: Kind::Document, open: true, children: Vec::new(), parent: None, content: String::new(), last_line_blank: false, start_line: 0 };
        Parser {
            nodes: vec![doc],
            tip: 0,
            old_tip: 0,
            line: Vec::new(),
            line_no: 0,
            offset: 0,
            column: 0,
            next_nonspace: 0,
            next_nonspace_column: 0,
            indent: 0,
            indented: false,
            blank: false,
            partially_consumed_tab: false,
            all_closed: true,
            last_matched: 0,
            links: Vec::new(),
        }
    }

    fn peek(&self, at: usize) -> Option<char> {
        self.line.get(at).copied()
    }

    fn rest(&self, from: usize) -> String {
        self.line[from.min(self.line.len())..].iter().collect()
    }

    fn find_next_nonspace(&mut self) {
        let mut i = self.offset;
        let mut cols = self.column;
        while let Some(c) = self.peek(i) {
            if c == ' ' {
                i += 1;
                cols += 1;
            } else if c == '\t' {
                i += 1;
                cols += 4 - (cols % 4);
            } else {
                break;
            }
        }
        self.blank = matches!(self.peek(i), None | Some('\n') | Some('\r'));
        self.next_nonspace = i;
        self.next_nonspace_column = cols;
        self.indent = self.next_nonspace_column - self.column;
        self.indented = self.indent >= CODE_INDENT;
    }

    fn advance_next_nonspace(&mut self) {
        self.offset = self.next_nonspace;
        self.column = self.next_nonspace_column;
        self.partially_consumed_tab = false;
    }

    fn advance_offset(&mut self, mut count: usize, columns: bool) {
        while count > 0 {
            let Some(c) = self.peek(self.offset) else { break };
            if c == '\t' {
                let chars_to_tab = 4 - (self.column % 4);
                if columns {
                    self.partially_consumed_tab = chars_to_tab > count;
                    let advance = chars_to_tab.min(count);
                    self.column += advance;
                    if !self.partially_consumed_tab {
                        self.offset += 1;
                    }
                    count -= advance;
                } else {
                    self.partially_consumed_tab = false;
                    self.column += chars_to_tab;
                    self.offset += 1;
                    count -= 1;
                }
            } else {
                self.partially_consumed_tab = false;
                self.offset += 1;
                self.column += 1;
                count -= 1;
            }
        }
    }

    fn add_line(&mut self) {
        let mut s = String::new();
        if self.partially_consumed_tab {
            self.offset += 1;
            let chars_to_tab = 4 - (self.column % 4);
            for _ in 0..chars_to_tab {
                s.push(' ');
            }
        }
        s.push_str(&self.rest(self.offset));
        s.push('\n');
        self.nodes[self.tip].content.push_str(&s);
    }

    fn add_child(&mut self, kind: Kind, offset: usize) -> usize {
        let _ = offset;
        while !self.can_contain(self.tip, &kind) {
            self.finalize(self.tip);
        }
        let id = self.nodes.len();
        self.nodes.push(Node { kind, open: true, children: Vec::new(), parent: Some(self.tip), content: String::new(), last_line_blank: false, start_line: self.line_no });
        self.nodes[self.tip].children.push(id);
        self.tip = id;
        id
    }

    fn can_contain(&self, parent: usize, child: &Kind) -> bool {
        match &self.nodes[parent].kind {
            Kind::Document | Kind::Quote | Kind::Item { .. } | Kind::Footnote { .. } => !matches!(child, Kind::Item { .. }),
            Kind::List { .. } => matches!(child, Kind::Item { .. }),
            _ => false,
        }
    }

    fn accepts_lines(&self, n: usize) -> bool {
        matches!(self.nodes[n].kind, Kind::Paragraph | Kind::Code { .. } | Kind::Html { .. })
    }

    fn close_unmatched(&mut self) {
        if !self.all_closed {
            while self.old_tip != self.last_matched {
                let parent = self.nodes[self.old_tip].parent.unwrap();
                self.finalize(self.old_tip);
                self.old_tip = parent;
            }
            self.all_closed = true;
        }
    }

    fn last_child(&self, n: usize) -> Option<usize> {
        self.nodes[n].children.last().copied()
    }

    /// 0: matched, 1: not matched, 2: the line is done (a closing fence).
    fn continues(&mut self, n: usize) -> u8 {
        match self.nodes[n].kind.clone() {
            Kind::Document | Kind::List { .. } => 0,
            Kind::Quote => {
                if !self.indented && self.peek(self.next_nonspace) == Some('>') {
                    self.advance_next_nonspace();
                    self.advance_offset(1, false);
                    if is_space_or_tab(self.peek(self.offset)) {
                        self.advance_offset(1, true);
                    }
                    0
                } else {
                    1
                }
            }
            Kind::Item { marker_offset, padding, .. } => {
                if self.blank {
                    if self.nodes[n].children.is_empty() {
                        1
                    } else {
                        self.advance_next_nonspace();
                        0
                    }
                } else if self.indent >= marker_offset + padding {
                    self.advance_offset(marker_offset + padding, true);
                    0
                } else {
                    1
                }
            }
            Kind::Footnote { .. } => {
                if self.blank {
                    self.advance_next_nonspace();
                    0
                } else if self.indent >= 4 {
                    self.advance_offset(4, true);
                    0
                } else {
                    1
                }
            }
            Kind::Heading { .. } | Kind::Thematic => 1,
            Kind::Code { fenced: true, fence_char, fence_len, fence_offset, .. } => {
                let rest = self.rest(self.next_nonspace);
                let run = rest.chars().take_while(|c| *c == fence_char).count();
                if self.indent <= 3 && run >= fence_len && rest[run * fence_char.len_utf8()..].trim().is_empty() && run > 0 {
                    self.finalize(n);
                    return 2;
                }
                let mut i = fence_offset;
                while i > 0 && is_space_or_tab(self.peek(self.offset)) {
                    self.advance_offset(1, true);
                    i -= 1;
                }
                0
            }
            Kind::Code { fenced: false, .. } => {
                if self.indent >= CODE_INDENT {
                    self.advance_offset(CODE_INDENT, true);
                    0
                } else if self.blank {
                    self.advance_next_nonspace();
                    0
                } else {
                    1
                }
            }
            Kind::Html { kind } => {
                if self.blank && (kind == 6 || kind == 7) {
                    1
                } else {
                    0
                }
            }
            Kind::Paragraph => {
                if self.blank {
                    1
                } else {
                    0
                }
            }
            Kind::Table { .. } => {
                if self.blank {
                    return 1;
                }
                0
            }
        }
    }

    fn incorporate(&mut self, ln: &str) {
        self.line = ln.chars().collect();
        self.line_no += 1;
        self.offset = 0;
        self.column = 0;
        self.blank = false;
        self.partially_consumed_tab = false;
        self.old_tip = self.tip;
        let mut container = 0;
        loop {
            let Some(last) = self.last_child(container) else { break };
            if !self.nodes[last].open {
                break;
            }
            container = last;
            self.find_next_nonspace();
            match self.continues(container) {
                0 => {}
                1 => {
                    container = self.nodes[container].parent.unwrap();
                    break;
                }
                _ => return,
            }
        }
        self.all_closed = container == self.old_tip;
        self.last_matched = container;
        let mut matched_leaf = !matches!(self.nodes[container].kind, Kind::Paragraph) && self.accepts_lines(container);
        // a table takes its rows
        if let Kind::Table { .. } = self.nodes[container].kind {
            matched_leaf = true;
        }
        while !matched_leaf {
            self.find_next_nonspace();
            let maybe_special = matches!(self.peek(self.next_nonspace), Some('#' | '`' | '~' | '*' | '+' | '_' | '=' | '<' | '>' | '-' | '[' | '|' | ':') | Some('0'..='9'));
            if !self.indented && !maybe_special {
                self.advance_next_nonspace();
                break;
            }
            match self.block_start(container) {
                0 => {
                    self.advance_next_nonspace();
                    break;
                }
                1 => container = self.tip,
                _ => {
                    container = self.tip;
                    matched_leaf = true;
                }
            }
        }
        // a table row; the delimiter row that made the table is no row
        if let Kind::Table { .. } = self.nodes[container].kind.clone() {
            if self.offset >= self.line.len() && !self.blank {
                return;
            }
            // another block's start ends the table
            self.find_next_nonspace();
            let rest = self.rest(self.next_nonspace);
            if !self.blank && !self.indented && (rest.starts_with('>') || rest.starts_with('#') || rest.starts_with("```") || rest.starts_with("~~~") || is_thematic(&rest)) {
                self.finalize(container);
                self.incorporate_rest(container);
                return;
            }
            if self.all_closed || matches!(self.nodes[self.tip].kind, Kind::Table { .. }) {
                if !self.blank {
                    let row = split_row(&self.rest(self.offset));
                    if let Kind::Table { head, rows, .. } = &mut self.nodes[container].kind {
                        let n = head.len();
                        let mut r = row;
                        r.resize(n, String::new());
                        rows.push(r);
                    }
                    return;
                }
            }
        }
        if !self.all_closed && !self.blank && matches!(self.nodes[self.tip].kind, Kind::Paragraph) {
            // a lazy continuation line
            self.add_line();
        } else {
            self.close_unmatched();
            if self.blank {
                if let Some(last) = self.last_child(container) {
                    self.nodes[last].last_line_blank = true;
                }
            }
            let t = self.nodes[container].kind.clone();
            let last_line_blank = self.blank
                && !(matches!(t, Kind::Quote) || matches!(t, Kind::Code { fenced: true, .. }) || (matches!(t, Kind::Item { .. }) && self.nodes[container].children.is_empty() && self.nodes[container].start_line == self.line_no));
            let mut cont = Some(container);
            while let Some(c) = cont {
                self.nodes[c].last_line_blank = last_line_blank;
                cont = self.nodes[c].parent;
                if cont.is_some() && !matches!(self.nodes[cont.unwrap()].kind, Kind::Item { .. } | Kind::List { .. } | Kind::Quote | Kind::Document | Kind::Footnote { .. }) {
                    break;
                }
                // only the container itself and its ancestors through lists matter here
                break;
            }
            if self.accepts_lines(container) {
                self.add_line();
                if let Kind::Html { kind } = t {
                    if (1..=5).contains(&kind) && html_end(kind, &self.rest(self.offset)) {
                        self.finalize(container);
                    }
                }
            } else if self.offset < self.line.len() && !self.blank {
                self.add_child(Kind::Paragraph, self.offset);
                self.advance_next_nonspace();
                self.add_line();
            }
        }
    }

    /// The line again, once the table it would have joined is closed.
    fn incorporate_rest(&mut self, _table: usize) {
        let line: String = self.line.iter().collect();
        self.line_no -= 1;
        self.incorporate(&line);
    }

    /// 0: no block starts here, 1: a container started, 2: a leaf started.
    fn block_start(&mut self, container: usize) -> u8 {
        let c = self.peek(self.next_nonspace);
        let rest = self.rest(self.next_nonspace);
        // block quote
        if !self.indented && c == Some('>') {
            self.advance_next_nonspace();
            self.advance_offset(1, false);
            if is_space_or_tab(self.peek(self.offset)) {
                self.advance_offset(1, true);
            }
            self.close_unmatched();
            self.add_child(Kind::Quote, self.next_nonspace);
            return 1;
        }
        // ATX heading
        if !self.indented && c == Some('#') {
            let hashes = rest.chars().take_while(|c| *c == '#').count();
            let after = rest.chars().nth(hashes);
            if (1..=6).contains(&hashes) && matches!(after, None | Some(' ') | Some('\t')) {
                self.advance_next_nonspace();
                self.advance_offset(hashes, false);
                self.close_unmatched();
                let mut text = self.rest(self.offset).trim().to_string();
                // a closing sequence of #s, after a space
                let stripped = text.trim_end_matches('#');
                if stripped.is_empty() {
                    text = String::new();
                } else if stripped.ends_with(' ') || stripped.ends_with('\t') {
                    text = stripped.trim_end().to_string();
                }
                let h = self.add_child(Kind::Heading { level: hashes as u8, setext: false }, self.next_nonspace);
                self.nodes[h].content = text;
                self.advance_offset(self.line.len() - self.offset, false);
                return 2;
            }
        }
        // fenced code
        if !self.indented && matches!(c, Some('`') | Some('~')) {
            let ch = c.unwrap();
            let run = rest.chars().take_while(|x| *x == ch).count();
            let info: String = rest.chars().skip(run).collect();
            if run >= 3 && !(ch == '`' && info.contains('`')) {
                self.close_unmatched();
                let fence_offset = self.indent;
                self.add_child(Kind::Code { fenced: true, fence_char: ch, fence_len: run, fence_offset, info: unescape_info(info.trim()) }, self.next_nonspace);
                self.advance_next_nonspace();
                self.advance_offset(run, false);
                self.advance_offset(self.line.len() - self.offset, false);
                return 2;
            }
        }
        // HTML block
        if !self.indented && c == Some('<') {
            for kind in 1..=7u8 {
                if html_start(kind, &rest) && (kind < 7 || (!matches!(self.nodes[container].kind, Kind::Paragraph) && !(!self.all_closed && !self.blank && matches!(self.nodes[self.tip].kind, Kind::Paragraph)))) {
                    self.close_unmatched();
                    self.add_child(Kind::Html { kind }, self.offset);
                    return 2;
                }
            }
        }
        // setext heading underline
        if !self.indented && matches!(self.nodes[container].kind, Kind::Paragraph) && matches!(c, Some('=') | Some('-')) {
            let ch = c.unwrap();
            let t = rest.trim_end();
            if !t.is_empty() && t.chars().all(|x| x == ch) {
                self.close_unmatched();
                // link reference definitions at the paragraph's start are taken out first
                let content = self.nodes[container].content.clone();
                let left = self.take_link_defs(&content);
                if !left.trim().is_empty() {
                    self.nodes[container].kind = Kind::Heading { level: if ch == '=' { 1 } else { 2 }, setext: true };
                    self.nodes[container].content = left.trim_end().to_string();
                    self.advance_offset(self.line.len() - self.offset, false);
                    return 2;
                }
                self.nodes[container].content = left;
            }
        }
        // thematic break
        if !self.indented && matches!(c, Some('*') | Some('-') | Some('_')) && is_thematic(&rest) {
            self.close_unmatched();
            self.add_child(Kind::Thematic, self.next_nonspace);
            self.advance_offset(self.line.len() - self.offset, false);
            return 2;
        }
        // a table's delimiter row, under a one-line paragraph
        if !self.indented && matches!(self.nodes[container].kind, Kind::Paragraph) {
            let content = self.nodes[container].content.clone();
            let lines: Vec<&str> = content.trim_end_matches('\n').split('\n').collect();
            if lines.len() == 1 {
                if let Some(align) = delimiter_row(&rest) {
                    let head = split_row(lines[0]);
                    if head.len() == align.len() {
                        self.close_unmatched();
                        self.nodes[container].kind = Kind::Table { align, head, rows: Vec::new() };
                        self.nodes[container].content.clear();
                        self.advance_offset(self.line.len() - self.offset, false);
                        return 2;
                    }
                }
            }
        }
        // footnote definition
        if !self.indented && c == Some('[') && rest.starts_with("[^") {
            if let Some(close) = rest.find("]:") {
                let label = &rest[2..close];
                if !label.is_empty() && !label.contains(char::is_whitespace) && !label.contains(']') {
                    self.close_unmatched();
                    self.add_child(Kind::Footnote { label: label.to_string() }, self.next_nonspace);
                    self.advance_next_nonspace();
                    self.advance_offset(close + 2, false);
                    if is_space_or_tab(self.peek(self.offset)) {
                        self.advance_offset(1, true);
                    }
                    return 1;
                }
            }
        }
        // list item
        if let Some((ordered, start, bullet, delim, marker_len)) = self.list_marker(container) {
            let in_paragraph = matches!(self.nodes[container].kind, Kind::Paragraph);
            self.advance_next_nonspace();
            let marker_offset = self.indent;
            self.advance_offset(marker_len, true);
            let spaces_start_col = self.column;
            let spaces_start_offset = self.offset;
            loop {
                self.advance_offset(1, true);
                let n = self.peek(self.offset);
                if !(self.column - spaces_start_col < 5 && is_space_or_tab(n)) {
                    break;
                }
            }
            let blank_item = self.peek(self.offset).is_none();
            let spaces_after = self.column - spaces_start_col;
            let padding;
            if spaces_after >= 5 || spaces_after < 1 || blank_item {
                padding = marker_len + 1;
                self.column = spaces_start_col;
                self.offset = spaces_start_offset;
                if is_space_or_tab(self.peek(self.offset)) {
                    self.advance_offset(1, true);
                }
            } else {
                padding = marker_len + spaces_after;
            }
            let _ = in_paragraph;
            self.close_unmatched();
            // a new list when the open one is of another kind
            let same = match &self.nodes[self.tip].kind {
                Kind::List { ordered: o, bullet: b, delim: d, .. } => *o == ordered && (if ordered { *d == delim } else { *b == bullet }),
                _ => false,
            };
            if !same {
                self.add_child(Kind::List { ordered, start, bullet, delim, tight: true }, self.next_nonspace);
            }
            // a task box at the start of the item
            let mut done = None;
            let after = self.rest(self.offset);
            if after.len() >= 3 && (after.starts_with("[ ]") || after.starts_with("[x]") || after.starts_with("[X]")) && matches!(after.chars().nth(3), Some(' ') | Some('\t')) {
                done = Some(!after.starts_with("[ ]"));
                self.advance_offset(4, false);
            }
            self.add_child(Kind::Item { marker_offset, padding, done }, self.next_nonspace);
            return 1;
        }
        // indented code
        if self.indented && !matches!(self.nodes[self.tip].kind, Kind::Paragraph) && !self.blank {
            self.advance_offset(CODE_INDENT, true);
            self.close_unmatched();
            self.add_child(Kind::Code { fenced: false, fence_char: ' ', fence_len: 0, fence_offset: 0, info: String::new() }, self.offset);
            return 2;
        }
        0
    }

    /// A list marker at the next non-space: (ordered, start, bullet, delimiter, its length).
    fn list_marker(&self, container: usize) -> Option<(bool, u64, char, char, usize)> {
        if self.indent >= 4 {
            return None;
        }
        let rest = self.rest(self.next_nonspace);
        let in_para = matches!(self.nodes[container].kind, Kind::Paragraph);
        let first = rest.chars().next()?;
        let (ordered, start, bullet, delim, len) = if matches!(first, '*' | '+' | '-') {
            (false, 1, first, ' ', 1)
        } else {
            let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
            if digits.is_empty() || digits.len() > 9 {
                return None;
            }
            let d = rest.chars().nth(digits.len())?;
            if d != '.' && d != ')' {
                return None;
            }
            if in_para && digits != "1" {
                return None;
            }
            (true, digits.parse().unwrap_or(1), ' ', d, digits.len() + 1)
        };
        let after = rest.chars().nth(len);
        if !matches!(after, None | Some(' ') | Some('\t')) {
            return None;
        }
        if in_para && rest.chars().skip(len).all(|c| c == ' ' || c == '\t') {
            // an empty item can't interrupt a paragraph
            return None;
        }
        if !ordered && matches!(first, '*' | '-') && is_thematic(&rest) {
            return None;
        }
        Some((ordered, start, bullet, delim, len))
    }

    fn finalize(&mut self, n: usize) {
        let above = self.nodes[n].parent;
        self.nodes[n].open = false;
        match self.nodes[n].kind.clone() {
            Kind::Paragraph => {
                let content = self.nodes[n].content.clone();
                let left = self.take_link_defs(&content);
                self.nodes[n].content = left;
            }
            Kind::Code { fenced: true, .. } => {
                // the first line was the info string, kept on the node
                let content = self.nodes[n].content.clone();
                let body = match content.find('\n') {
                    Some(k) => content[k + 1..].to_string(),
                    None => String::new(),
                };
                self.nodes[n].content = body;
            }
            Kind::Code { fenced: false, .. } => {
                let mut lines: Vec<String> = self.nodes[n].content.split('\n').map(|s| s.to_string()).collect();
                while lines.last().map_or(false, |l| l.trim().is_empty()) {
                    lines.pop();
                }
                let mut s = lines.join("\n");
                s.push('\n');
                self.nodes[n].content = s;
            }
            Kind::List { .. } => {
                let tight = self.list_is_tight(n);
                if let Kind::List { tight: t, .. } = &mut self.nodes[n].kind {
                    *t = tight;
                }
            }
            _ => {}
        }
        self.tip = above.unwrap_or(0);
    }

    fn ends_with_blank(&self, n: usize) -> bool {
        let mut b = n;
        loop {
            if self.nodes[b].last_line_blank {
                return true;
            }
            match &self.nodes[b].kind {
                Kind::List { .. } | Kind::Item { .. } => match self.nodes[b].children.last() {
                    Some(c) => b = *c,
                    None => return false,
                },
                _ => return false,
            }
        }
    }

    fn list_is_tight(&self, list: usize) -> bool {
        let items = &self.nodes[list].children;
        for (k, item) in items.iter().enumerate() {
            if self.ends_with_blank(*item) && k + 1 < items.len() {
                return false;
            }
            let kids = &self.nodes[*item].children;
            for (j, sub) in kids.iter().enumerate() {
                if self.ends_with_blank(*sub) && (k + 1 < items.len() || j + 1 < kids.len()) {
                    return false;
                }
            }
        }
        true
    }

    /// Takes the link reference definitions off the start of a paragraph's text.
    fn take_link_defs(&mut self, content: &str) -> String {
        let mut s = content;
        while s.starts_with('[') {
            match link_def(s) {
                Some((def, used)) => {
                    let key = normalize_label(&def.label);
                    if !self.links.iter().any(|l| normalize_label(&l.label) == key) {
                        self.links.push(def);
                    }
                    s = &s[used..];
                }
                None => break,
            }
        }
        s.to_string()
    }

    fn to_blocks(&self, n: usize) -> Vec<MdBlock> {
        let mut out = Vec::new();
        for c in &self.nodes[n].children {
            if let Some(b) = self.to_block(*c) {
                out.push(b);
            }
        }
        out
    }

    fn to_block(&self, n: usize) -> Option<MdBlock> {
        let node = &self.nodes[n];
        Some(match &node.kind {
            Kind::Paragraph => {
                let text = paragraph_text(&node.content);
                if text.is_empty() {
                    return None;
                }
                MdBlock::Paragraph(text)
            }
            Kind::Heading { level, setext } => MdBlock::Heading { level: *level, text: if *setext { paragraph_text(&node.content) } else { node.content.trim().to_string() } },
            Kind::Thematic => MdBlock::Divider,
            Kind::Code { info, .. } => MdBlock::Code { lang: info.split_whitespace().next().unwrap_or("").to_string(), src: node.content.clone() },
            Kind::Html { .. } => MdBlock::Html(node.content.trim_end_matches('\n').to_string()),
            Kind::Quote => MdBlock::Quote(self.to_blocks(n)),
            Kind::List { ordered, start, tight, .. } => MdBlock::Bullets {
                ordered: *ordered,
                start: *start,
                tight: *tight,
                items: node
                    .children
                    .iter()
                    .map(|i| MdItem { done: if let Kind::Item { done, .. } = &self.nodes[*i].kind { *done } else { None }, blocks: self.to_blocks(*i) })
                    .collect(),
            },
            Kind::Footnote { label } => MdBlock::Footnote { mark: label.clone(), blocks: self.to_blocks(n) },
            Kind::Table { align, head, rows } => MdBlock::Table { align: align.clone(), head: head.clone(), rows: rows.clone() },
            Kind::Item { .. } | Kind::Document => return None,
        })
    }
}

/// A paragraph's text: its lines with their leading spaces taken off, and the last line's
/// trailing spaces too.
fn paragraph_text(content: &str) -> String {
    let lines: Vec<&str> = content.trim_end_matches('\n').split('\n').map(|l| l.trim_start_matches([' ', '\t'])).collect();
    let mut s = lines.join("\n");
    while s.ends_with(' ') || s.ends_with('\t') {
        s.pop();
    }
    s
}

fn unescape_info(s: &str) -> String {
    unescape(s)
}

/// Backslash escapes and character references worked out in one pass, as CommonMark does in
/// destinations, titles and info strings.
pub fn unescape(s: &str) -> String {
    let b: Vec<char> = s.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < b.len() {
        let c = b[i];
        if c == '\\' && i + 1 < b.len() && b[i + 1].is_ascii_punctuation() {
            out.push(b[i + 1]);
            i += 2;
            continue;
        }
        if c == '&' {
            if let Some((text, used)) = entity_at(&b[i..]) {
                out.push_str(&text);
                i += used;
                continue;
            }
        }
        out.push(c);
        i += 1;
    }
    out
}

/// A character reference at the start of `b`: what it stands for and how many chars it takes.
pub fn entity_at(b: &[char]) -> Option<(String, usize)> {
    let semi = b.iter().take(40).position(|c| *c == ';')?;
    let body: String = b[1..semi].iter().collect();
    if let Some(num) = body.strip_prefix('#') {
        let (digits, radix, max) = match num.strip_prefix('x').or_else(|| num.strip_prefix('X')) {
            Some(h) => (h, 16, 6),
            None => (num, 10, 7),
        };
        if digits.is_empty() || digits.len() > max || !digits.chars().all(|c| c.is_digit(radix)) {
            return None;
        }
        let n = u32::from_str_radix(digits, radix).ok()?;
        let ch = if n == 0 { '\u{FFFD}' } else { char::from_u32(n).unwrap_or('\u{FFFD}') };
        return Some((ch.to_string(), semi + 1));
    }
    if body.is_empty() || !body.chars().all(|c| c.is_ascii_alphanumeric()) {
        return None;
    }
    entities().get(&body).map(|v| (v.clone(), semi + 1))
}

/// HTML5's named character references, read from core's own table.
fn entities() -> &'static std::collections::HashMap<String, String> {
    static TABLE: std::sync::OnceLock<std::collections::HashMap<String, String>> = std::sync::OnceLock::new();
    TABLE.get_or_init(|| {
        let mut m = std::collections::HashMap::new();
        for line in include_str!(env!("XTMD_ENTITIES")).lines() {
            let line = line.trim();
            let Some(rest) = line.strip_prefix("{ key = \"") else { continue };
            let Some((key, rest)) = rest.split_once("\", value = \"") else { continue };
            let Some(value) = rest.strip_suffix("\" },").or_else(|| rest.strip_suffix("\" }")) else { continue };
            m.insert(key.to_string(), crate::lexer::decode_piece(value));
        }
        m
    })
}

fn is_thematic(s: &str) -> bool {
    let t: Vec<char> = s.chars().filter(|c| *c != ' ' && *c != '\t').collect();
    let t: Vec<char> = t.into_iter().take_while(|c| *c != '\n').collect();
    if t.len() < 3 {
        return false;
    }
    let c = t[0];
    matches!(c, '*' | '-' | '_') && t.iter().all(|x| *x == c)
}

fn delimiter_row(s: &str) -> Option<Vec<Align>> {
    let t = s.trim();
    if !t.contains('-') || !t.chars().all(|c| matches!(c, '|' | '-' | ':' | ' ' | '\t')) {
        return None;
    }
    if !t.contains('|') && !t.starts_with(':') {
        // a line of only dashes is a setext underline or a break, not a table
        let cells = split_row(t);
        if cells.len() < 2 {
            return None;
        }
    }
    let mut out = Vec::new();
    for cell in split_row(t) {
        let c = cell.trim();
        if c.is_empty() || !c.trim_matches(':').chars().all(|x| x == '-') || c.trim_matches(':').is_empty() {
            return None;
        }
        out.push(match (c.starts_with(':'), c.ends_with(':')) {
            (true, true) => Align::Center,
            (true, false) => Align::Start,
            (false, true) => Align::End,
            _ => Align::None,
        });
    }
    Some(out)
}

/// The cells of a table row, split at pipes that aren't escaped.
pub fn split_row(s: &str) -> Vec<String> {
    let mut t = s.trim();
    if let Some(x) = t.strip_prefix('|') {
        t = x;
    }
    if t.ends_with('|') && !t.ends_with("\\|") {
        t = &t[..t.len() - 1];
    }
    let mut out = Vec::new();
    let mut cell = String::new();
    let mut chars = t.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' && chars.peek() == Some(&'|') {
            cell.push('|');
            chars.next();
        } else if c == '|' {
            out.push(cell.trim().to_string());
            cell = String::new();
        } else {
            cell.push(c);
        }
    }
    out.push(cell.trim().to_string());
    out
}

const BLOCK_TAGS: &[&str] = &[
    "address", "article", "aside", "base", "basefont", "blockquote", "body", "caption", "center", "col", "colgroup", "dd", "details", "dialog", "dir", "div", "dl", "dt",
    "fieldset", "figcaption", "figure", "footer", "form", "frame", "frameset", "h1", "h2", "h3", "h4", "h5", "h6", "head", "header", "hr", "html", "iframe", "legend", "li",
    "link", "main", "menu", "menuitem", "nav", "noframes", "ol", "optgroup", "option", "p", "param", "search", "section", "summary", "table", "tbody", "td", "tfoot", "th",
    "thead", "title", "tr", "track", "ul",
];

fn html_start(kind: u8, s: &str) -> bool {
    let lower = s.to_ascii_lowercase();
    match kind {
        1 => ["<pre", "<script", "<style", "<textarea"].iter().any(|t| lower.starts_with(t) && matches!(lower.chars().nth(t.len()), None | Some(' ') | Some('\t') | Some('>') | Some('\n'))),
        2 => s.starts_with("<!--"),
        3 => s.starts_with("<?"),
        4 => s.len() > 2 && s.starts_with("<!") && s.chars().nth(2).map_or(false, |c| c.is_ascii_alphabetic()),
        5 => s.starts_with("<![CDATA["),
        6 => {
            let t = lower.strip_prefix("</").or_else(|| lower.strip_prefix('<')).unwrap_or("");
            let name: String = t.chars().take_while(|c| c.is_ascii_alphanumeric()).collect();
            let after = t.chars().nth(name.len());
            BLOCK_TAGS.contains(&name.as_str()) && (matches!(after, None | Some(' ') | Some('\t') | Some('>') | Some('\n')) || t[name.len()..].starts_with("/>"))
        }
        7 => {
            let t = s.trim_end();
            (is_open_tag(t) || is_close_tag(t)) && !lower.starts_with("<script") && !lower.starts_with("<style") && !lower.starts_with("<pre") && !lower.starts_with("<textarea")
        }
        _ => false,
    }
}

fn html_end(kind: u8, s: &str) -> bool {
    let lower = s.to_ascii_lowercase();
    match kind {
        1 => lower.contains("</pre>") || lower.contains("</script>") || lower.contains("</style>") || lower.contains("</textarea>"),
        2 => s.contains("-->"),
        3 => s.contains("?>"),
        4 => s.contains('>'),
        5 => s.contains("]]>"),
        _ => false,
    }
}

fn tag_name(s: &str) -> Option<usize> {
    let mut it = s.char_indices();
    let (_, c) = it.next()?;
    if !c.is_ascii_alphabetic() {
        return None;
    }
    let mut end = 1;
    for (k, c) in it {
        if c.is_ascii_alphanumeric() || c == '-' {
            end = k + 1;
        } else {
            break;
        }
    }
    Some(end)
}

/// A whole open tag, alone on its line (with spaces after it).
fn is_open_tag(s: &str) -> bool {
    let Some(rest) = s.strip_prefix('<') else { return false };
    let Some(n) = tag_name(rest) else { return false };
    let mut t = &rest[n..];
    loop {
        let trimmed = t.trim_start_matches([' ', '\t']);
        let had_space = trimmed.len() < t.len();
        if trimmed.starts_with("/>") {
            return trimmed[2..].trim().is_empty();
        }
        if trimmed.starts_with('>') {
            return trimmed[1..].trim().is_empty();
        }
        if !had_space {
            return false;
        }
        // an attribute
        let name_len = trimmed.chars().take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | ':' | '.' | '-')).count();
        if name_len == 0 || !trimmed.chars().next().map_or(false, |c| c.is_ascii_alphabetic() || c == '_' || c == ':') {
            return false;
        }
        t = &trimmed[name_len..];
        let v = t.trim_start_matches([' ', '\t']);
        if let Some(after_eq) = v.strip_prefix('=') {
            let val = after_eq.trim_start_matches([' ', '\t']);
            if let Some(q) = val.chars().next().filter(|c| *c == '"' || *c == '\'') {
                match val[1..].find(q) {
                    Some(end) => t = &val[end + 2..],
                    None => return false,
                }
            } else {
                let len = val.chars().take_while(|c| !c.is_whitespace() && !matches!(c, '"' | '\'' | '=' | '<' | '>' | '`')).count();
                if len == 0 {
                    return false;
                }
                t = &val[len..];
            }
        }
    }
}

fn is_close_tag(s: &str) -> bool {
    let Some(rest) = s.strip_prefix("</") else { return false };
    let Some(n) = tag_name(rest) else { return false };
    let t = rest[n..].trim_start_matches([' ', '\t']);
    t.starts_with('>') && t[1..].trim().is_empty()
}

/// A link label, as CommonMark matches them: case folded, inner spaces collapsed.
pub fn normalize_label(s: &str) -> String {
    let words: Vec<&str> = s.split_whitespace().collect();
    words.join(" ").to_lowercase().replace('ß', "ss").replace('ẞ', "ss")
}

/// One link reference definition at the start of `s`: the definition and the bytes it used.
fn link_def(s: &str) -> Option<(LinkDef, usize)> {
    let b: Vec<char> = s.chars().collect();
    let mut i = 1;
    let mut label = String::new();
    // the label: up to 999 characters, no unescaped brackets
    while i < b.len() {
        match b[i] {
            '\\' if i + 1 < b.len() => {
                label.push(b[i]);
                label.push(b[i + 1]);
                i += 2;
            }
            '[' => return None,
            ']' => break,
            c => {
                label.push(c);
                i += 1;
            }
        }
    }
    if i >= b.len() || label.trim().is_empty() || label.chars().count() > 999 {
        return None;
    }
    i += 1;
    if b.get(i) != Some(&':') {
        return None;
    }
    i += 1;
    let skip_ws = |i: &mut usize, newline_ok: bool| {
        let mut nl = false;
        while *i < b.len() && (b[*i] == ' ' || b[*i] == '\t' || (b[*i] == '\n' && newline_ok && !nl)) {
            if b[*i] == '\n' {
                nl = true;
            }
            *i += 1;
        }
    };
    skip_ws(&mut i, true);
    // the destination
    let mut dest = String::new();
    if b.get(i) == Some(&'<') {
        i += 1;
        while i < b.len() && b[i] != '>' {
            if b[i] == '\n' || b[i] == '<' {
                return None;
            }
            if b[i] == '\\' && i + 1 < b.len() && b[i + 1].is_ascii_punctuation() {
                dest.push(b[i]);
                dest.push(b[i + 1]);
                i += 2;
                continue;
            }
            dest.push(b[i]);
            i += 1;
        }
        if i >= b.len() {
            return None;
        }
        i += 1;
    } else {
        let mut depth = 0;
        let start = i;
        while i < b.len() && !b[i].is_whitespace() && !b[i].is_control() {
            match b[i] {
                '\\' if i + 1 < b.len() && b[i + 1].is_ascii_punctuation() => {
                    dest.push(b[i]);
                    dest.push(b[i + 1]);
                    i += 2;
                    continue;
                }
                '(' => depth += 1,
                ')' => {
                    if depth == 0 {
                        break;
                    }
                    depth -= 1;
                }
                _ => {}
            }
            dest.push(b[i]);
            i += 1;
        }
        if i == start || depth != 0 {
            return None;
        }
    }
    let dest = unescape(&dest);
    let before_title = i;
    let line_end_after_dest = {
        let mut j = i;
        while j < b.len() && (b[j] == ' ' || b[j] == '\t') {
            j += 1;
        }
        if j >= b.len() || b[j] == '\n' {
            Some(if j < b.len() { j + 1 } else { j })
        } else {
            None
        }
    };
    skip_ws(&mut i, true);
    if i > before_title && matches!(b.get(i), Some('"') | Some('\'') | Some('(')) {
        let close = if b[i] == '(' { ')' } else { b[i] };
        let mut t = String::new();
        let mut j = i + 1;
        let mut ok = false;
        while j < b.len() {
            if b[j] == '\\' && j + 1 < b.len() && b[j + 1].is_ascii_punctuation() {
                t.push(b[j]);
                t.push(b[j + 1]);
                j += 2;
                continue;
            }
            if b[j] == close {
                ok = true;
                break;
            }
            if b[j] == '(' && close == ')' {
                break;
            }
            t.push(b[j]);
            j += 1;
        }
        if ok {
            let mut k = j + 1;
            while k < b.len() && (b[k] == ' ' || b[k] == '\t') {
                k += 1;
            }
            if k >= b.len() || b[k] == '\n' {
                let used = if k < b.len() { k + 1 } else { k };
                let bytes: usize = b[..used].iter().map(|c| c.len_utf8()).sum();
                return Some((LinkDef { label, dest, title: Some(unescape(&t)) }, bytes));
            }
        }
    }
    // no title: the destination ends its line
    let used = line_end_after_dest?;
    let bytes: usize = b[..used].iter().map(|c| c.len_utf8()).sum();
    Some((LinkDef { label, dest, title: None }, bytes))
}

/// The blocks of Markdown text, and its link reference definitions.
pub fn parse(text: &str) -> MdDoc {
    let mut p = Parser::new();
    let mut lines: Vec<&str> = text.split('\n').collect();
    if text.ends_with('\n') {
        lines.pop();
    }
    for l in lines {
        p.incorporate(l);
    }
    while p.tip != 0 || p.nodes[0].open {
        let t = p.tip;
        p.finalize(t);
        if t == 0 {
            break;
        }
    }
    MdDoc { blocks: p.to_blocks(0), links: p.links }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paragraphs_headings_and_lists() {
        let d = parse("# Title\n\nSome *text*\nmore.\n\n- one\n- two\n\n> quoted\n");
        assert_eq!(d.blocks.len(), 4);
        assert_eq!(d.blocks[0], MdBlock::Heading { level: 1, text: "Title".into() });
        assert_eq!(d.blocks[1], MdBlock::Paragraph("Some *text*\nmore.".into()));
        assert!(matches!(&d.blocks[2], MdBlock::Bullets { ordered: false, items, .. } if items.len() == 2));
    }

    #[test]
    fn tables_and_tasks() {
        let d = parse("| a | b |\n|---|:-:|\n| 1 | 2 |\n\n- [x] done\n- [ ] not\n");
        assert_eq!(d.blocks[0], MdBlock::Table { align: vec![Align::None, Align::Center], head: vec!["a".into(), "b".into()], rows: vec![vec!["1".into(), "2".into()]] });
        let MdBlock::Bullets { items, .. } = &d.blocks[1] else { panic!() };
        assert_eq!(items[0].done, Some(true));
        assert_eq!(items[1].done, Some(false));
    }

    #[test]
    fn fences_and_link_definitions() {
        let d = parse("```rust\nfn x() {}\n```\n\n[a]: /url \"title\"\n\ntext\n");
        assert_eq!(d.blocks[0], MdBlock::Code { lang: "rust".into(), src: "fn x() {}\n".into() });
        assert_eq!(d.links, vec![LinkDef { label: "a".into(), dest: "/url".into(), title: Some("title".into()) }]);
        assert_eq!(d.blocks[1], MdBlock::Paragraph("text".into()));
    }

    #[test]
    fn references_in_destinations_and_info() {
        assert_eq!(unescape("f&ouml;&ouml; &#35; &#x41; \\&amp; &nope;"), "föö # A &amp; &nope;");
        let d = parse("``` f&ouml;&ouml;\nx\n```\n\n[a]: /f&ouml;\\* \"t&amp;\"\n");
        assert_eq!(d.blocks[0], MdBlock::Code { lang: "föö".into(), src: "x\n".into() });
        assert_eq!(d.links, vec![LinkDef { label: "a".into(), dest: "/fö*".into(), title: Some("t&".into()) }]);
    }
}

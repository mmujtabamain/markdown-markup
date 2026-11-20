# The standard library

Page 5 of 9. What is built in, and all of `core`: interfaces and native fns, types, ranges, lists, text, dates and moments, maths and Markdown, tokens, options, `page`, the statements a migration is written with, and the 43 base widgets.

Only the syntax is built in: literals, operators, holes, prose and `@`. A number literal has to be some type, and so do `"…"`, `[a, b]`, `a..b` and `@name(…)`, so those types are built in. Everything else is declared in `core`, a pack imported by every file without saying so, in the same way any pack declares its own, with no exceptions for core: the six interfaces the syntax works through, the operations an implementer has to do natively, as `extern fn`, everything that can be written in Extended Mark, and the look: tokens, options, `page` and the base widgets.

| | |
|---|---|
| Built-in types | **8** |
| Interfaces in core | **6** (shown, same, ordered, numeric, scaled, literal&lt;T>) |
| Native fns in core | **61** |
| core fns written in Extended Mark | **30** |
| Base widgets | **43** (23 extern, 7 more in core.gfx, 13 written in Extended Mark) |

### Built in

The eight types the syntax makes, and the syntax itself. Each operator is a call to an interface fn (`a + b` is `a.add(b)`), a hole calls `show`, and a literal of a type that fits `literal<T>` is a call to its `from`. The interfaces, and every fn on the built-in types, are declared in core below.

```txt
types        number  bool  text  duration  list<T>  opt<T>  range<T>  view
opt<T>       opt.SOME(value)  opt.NONE
```

How a value is shown in a hole:

| Type | Shown as |
|---|---|
| `number` | Its shortest exact form, with no exponent and no trailing zeros: `42`, `3.5`, `0.3`, `-7` |
| `bool` | `true` or `false` |
| `text` | Itself |
| `duration` | Whole seconds as `2s`, anything else as `250ms` |
| `date` | `2026-11-10` |
| `theme` | `light` or `dark` |

For anything meant for a reader, format it: `price.fmt(2)`.

What the syntax makes:

- **`42` and `4.2`** (number): Or a type that fits literal&lt;number>, where one is expected.
- **`"…"`** (text): Or a type that fits literal&lt;text>. A literal with holes goes to a type that fits literal&lt;template> as its pieces and holes, kept apart. A literal whose `from` would have to read a hole is a compile error.
- **`[a, b]`** (list&lt;T>): Or a type that fits literal&lt;list&lt;U>>.
- **`\{x}`** (shown): Any type that fits shown, and any view.
- **`true`, `false`, `if`, `&&`, `||`, `!`** (bool)
- **`250ms`, `2s`** (duration)
- **`a..b`, `x in r`** (range&lt;T>): For numbers, durations, dates and a pack's own ordered types. A minus right before a range's first number is that bound's sign: `-840..840` is `(-840)..840`. A whole range can't be negated; `range.negate(r)` does it.
- **`xs[i]`, `for`, `mut for`** (list&lt;T>): `xs[i]` gives an `opt`, like `xs.at(i)`. `for` also walks a range of numbers.
- **`if (let …)`, `if (mut …)`, a plain value where an opt is wanted** (opt&lt;T>): A plain value is wrapped as many times as the wanted type needs.
- **`@name(…)`** (view)
- **`+ - * / %`, `< <= > >=`, `== !=`** (numeric, scaled, ordered, same): `number`'s `*`, `/` and `%` are built in. Every other operator is a call to an interface fn (page 4).

### The core files

#### interfaces and native fns

Core declares the six interfaces of page 4 as ordinary interfaces, and `int` as an ordinary alias. The native fns are `extern fn` with no body: every implementer supplies them, because Extended Mark can't do them in terms of anything else. They are list storage, Unicode text, exact numbers with their maths, the interface fns of the built-in types, a range's ends and step, a duration in milliseconds, and `clamp`.

```java
package core;

// lets a value go in a hole: \{x}
interface shown {
    fn show(self): text;
}

// lets a value be compared with == and !=
interface same {
    fn same(self, other: self): bool;
}

// lets a value be compared with < <= > >=, sorted, and given a range
interface ordered {
    fn before(self, other: self): bool;
}

// lets a value use + and -, and be summed
interface numeric {
    fn add(self, other: self): self;
    fn sub(self, other: self): self;
}

// lets a value be multiplied and divided by a number, and negated
interface scaled {
    fn scale(self, k: number): self;
}

// lets a literal stand for a value: "…" for literal<text>, 4.2 for literal<number>,
// [a, b] for literal<list<U>>, and a literal with holes for literal<template>.
// from gives opt.NONE for a value that doesn't make one
interface literal<T> {
    fn from(value: T): opt<self>;
}

//@about A whole number. A contract written after it adds to its own: int 0..10 is number 0..10 step 1.
type int = number step 1;

// number, duration, text and bool fit the interfaces through these. number's * / and % are built in
extern fn number.show(self): text;
extern fn number.same(self, other: number): bool;
extern fn number.before(self, other: number): bool;
extern fn number.add(self, other: number): number;
extern fn number.sub(self, other: number): number;
extern fn number.scale(self, k: number): number;
extern fn duration.show(self): text;
extern fn duration.same(self, other: duration): bool;
extern fn duration.before(self, other: duration): bool;
extern fn duration.add(self, other: duration): duration;
extern fn duration.sub(self, other: duration): duration;
extern fn duration.scale(self, k: number): duration;
extern fn text.show(self): text;
extern fn text.same(self, other: text): bool;
extern fn text.before(self, other: text): bool;          // by character number, not by language
extern fn bool.show(self): text;
extern fn bool.same(self, other: bool): bool;
extern fn bool.before(self, other: bool): bool;          // false before true

// range<T>, for numbers, durations, dates and a pack's ordered types: a..b, a..., ...b, with an optional step
extern fn range<T>.low(self): opt<T>;
extern fn range<T>.high(self): opt<T>;
extern fn range<T>.stride(self): opt<T>;
extern fn range<T>.has(self, x: T): bool;                // written x in r

// duration: written 250ms or 2s
extern fn duration.ms(self): number;

// number: exact base-10, 34 significant digits. A result too large for that, such as (1000).exp(), is a failure
extern fn number.round(self): int;                       // halves go away from zero
extern fn number.floor(self): int;
extern fn number.ceil(self): int;
extern fn number.abs(self): number;
extern fn number.fmt(self, places: int 0..10): text;
extern fn number.sign(self): number;                     // -1, 0 or 1
extern fn number.sqrt(self): opt<number>;                // opt.NONE below 0
extern fn number.pow(self, p: number): opt<number>;      // opt.NONE for 0 to a negative power,
                                                         // or a negative number to a power that isn't whole
extern fn number.exp(self): number;
extern fn number.ln(self): opt<number>;                  // opt.NONE at 0 or below
extern fn number.sin(self): number;                      // angles in radians
extern fn number.cos(self): number;
extern fn number.tan(self): number;
extern fn number.asin(self): opt<number>;                // opt.NONE outside -1..1
extern fn number.acos(self): opt<number>;                // opt.NONE outside -1..1
extern fn number.atan(self): number;
extern fn number.atan2(self, x: number): number;         // y.atan2(x): the angle of the point (x, y)
extern fn number.sinh(self): number;
extern fn number.cosh(self): number;
extern fn number.tanh(self): number;

// list<T>: xs[i] is another way to write xs.at(i)
extern fn list<T>.len(self): int 0...;
extern fn list<T>.at(self, pos: number): opt<T>;         // opt.NONE unless pos is a whole number in the list
extern fn list<T>.add(mut self, item: T);
extern fn list<T>.insert(mut self, pos: int 0..., item: T);     // past the end, it is added last
extern fn list<T>.remove_at(mut self, pos: int 0...);           // outside the list is a failure
extern fn list<T>.move(mut self, pos: int 0..., to: int 0...);
extern fn list<T: same>.remove(mut self, item: T);       // every item equal to it
extern fn list<T: ordered>.sort(mut self);

// text
extern fn text.len(self): int 0...;
extern fn text.slice(self, start: int 0..., count: int 0...): text;     // stops at the end
extern fn text.chars(self): list<text[1]>;
extern fn text.lower(self): text;
extern fn text.upper(self): text;
extern fn text.trim(self): text;
extern fn text.has(self, part: text): bool;
extern fn text.split(self, sep: text[1...]): list<text>;
// reads [-] digits [. digits], with no spaces, no +, no _ and no exponent; leading zeros are fine.
// "-7" is -7 and "07" is 7; " 5", "+1", "1_000" and "1e3" are opt.NONE
extern fn text.number(self): opt<number>;

// on every ordered type. With constant bounds the result is in low..high; with bounds that have ranges,
// it runs from the low bound's lowest value to the high bound's highest
extern fn ordered.clamp(self, low: self, high: self): self;
```

#### types

```java
package core;

//@about Values looked up by a text key.
record map<T> {
    entries: list<{ key: text, value: T }>;
}

fn map<T>.get(self, key: text): opt<T> {
    for (entry in self.entries) {
        if (entry.key == key) {
            return opt.SOME(entry.value);
        }
    }
    return opt.NONE;
}

fn map<T>.keys(self): list<text> {
    return self.entries.map(fn(entry) { return entry.key; });
}

fn map<T>.has(self, key: text): bool {
    return self.keys().some(fn(k) { return k == key; });
}

//@about A calendar day, written as a text: "2026-11-10". Its fields mirror the text.
record date implements literal<text>, same, ordered, shown {
    year: int 1..9999;
    month: int 1..12;
    day: int 1..31;

    require "this month has no such day" {
        return day <= days_in(year, month);
    }
}

//@about Cuts the text and checks its separators. The record checks the numbers.
fn date.from(value: text): opt<date> {
    if (value.len() != 10 || value.slice(4, 1) != "-" || value.slice(7, 1) != "-") {
        return opt.NONE;
    }
    return try date {
        year = value.slice(0, 4).number().or(0),
        month = value.slice(5, 2).number().or(0),
        day = value.slice(8, 2).number().or(0),
    };
}

// days since 1970-01-01
fn date.days(self): int {
    let y: int = self.month <= 2 ? self.year - 1 : self.year;
    let era: int = (y / 400).floor();
    let yoe: int = y - era * 400;
    let mp: int = (self.month + 9) % 12;
    let doy: int = ((153 * mp + 2) / 5).floor() + self.day - 1;
    let doe: int = yoe * 365 + (yoe / 4).floor() - (yoe / 100).floor() + doy;
    return era * 146097 + doe - 719468;
}

fn date.before(self, other: date): bool {
    return self.days() < other.days();
}

fn date.plus(self, days: number): date {
    return day_number(self.days() + days.round());
}

fn date.days_to(self, other: date): int {
    return other.days() - self.days();
}

fn date.show(self): text {
    let y: text = "\{self.year}";
    let pad: text = "0000".slice(0, (4 - y.len()).clamp(0, 4));
    return "\{pad}\{y}-\{two(self.month)}-\{two(self.day)}";
}

//@about A moment, written as a text with its offset: "2026-11-10T09:30+01:00". Its fields mirror the text.
record moment implements literal<text>, same, ordered, shown {
    day: date;
    hour: int 0..23;
    minute: int 0..59;
    east: bool;                                 // + in the text: the offset is east of UTC
    offset_hour: int 0..14;
    offset_minute: int 0..59;

    require "an offset is at most 14:00" {
        return offset_hour < 14 || offset_minute == 0;
    }
}

//@about Cuts the text and checks its T, colons and sign. The records check the numbers.
fn moment.from(value: text): opt<moment> {
    let sign: text = value.slice(16, 1);
    if (value.len() != 22 || value.slice(10, 1) != "T" || value.slice(13, 1) != ":" || value.slice(19, 1) != ":" || (sign != "+" && sign != "-")) {
        return opt.NONE;
    }
    if (let date_part: date = date.from(value.slice(0, 10))) {
        return try moment {
            day = date_part,
            hour = value.slice(11, 2).number().or(-1),
            minute = value.slice(14, 2).number().or(-1),
            east = sign == "+",
            offset_hour = value.slice(17, 2).number().or(-1),
            offset_minute = value.slice(20, 2).number().or(-1),
        };
    }
    return opt.NONE;
}

// the offset in minutes, east of UTC above 0
fn moment.offset(self): int {
    let size: int = self.offset_hour * 60 + self.offset_minute;
    return self.east ? size : -size;
}

// minutes since 1970-01-01T00:00 in UTC
fn moment.utc(self): int {
    return self.day.days() * 1440 + self.hour * 60 + self.minute - self.offset();
}

// equal when they are the same instant: this same replaces the field-by-field one
fn moment.same(self, other: moment): bool {
    return self.utc() == other.utc();
}

fn moment.before(self, other: moment): bool {
    return self.utc() < other.utc();
}

fn moment.plus(self, minutes: number): moment {
    return moment_at(self.utc() + minutes.round(), self);
}

fn moment.minutes_to(self, other: moment): int {
    return other.utc() - self.utc();
}

// the same moment, with the offset the reader's zone uses on its date.
// Supplied by the implementer from the platform's zone rules: Extended Mark can never know them.
// It builds on moment.utc for the instant and moment_at for the fields, so a page that
// calls it has both in its IR
extern fn moment.local(self): moment;

fn moment.time(self): text {
    return "\{two(self.hour)}:\{two(self.minute)}";
}

fn moment.show(self): text {
    let sign: text = self.east ? "+" : "-";
    return "\{self.day}T\{self.time()}\{sign}\{two(self.offset_hour)}:\{two(self.offset_minute)}";
}

// helpers, private to core
fn leap(y: int): bool {
    return y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
}

fn days_in(y: int, m: int): int {
    if (m == 2) {
        return leap(y) ? 29 : 28;
    }
    return [4, 6, 9, 11].has(m) ? 30 : 31;
}

fn two(n: number): text {
    return n < 10 ? "0\{n}" : "\{n}";
}

// the date count days after 1970-01-01, kept between 0001-01-01 and 9999-12-31
fn day_number(count: int): date {
    let z: int = count.clamp(-719162, 2932896) + 719468;
    let era: int = (z / 146097).floor();
    let doe: int = z - era * 146097;
    let yoe: int = ((doe - (doe / 1460).floor() + (doe / 36524).floor() - (doe / 146096).floor()) / 365).floor();
    let doy: int = doe - (365 * yoe + (yoe / 4).floor() - (yoe / 100).floor());
    let mp: int = ((5 * doy + 2) / 153).floor();
    let d: int = doy - ((153 * mp + 2) / 5).floor() + 1;
    let m: int = mp < 10 ? mp + 3 : mp - 9;
    let y: int = yoe + era * 400 + (m <= 2 ? 1 : 0);
    // the sums always land in these ranges, so clamp proves them without changing them
    return date { year = y.clamp(1, 9999), month = m.clamp(1, 12), day = d.clamp(1, 31) };
}

// the moment utc minutes after 1970-01-01T00:00 in UTC, with the offset source has
fn moment_at(utc: int, source: moment): moment {
    let local: int = utc + source.offset();
    let days: int = (local / 1440).floor();
    let minutes: int = local - days * 1440;     // 0 to 1439, so clamp only proves the hour and the minute
    return moment {
        day = day_number(days),
        hour = (minutes / 60).floor().clamp(0, 23),
        minute = (minutes % 60).clamp(0, 59),
        east = source.east,
        offset_hour = source.offset_hour,
        offset_minute = source.offset_minute,
    };
}

//@about A literal with holes: the text between them, and their values. A hole is never part of a piece.
record template {
    pieces: list<text>[1...];                   // one more piece than holes
    holes: list<hole>;
}

//@about One hole of a template, which from places as a value and never reads.
enum hole {
    TEXT(value: text),                          // a value that fits shown, already shown
    VIEW(child: view),                          // \{@icon(…)} in a sentence
}

//@about A template from a plain text, with no holes.
fn template.of(value: text): template {
    return template { pieces = [value], holes = [] };
}

fn hole.words(self): text {
    match (self) {
        case hole.TEXT(value) {
            return value;
        }
        case hole.VIEW(child) {
            return "";
        }
    }
}

//@about Maths, written in TeX. Core checks how it is written; the target may also refuse what it can't draw.
//@about Its holes stay values: each counts as one token in the checks, and show escapes it for TeX.
record latex implements literal<template>, shown {
    tex: template;

    require "TeX is not empty" {
        return tex_tokens(tex).len() > 0;
    }

    require "every { in TeX has a matching }" {
        return tex_pairs(tex_tokens(tex), "{", "}");
    }

    require "every \\begin in TeX has a matching \\end" {
        return tex_environments(tex_tokens(tex));
    }

    require "every \\left in TeX has a matching \\right" {
        return tex_pairs(tex_tokens(tex), "\\left", "\\right");
    }

    require "every ^ and _ in TeX has something after it" {
        return tex_scripts(tex_tokens(tex));
    }

    require "every backslash in TeX starts a command" {
        return !tex_tokens(tex).has("\\");
    }

    require "a hole in TeX holds a value, not a widget" {
        return tex_values(tex);
    }

    require "the target can draw this TeX" {
        return can_draw_tex(tex);
    }
}

fn latex.from(value: template): opt<latex> {
    return try latex { tex = value };
}

//@about The TeX, with each hole's characters escaped so that TeX reads them as themselves. A target draws this.
fn latex.show(self): text {
    mut out: text = "";
    for (k, piece in self.tex.pieces) {
        out = "\{out}\{piece}";
        if (let h: hole = self.tex.holes[k]) {
            out = "\{out}\{tex_escape(h.words())}";
        }
    }
    return out;
}

//@about Whether the target can draw this TeX, for example whether it knows every command in it. A target may supply its own; without one, all TeX that core accepts is drawn.
extern fn can_draw_tex(tex: template): bool {
    return true;
}

//@about Markdown blocks, parsed by core when the value is made. @blocks draws them.
record md implements literal<template> {
    blocks: list<block>;
}

//@about One Markdown block, as md holds it. Each case is drawn by the extern block of its kind.
enum block {
    PARAGRAPH(value: rich_text),
    HEADING(level: int 1..6, value: rich_text),
    BULLETS(ordered: bool, start: int 0..., items: list<list_item>[1...]),
    QUOTE(body: list<block>),
    CODE(src: text, lang: text),
    MATH(tex: latex),
    TABLE(head: list<rich_text>[1...], rows: list<list<rich_text>>, align: list<cell_align>),
    FOOTNOTE(mark: text, body: list<block>),
    DIVIDER,
}

//@about One item of a list in md. done is a task box: ticked, not ticked, or none for an ordinary item.
record list_item {
    done: opt<bool> = opt.NONE;
    body: list<block>;
}

//@about Inline Markdown as segments, parsed by core's rich_text.from: from prose, or from a text literal where rich_text is wanted.
record rich_text implements literal<template>, shown {
    segments: list<segment>;
}

//@about A part of a sentence and how it is marked.
record segment {
    part: part;
    marks: marks = marks { };
}

//@about What a segment holds. A hole's value is TEXT, or VIEW for a widget, so a value never becomes formatting.
enum part {
    TEXT(value: text),
    CODE(value: text),                          // a code span
    MATH(tex: latex),                           // $x^2$
    IMAGE(src: text, alt: text),                // ![alt](src)
    NOTE(mark: text),                           // [^1], the mark of a footnote
    BREAK,                                      // a hard line break
    VIEW(child: view),                          // \{@icon(…)} in a sentence
}

//@about How a segment is marked. A link is a mark, so bold words inside a link are one segment.
record marks {
    bold: bool = false;
    italic: bool = false;
    strike: bool = false;
    link: opt<text> = opt.NONE;
}

//@about Text from a value, as one plain segment: nothing in it is read as Markdown.
fn rich_text.plain(value: text): rich_text {
    return rich_text { segments = [segment { part = part.TEXT(value) }] };
}

//@about The words, without their marks.
fn rich_text.show(self): text {
    return self.segments.map(fn(s) { return s.part.words(); }).join("");
}

fn part.words(self): text {
    match (self) {
        case part.TEXT(v) {
            return v;
        }
        case part.CODE(v) {
            return v;
        }
        case part.MATH(m) {
            return m.show();
        }
        case part.IMAGE(src, alt) {
            return alt;
        }
        case part.BREAK {
            return " ";
        }
        case else {
            return "";
        }
    }
}

// TeX as tokens: a command (\frac, \{, \\), one character, or a hole, which is the one token "hole".
// Whitespace is dropped. Private to core
fn tex_tokens(tex: template): list<text> {
    mut out: list<text> = [];
    for (k, piece in tex.pieces) {
        if (k > 0) {
            out.add("hole");                    // TeX's own tokens are one character or a command, never this
        }
        for (x in tex_piece(piece)) {
            out.add(x);
        }
    }
    return out;
}

// the tokens of one piece of TeX. Private to core
fn tex_piece(tex: text): list<text> {
    let letters: text = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    mut out: list<text> = [];
    mut cmd: text = "";                         // a command being read, from its backslash
    for (c in tex.chars()) {
        if (cmd == "\\") {
            if (letters.has(c)) {
                cmd = "\\\{c}";
            } else {
                out.add("\\\{c}");              // \{, \\ and the like are whole commands
                cmd = "";
            }
        } else if (cmd != "" && letters.has(c)) {
            cmd = "\{cmd}\{c}";
        } else {
            if (cmd != "") {
                out.add(cmd);
                cmd = "";
            }
            if (c == "\\") {
                cmd = "\\";
            } else if (![" ", "\t", "\n", "\u{d}"].has(c)) {
                out.add(c);
            }
        }
    }
    if (cmd != "") {
        out.add(cmd);                           // a backslash at the very end stays a lone \
    }
    return out;
}

// every open token is closed, and no close comes first. Private to core
fn tex_pairs(t: list<text>, open: text, close: text): bool {
    mut depth: int = 0;
    mut ok: bool = true;
    for (x in t) {
        if (x == open) {
            depth = depth + 1;
        } else if (x == close) {
            if (depth == 0) {
                ok = false;
            } else {
                depth = depth - 1;
            }
        }
    }
    return ok && depth == 0;
}

// \begin{name} and \end{name} pair up by name, innermost first. Private to core
fn tex_environments(t: list<text>): bool {
    mut open: list<text> = [];                  // names begun; the first depth of them are still open
    mut depth: int = 0;
    mut ok: bool = true;
    for (k, x in t) {
        if (x == "\\begin") {
            if (depth == open.len()) {
                open.add(tex_group(t, k + 1));
            } else {
                open[depth] = tex_group(t, k + 1);
            }
            depth = depth + 1;
        } else if (x == "\\end") {
            let name: text = tex_group(t, k + 1);
            if (name != "" && open[depth - 1].or("") == name) {
                depth = depth - 1;
            } else {
                ok = false;
            }
        }
    }
    return ok && depth == 0;
}

// the text of the {group} that starts at token k, or "" when there is none. Private to core
fn tex_group(t: list<text>, k: int): text {
    mut name: text = "";
    mut done: bool = t[k].or("") != "{";
    mut closed: bool = false;
    for (j, x in t) {
        if (j > k && !done) {
            if (x == "}") {
                done = true;
                closed = true;
            } else {
                name = "\{name}\{x}";
            }
        }
    }
    return closed ? name : "";
}

// every ^ and _ has something after it. Private to core
fn tex_scripts(t: list<text>): bool {
    mut ok: bool = true;
    for (k, x in t) {
        if (x == "^" || x == "_") {
            if (["", "}", "^", "_", "&", "\\\\", "\\right", "\\end"].has(t[k + 1].or(""))) {
                ok = false;
            }
        }
    }
    return ok;
}

// every hole holds a value, not a widget. Private to core
fn tex_values(t: template): bool {
    for (h in t.holes) {
        match (h) {
            case hole.TEXT(value) { }
            case hole.VIEW(child) {
                return false;
            }
        }
    }
    return true;
}

// a hole's text, with every character TeX gives a meaning to escaped. Private to core
fn tex_escape(value: text): text {
    mut out: text = "";
    for (c in value.chars()) {
        if (["{", "}", "$", "&", "#", "_", "%"].has(c)) {
            out = "\{out}\\\{c}";
        } else if (c == "\\") {
            out = "\{out}\\backslash ";
        } else if (c == "^") {
            out = "\{out}\\hat{} ";
        } else if (c == "~") {
            out = "\{out}\\sim ";
        } else {
            out = "\{out}\{c}";
        }
    }
    return out;
}

//@about A place on a canvas or a plane.
record point implements numeric, scaled, same, shown {
    x: number;
    y: number;
}

fn point.add(self, other: point): point {
    return point { x = self.x + other.x, y = self.y + other.y };
}

fn point.sub(self, other: point): point {
    return point { x = self.x - other.x, y = self.y - other.y };
}

fn point.scale(self, k: number): point {
    return point { x = self.x * k, y = self.y * k };
}

fn point.show(self): text {
    return "(\{self.x}, \{self.y})";
}

//@about A part of a canvas or a plane, from one corner to the other, in its units.
record region {
    from: point;
    to: point;
}

fn region.width(self): number {
    return (self.to.x - self.from.x).abs();
}

fn region.height(self): number {
    return (self.to.y - self.from.y).abs();
}

fn region.middle(self): point {
    return self.from.add(self.to).scale(0.5);
}

//@about Whether two regions share a point. Both go from their bottom-left corner to their top-right one, as a spot's box and a plane's drawn region do.
fn region.overlaps(self, other: region): bool {
    return self.from.x <= other.to.x && other.from.x <= self.to.x && self.from.y <= other.to.y && other.from.y <= self.to.y;
}

fn opt<T>.or(self, fallback: T): T {
    match (self) {
        case opt.SOME(v) {
            return v;
        }
        case opt.NONE {
            return fallback;
        }
    }
}

// constants, to 34 digits like every number
let pi: number = 3.141592653589793238462643383279503;
let euler: number = 2.718281828459045235360287471352662;

// on every ordered type
fn ordered.min(self, other: self): self {
    return other.before(self) ? other : self;
}

fn ordered.max(self, other: self): self {
    return self.before(other) ? other : self;
}
```

`map`, `date`, `moment`, `template`, `latex`, `md` and `rich_text` are ordinary records written in Extended Mark, not extern: nothing about them needs the implementer.

- **Dates and moments** fit `literal<text>`, like `email` on page 4, so `"2026-11-10"` is checked where it is written. Their fields mirror the text, so each simple limit is a field contract, proved like any other, and only a rule across fields, that the day fits its month, is a `require`. `from` only cuts the text and checks its separators, and a reader's text goes through it by name: `date.from(entry)` is an `opt<date>`. A date literal with a hole is a compile error that says to build the record: `date { year = 2026, month = month, day = 1 }`. `plus` stops at the ends of the calendar, 0001-01-01 and 9999-12-31.
- **Offsets, not zones.** `moment` always carries its offset; named zones and daylight saving are left out, and authors write offsets. The current time is `page.now`, which the app updates, because drawing can't ask what time it is. `local()` is an extern fn: it shows a moment in the reader's own zone, with the offset that zone uses on that date, from the platform's zone rules. Two moments are equal when they are the same instant, because `moment`'s own `same` replaces the field-by-field one.
- **Holes stay values.** `rich_text`, `md` and `latex` fit `literal<template>`: a literal, holes and all, reaches their `from` as a `template`, and each hole is placed as a value, never read, so it can't become formatting or TeX.
- **Markdown is parsed by core**, in Extended Mark, as any pack could: CommonMark, with GitHub's tables, task lists, strikethrough, footnotes and bare links. No implementer parses it. The parser is long and follows those two specs, so this page gives its two entry points as signatures, below. `md.from` may also be called by name: `md.from(template.of(entry))` reads what a reader typed as Markdown, and `@blocks(value = …)` draws it.
- **TeX** is checked by `latex`'s seven `require` blocks, written in Extended Mark, each counting a hole as one token. An eighth asks `can_draw_tex`, an extern fn whose body is the default and which a target may replace with its own, such as one that refuses a command it can't draw. `show` gives the whole TeX with each hole's characters escaped, which is what a target draws.

```java
// inline Markdown as segments: CommonMark's emphasis, GitHub's strikethrough, links and bare links, code spans,
// maths, pictures, footnote marks, hard breaks and escapes. Each hole is a segment of its own, with its marks.
// opt.NONE when the TeX of a maths span fails latex's checks
fn rich_text.from(value: template): opt<rich_text>;

// Markdown blocks: CommonMark, with GitHub's tables, task lists and footnotes, and each block's inline Markdown
// through rich_text.from. A hole is never read, so it never starts or ends a block
fn md.from(value: template): opt<md>;
```

#### range

```java
package core;

//@about Each bound negated: 1..10 gives -10..-1, and 1... gives ...-1.
fn range.negate<T: scaled>(r: range<T>): range<T> {
    if (let low: T = r.low()) {
        if (let high: T = r.high()) {
            return (-high)..(-low);
        }
        return ...(-low);
    }
    if (let high: T = r.high()) {
        return (-high)...;
    }
    return r;                                   // never reached: a range always has a bound
}

//@about Each bound moved by the same amount: 1..10 by 5 gives 6..15.
fn range.shift<T: numeric>(r: range<T>, by: T): range<T> {
    if (let low: T = r.low()) {
        if (let high: T = r.high()) {
            return (low + by)..(high + by);
        }
        return (low + by)...;
    }
    if (let high: T = r.high()) {
        return ...(high + by);
    }
    return r;                                   // never reached: a range always has a bound
}

//@about Each bound multiplied: 1..10 by 2 gives 2..20, and a negative k flips the range.
fn range.scale<T: scaled>(r: range<T>, k: number): range<T> {
    if (k < 0) {
        return range.negate(range.scale(r, -k));
    }
    if (let low: T = r.low()) {
        if (let high: T = r.high()) {
            return (low * k)..(high * k);
        }
        return (low * k)...;
    }
    if (let high: T = r.high()) {
        return ...(high * k);
    }
    return r;                                   // never reached: a range always has a bound
}

//@about Each bound moved out by an amount: 1..10 by 1 gives 0..11.
fn range.widen<T: numeric>(r: range<T>, by: T): range<T> {
    if (let low: T = r.low()) {
        if (let high: T = r.high()) {
            return (low - by)..(high + by);
        }
        return (low - by)...;
    }
    if (let high: T = r.high()) {
        return ...(high + by);
    }
    return r;                                   // never reached: a range always has a bound
}

//@about Where two ranges meet: 1..10 and 5..20 give 5..10, and ranges that don't meet give opt.NONE.
fn range.overlap<T: ordered>(a: range<T>, b: range<T>): opt<range<T>> {
    let low: opt<T> = later_bound(a.low(), b.low());
    let high: opt<T> = earlier_bound(a.high(), b.high());
    if (let l: T = low) {
        if (let h: T = high) {
            if (h < l) {
                return opt.NONE;
            }
            return l..h;
        }
        return l...;
    }
    if (let h: T = high) {
        return ...h;
    }
    return opt.NONE;                            // never reached: a range always has a bound
}

//@about The smallest range that holds both: 1..3 and 7..9 give 1..9. A side open in either is open in it.
fn range.span<T: ordered>(a: range<T>, b: range<T>): range<T> {
    mut low: opt<T> = opt.NONE;
    mut high: opt<T> = opt.NONE;
    if (let x: T = a.low()) {
        if (let y: T = b.low()) {
            low = x.min(y);
        }
    }
    if (let x: T = a.high()) {
        if (let y: T = b.high()) {
            high = x.max(y);
        }
    }
    if (let l: T = low) {
        if (let h: T = high) {
            return l..h;
        }
        return l...;
    }
    if (let h: T = high) {
        return ...h;
    }
    return a;                                   // 1... and ...3 hold every value together, which no range does
}

// the later of two bounds, where a missing one is open. Private to core
fn later_bound<T: ordered>(a: opt<T>, b: opt<T>): opt<T> {
    if (let x: T = a) {
        if (let y: T = b) {
            return x.max(y);
        }
        return x;
    }
    return b;
}

// the earlier of two bounds, where a missing one is open. Private to core
fn earlier_bound<T: ordered>(a: opt<T>, b: opt<T>): opt<T> {
    if (let x: T = a) {
        if (let y: T = b) {
            return x.min(y);
        }
        return x;
    }
    return b;
}
```

These are fns on the type, with no `self`, so they are called on it: `range.negate(1..10)`. Their results have no `step`.

#### list

```java
package core;

fn list<T>.some(self, test: fn(item: T): bool): bool {
    for (x in self) {
        if (test(x)) {
            return true;
        }
    }
    return false;
}

fn list<T>.all(self, test: fn(item: T): bool): bool {
    for (x in self) {
        if (!test(x)) {
            return false;
        }
    }
    return true;
}

fn list<T>.count(self, test: fn(item: T): bool): int {
    mut n: int = 0;
    for (x in self) {
        if (test(x)) {
            n = n + 1;
        }
    }
    return n;
}

fn list<T>.find(self, test: fn(item: T): bool): opt<T> {
    for (x in self) {
        if (test(x)) {
            return opt.SOME(x);
        }
    }
    return opt.NONE;
}

fn list<T>.filter(self, keep: fn(item: T): bool): list<T> {
    mut out: list<T> = [];
    for (x in self) {
        if (keep(x)) {
            out.add(x);
        }
    }
    return out;
}

fn list<T>.map<U>(self, f: fn(item: T): U): list<U> {
    mut out: list<U> = [];
    for (x in self) {
        out.add(f(x));
    }
    return out;
}

fn list<T>.remove_where(mut self, test: fn(item: T): bool) {
    self = self.filter(fn(x) { return !test(x); });
}

fn list<T>.first(self): opt<T> {
    return self.at(0);
}

fn list<T>.last(self): opt<T> {
    return self.at(self.len() - 1);
}

fn list<T>.reversed(self): list<T> {
    mut out: list<T> = [];
    for (x in self) {
        out.insert(0, x);
    }
    return out;
}

// a bound on the list's type: has exists only for items that fit same
fn list<T: same>.has(self, x: T): bool {
    return self.some(fn(y) { return y == x; });
}

fn list<T: same>.position(self, x: T): opt<number> {
    for (k, y in self) {
        if (y == x) {
            return opt.SOME(k);
        }
    }
    return opt.NONE;
}

fn list<T: same>.unique(self): list<T> {
    mut out: list<T> = [];
    for (x in self) {
        if (!out.has(x)) {
            out.add(x);
        }
    }
    return out;
}

fn list<T: ordered>.sorted(self): list<T> {
    mut out: list<T> = self;
    out.sort();
    return out;
}

fn list<T: shown>.join(self, between: text): text {
    mut out: text = "";
    for (k, x in self) {
        out = k == 0 ? "\{x}" : "\{out}\{between}\{x}";
    }
    return out;
}

// opt.NONE for an empty list
fn list<T: numeric>.sum(self): opt<T> {
    mut total: opt<T> = opt.NONE;
    for (x in self) {
        match (total) {
            case opt.SOME(s) {
                total = opt.SOME(s + x);
            }
            case opt.NONE {
                total = opt.SOME(x);
            }
        }
    }
    return total;
}
```

#### text

```java
package core;

fn text.starts(self, part: text): bool {
    return self.slice(0, part.len()) == part;
}

fn text.ends(self, part: text): bool {
    let start: int = self.len() - part.len();
    // start is worked out, so it has to be proved before slice takes it
    if (start in 0...) {
        return self.slice(start, part.len()) == part;
    }
    return false;
}

//@about The same text, ignoring case and the spaces around it.
fn text.like(self, other: text): bool {
    return self.trim().lower() == other.trim().lower();
}

fn text.replace(self, old: text[1...], new: text): text {
    return self.split(old).join(new);
}
```

#### tokens

A token type is an enum: its cases, `==` and `match` follow the enum rules, and each case stands for a value of the type after the colon. The values are written only in a `tokens` block, so a colour or a spacing written out anywhere else is a compile error. A case is accepted where its value's type is wanted, `let px: number = space.M;`, and a record value's fields pass straight through it: `color.INK.light`, `font.BODY.size`.

```java
package core;

//@about The value of a colour token: one colour for each theme.
record color_value {
    light: text[7..9];
    dark: text[7..9];

    require "a colour is # and six or eight hex digits" {
        return hex(light) && hex(dark);
    }
}

//@about The value of a font token.
record font_value {
    family: text[1...];
    size: number 1...;
    weight: int 100..900;
    line: number 1..3 = 1.5;
}

//@about The value of a shadow token.
record shadow_value {
    x: number = 0;
    y: number = 0;
    blur: number 0...;
    tone: color;
}

// # and six or eight hex digits. Private to core
fn hex(value: text): bool {
    let digits: list<text[1]> = value.slice(1, 8).lower().chars();
    return value.starts("#") && value.len() != 8 && digits.all(fn(c) { return "0123456789abcdef".has(c); });
}

token color: color_value { SURFACE, INK, MUTED, LINE, ACCENT, INFO, OK, WARN, BAD, C1, C2, C3, C4, C5, C6, SHADOW }
token space: number 0... { XS, S, M, L, XL }
token size: number 0... { XS, S, M, L }
token radius: number 0... { CARD, PILL }
token font: font_value { BODY, HEADING, MONO }
token shadow: shadow_value { RAISED }
token stroke: number 0.25..16 implements literal<number> { HAIRLINE, THIN, BOLD, PX(px: number 0.25..16) }

//@about A plain number where a stroke is wanted: width = 2.5 is stroke.PX(2.5).
fn stroke.from(value: number): opt<stroke> {
    return try stroke.PX(value);
}

tokens core {
    color.SURFACE = color_value { light = "#ffffff", dark = "#15171a" };
    color.INK = color_value { light = "#1a1c1f", dark = "#eceef1" };
    color.MUTED = color_value { light = "#6b7280", dark = "#9aa3ae" };
    color.LINE = color_value { light = "#d4d7dc", dark = "#3a3f46" };
    color.ACCENT = color_value { light = "#2563eb", dark = "#7aa7ff" };
    color.INFO = color_value { light = "#0284c7", dark = "#38bdf8" };
    color.OK = color_value { light = "#15803d", dark = "#4ade80" };
    color.WARN = color_value { light = "#b45309", dark = "#fbbf24" };
    color.BAD = color_value { light = "#dc2626", dark = "#f87171" };
    color.C1 = color_value { light = "#2563eb", dark = "#7aa7ff" };
    color.C2 = color_value { light = "#0d9488", dark = "#2dd4bf" };
    color.C3 = color_value { light = "#d97706", dark = "#fbbf24" };
    color.C4 = color_value { light = "#7c3aed", dark = "#c4b5fd" };
    color.C5 = color_value { light = "#db2777", dark = "#f9a8d4" };
    color.C6 = color_value { light = "#475569", dark = "#cbd5e1" };
    color.SHADOW = color_value { light = "#0000001f", dark = "#0000001f" };

    space.XS = 2;
    space.S = 4;
    space.M = 8;
    space.L = 16;
    space.XL = 32;

    size.XS = 8;
    size.S = 160;
    size.M = 320;
    size.L = 480;

    radius.CARD = 8;
    radius.PILL = 999;

    font.BODY = font_value { family = "system-ui, sans-serif", size = 16, weight = 400 };
    font.HEADING = font_value { family = "system-ui, sans-serif", size = 22, weight = 650, line = 1.25 };
    font.MONO = font_value { family = "ui-monospace, monospace", size = 14, weight = 400, line = 1.45 };

    shadow.RAISED = shadow_value { y = 1, blur = 3, tone = color.SHADOW };

    stroke.HAIRLINE = 0.5;
    stroke.THIN = 1;
    stroke.BOLD = 2;
}
```

These are the default values. `C1` to `C6` are for chart series, and `SHADOW` is the tone of `shadow.RAISED`. An implementer gives them its own look in its own `tokens` block, and the names can't change. Page 6 has the rules.

- **`stroke` takes a plain number too**, for drawing on a canvas or a plane, where the named strokes are the convention. Its case `PX` carries a width and stands for it, so it needs no line in a `tokens` block, and `stroke.from` makes it: `width = 2.5` is `stroke.PX(2.5)`. The page's colours, spacing and sizes take named cases only.
- **Tokens compare as cases.** `color.OK != color.ACCENT`, even where a theme gives them one value, and `stroke.PX(2) != stroke.BOLD`. To compare values, take them out first: for a `stroke` called `w`, `let a: number = w;` and `let b: number = stroke.BOLD;`, then `a == b`.
- **Open.** A pack adds a case by giving it a value in its own `tokens` block, so a `match` on a token needs `case else`.

#### options

```java
package core;

enum align { START, CENTER, END, STRETCH, BASELINE }
enum justify { START, CENTER, END, BETWEEN, AROUND }
enum weight { REGULAR, MEDIUM, BOLD }
enum text_size { SMALL, NORMAL, LARGE }
enum press_kind { BUTTON, TAB, OPTION, TOGGLE, SWITCH, CHECK, RADIO, PLAIN }
enum edge { ALL, TOP, RIGHT, BOTTOM, LEFT, X, Y }
enum overlay_mode { POPOVER, TOOLTIP, DIALOG, MENU }
enum axis { X, Y }
enum anchor { CENTER, N, S, E, W, NE, NW, SE, SW }
enum head { NONE, ARROW, DOT }
enum width { NARROW, MEDIUM, WIDE }
enum theme { LIGHT, DARK }

//@about The theme in words, as a hole shows it: `light` or `dark`.
fn theme.show(self): text {
    match (self) {
        case theme.LIGHT {
            return "light";
        }
        case theme.DARK {
            return "dark";
        }
    }
}

enum track {
    AUTO,
    FR(share: int 1...),
    CH(count: int 1...),
    SIZE(of: size),
}

enum cols {
    EQUAL(count: int 1..12),
    TRACKS(of: list<track>[1...]),
}

//@about A symbol from a fixed set, drawn in the implementer's own icon style.
enum glyph {
    PLAY, PAUSE, PREV, NEXT, MORE, LESS, FIRST, LAST, RESET, CHECK, CROSS, PLUS, MINUS,
    UP, DOWN, LEFT, RIGHT, BAN, ALERT, INFO, HELP, LOCK, UNLOCK, EYE, EDIT, SEARCH,
    USER, USERS, FILE, FOLDER, DATABASE, SERVER, CLOUD, MAIL, CLOCK, CALENDAR, FLAG,
    TARGET, GAUGE, LAYERS, BRANCH, BOX, SQUARE, CIRCLE, DOT, STAR, BOLT, LINK, KEY,
    SHIELD, CART, CHART, CODE, TERMINAL, BELL, HOME, SETTINGS, SLIDERS, TRASH, COPY,
    DOWNLOAD, UPLOAD, EXPAND, LIGHTBULB, BOOK,
}
```

These are ordinary enums, so `match` on any of them has to cover every case. Tokens are open, which is why a `match` on one needs `case else`. `theme` fits shown, through its `show`, so a page can say which theme it is drawn in: `\{$state.theme}` in prose shows `light` or `dark`.

#### page

```java
package core;

//@about What the app tells Extended Mark about the page being read.
extern page {
    width: width = width.WIDE;
    theme: theme = theme.LIGHT;
    today: date = "1970-01-01";
    now: moment = "1970-01-01T00:00+00:00";      // the app's clock
}
```

`page` is an `extern` block like the ones on page 6. The defaults are what a target that supplies nothing gets.

#### migrations

The statements a migration is written with (page 6), and the fns it decides with. They run only when migrating, never on a page. Where a parameter takes a name, it is the name of something in the version the migration starts from, except `to` and `parent`, which name something in the version it moves to.

| Statement | Parameters | Written as |
|---|---|---|
| `rename` | `input`, `slot`, `field`, `arg` or `from`; `to`; `why` | extern |
| `move` | `from`, `to`, `why` | extern |
| `set` | `input`, `field` or `arg`; `value`, `when`, `why` | extern |
| `drop` | `input`, `slot`, `field` or `arg`, or none for the declaration; `why` | extern |
| `wrap` | `parent`, `why` | extern |
| `notify` | `input`, `why`, `when` | extern |
| `add` | `input`, `field` or `arg`; `value`, `why` | a migration fn: a `set` for a member the old version didn't have |
| `nest` | `inputs`, `into`, `why` | a migration fn: a `move` of each input into the record input, field by field and by name |
| `flatten` | `input`, `why` | a migration fn: a `move` of each of the record's fields out to the input of its name |
| `split` | `from`, `to`, `why` | a migration fn: each use of the case is asked about, with the cases it may become |
| `example` | `before`, `after` | extern: a test the compiler runs |

`given(name)` says whether the use wrote a member. `ask(why, options)` is a choice about one use, and `confirm(why)` one yes or no for the whole migration, both made by whoever migrates.

#### widgets

Twenty-three widgets are extern: ten are Markdown's own blocks, so every implementer draws Markdown natively, and thirteen are what Extended Mark can't express in terms of the others. Seven more belong to the optional `core.gfx` level. The other thirteen are written in Extended Mark below, from the extern ones, so an implementer draws only the twenty-three, and the seven for `core.gfx`.

| Extern | Widgets | What Extended Mark can't do itself |
|---|---|---|
| Layout | `flex`, `grid`, `cell`, `sizing`, `plane`, `spot` | Lay children along one axis with wrapping; line columns up across rows; place a child in a grid; say how big a child is; place any widget anywhere on a plane the reader can pan and zoom, and say where it landed |
| Markdown blocks | `paragraph`, `heading`, `bullets`, `item`, `quote`, `code`, `math`, `table`, `footnote`, `divider` | Markdown's own blocks, drawn natively, with inline Markdown already parsed into `rich_text` |
| Drawing | `label`, `image`, `icon` | Draw plain text, a picture, and a glyph from the implementer's set |
| Input | `press`, `field`, `slider` | Being clicked, typed into and dragged |
| Above the page | `overlay` | Content outside the layout: popovers, tooltips, dialogs and menus |
| `core.gfx` only | `canvas`, `layer`, `circle`, `path`, `place`, `handle`, `shade` | Drawing on a surface, and pixels a shader works out |

#### widgets: extern layout

```java
package core;

//@about Children along one axis, wrapping onto new lines when wrap is true.
extern widget flex(
    axis: axis = axis.Y,
    wrap: bool = false,
    align: align = align.STRETCH,
    justify: justify = justify.START,
    gap: opt<space> = opt.NONE,
    pad: opt<space> = opt.NONE,
    fill: opt<color> = opt.NONE,
    stroke: opt<color> = opt.NONE,
    edge: edge = edge.ALL,
    radius: opt<radius> = opt.NONE,
    shadow: opt<shadow> = opt.NONE,
    label: text = "",
) {
    slot children: view;
    event click();

    markdown {
        \{children}
    }
}

//@about Children in columns that line up across rows.
extern widget grid(
    cols: cols,
    align: align = align.STRETCH,
    justify: justify = justify.START,
    gap: opt<space> = opt.NONE,
    pad: opt<space> = opt.NONE,
    fill: opt<color> = opt.NONE,
    stroke: opt<color> = opt.NONE,
    edge: edge = edge.ALL,
    radius: opt<radius> = opt.NONE,
    shadow: opt<shadow> = opt.NONE,
) {
    slot children: view;
    event click();

    markdown {
        \{children}
    }
}

//@about Where a child sits in a grid. Several children may share one cell.
extern widget cell(
    span: int 1..12 = 1,
    row: opt<int 1...> = opt.NONE,
    col: opt<int 1...> = opt.NONE,
    place: opt<align> = opt.NONE,
) {
    slot child: view;

    markdown {
        \{child}
    }
}

//@about How big a child is, for implementers. Authors use grow, shrink, basis, min_size, max_size and aspect.
extern widget sizing(
    grow: opt<number 0...> = opt.NONE,
    shrink: opt<number 0...> = opt.NONE,
    basis: opt<size> = opt.NONE,
    min_width: opt<size> = opt.NONE,
    min_height: opt<size> = opt.NONE,
    max_width: opt<size> = opt.NONE,
    max_height: opt<size> = opt.NONE,
    aspect: opt<number 0.1..10> = opt.NONE,
) {
    slot child: view;

    markdown {
        \{child}
    }
}

//@about Widgets placed anywhere on a plane with coordinates of its own: x from left to right, y from bottom to top.
//@about It draws the part of the plane around center, as big as the widget is on the page.
extern widget plane(
    label: text,                                    // what it shows, for screen readers and Markdown
    bounds: opt<region> = opt.NONE,                 // the whole plane; left out, the region around every spot's box
    mut center: point = point { x = 0, y = 0 },     // the middle of what is drawn, kept inside bounds; the caller may keep it
    mut zoom: number 0.1..10 = 1,                   // at 1, one unit is one of the page's own lengths; the caller may keep it
    zoom_range: range<number> = 1..1,               // how far the reader may zoom; 1..1 means not at all
    fit: bool = false,                              // start zoomed so the whole of bounds fits; zoom_range counts from there
    mut drawn: opt<region> = opt.NONE,              // written by the target: the part of the plane being drawn
    width: opt<size> = opt.NONE,                    // left out, the width it is given, like a column
    aspect: number 0.1..10 = 1.5,                   // the drawn area's width over its height
) {
    slot background: list<layer>;                   // core.gfx: drawn under the spots, in the plane's units
    slot items: list<spot>;
    event click(at: point);                         // a click on empty space, in the plane's units

    markdown {
        \{label}

        @for (p in items) {
            \{p}
        }
    }
}

//@about Any widget at a point of a plane, as cell places a child in a grid. anchor says which part of it sits on the point.
//@about After each layout, it writes where it landed to box.
extern widget spot(
    at: point,
    anchor: anchor = anchor.CENTER,
    nudge: point = point { x = 0, y = 0 },          // by the page's own lengths, y up
    mut box: opt<region> = opt.NONE,                // written by the target: from the bottom-left corner to the top-right one
) {
    slot child: view;

    markdown {
        \{child}
    }
}
```

- **The plane's unit.** At zoom 1, one unit of a plane is one of the page's own lengths (a CSS pixel, an Android dp), so a widget on a plane is the size it is anywhere else, and its box never depends on the plane's size. `fit` starts the plane zoomed so the whole of `bounds` fits.
- **Bounds.** A region; left out, the region around every spot's box, worked out after layout. Nothing outside it is drawn, and the reader can't pan past it. A spot outside the bounds is a warning: at compile time when both are constants, and otherwise reported to the app when the page runs, not as a failure, and clipped.
- **The centre** is kept where the drawn area stays inside the bounds, and is their middle where they are smaller than it. A centre that had to be moved is written back to the caller's variable.
- **Moving around** needs `core.live`: dragging pans, and pinching or scrolling zooms, within `zoom_range`, whose default `1..1` doesn't zoom. Without `core.live`, the plane is drawn where its centre puts it and doesn't move.
- **What is reported.** Each spot's `box`, in the plane's units, so panning and zooming never change it: it changes only when the widget's own size does. And the plane's `drawn` region, written as the reader moves, as `center` is. What is in view is worked out in Extended Mark: `box.overlaps(drawn)`. The boxes of one layout are written as one change, and writing the value a variable already has is no change. A layout that keeps changing is stopped after a fixed number of passes, and is a failure of the plane.
- **The background** (`core.gfx`) is canvas layers in the plane's units, under the spots, moving and scaling with the plane. It is vector only; pixels come through `shade`.
- **Its Markdown** is its label, then each spot's Markdown in order.

#### widgets: extern Markdown blocks

```java
package core;

//@about A paragraph of inline Markdown, parsed by core.
extern widget paragraph(value: rich_text, tone: opt<color> = opt.NONE, align: align = align.START);

//@about A heading, level 1 to 6.
extern widget heading(level: int 1..6, value: rich_text);

//@about A list: bulleted, or numbered from start.
extern widget bullets(ordered: bool = false, start: int 0... = 1) {
    slot items: list<item>[1...];
}

//@about One item of a list. done is a task box: ticked, not ticked, or none for an ordinary item.
extern widget item(done: opt<bool> = opt.NONE) {
    slot body: view;
}

//@about A quotation.
extern widget quote() {
    slot body: view;
}

//@about A block of literal text, such as code, in the mono font.
extern widget code(src: text, lang: text = "");

//@about Maths on a line of its own, drawn from TeX.
extern widget math(tex: latex);

//@about A table: a header row, rows of cells, and how each column is aligned.
extern widget table(head: list<rich_text>[1...], rows: list<list<rich_text>>, align: list<cell_align> = []);

//@about A note at the foot of the page, with its mark.
extern widget footnote(mark: text) {
    slot body: view;
}

//@about A line across the page.
extern widget divider();

//@about How a table column is aligned. A column the list doesn't reach starts.
enum cell_align { START, CENTER, END }
```

- **Markdown's own blocks are extern.** Every implementer draws them natively, which is what makes Extended Mark a superset of Markdown: a document is Markdown first, and Extended Mark lowers onto the same blocks. They have no `markdown` block, because they are Markdown blocks themselves. Every implementer, a Markdown-only one included, writes each out as the block it stands for, with the spellings page 1 gives.
- **Inline Markdown arrives parsed.** A paragraph, a heading and a table cell take `rich_text`: segments of text, code spans, maths, pictures, footnote marks and line breaks, each with its marks. Core parses it, in Extended Mark, with `rich_text.from`, so an implementer draws the segments and never parses Markdown. A hole's value is a `TEXT` segment, so it can never turn into formatting.
- **From code**, a text literal where `rich_text` is wanted goes to `rich_text.from` as a template, holes included: `@paragraph(value = "Read **this**, \{name}.");`. A value from a variable goes through `rich_text.plain(entry)`, which keeps it as plain text, or through `rich_text.from(template.of(entry))`, which reads it as Markdown and gives an `opt`.
- **Blocks from code** are an `md` value, drawn with `@blocks(value = note);` (below). Each block is drawn by the extern block of its kind.

#### widgets: extern drawing, input and overlay

```java
package core;

//@about A plain text value.
extern widget label(
    value: text,
    tone: opt<color> = opt.NONE,
    size: text_size = text_size.NORMAL,
    weight: weight = weight.REGULAR,
    font: opt<font> = opt.NONE,
    align: align = align.START,
    wrap: bool = true,
    clip: bool = false,
    halo: bool = false,                         // an outline in the surface colour, so it reads over lines
) {
    markdown {
        \{value}
    }
}

//@about A picture.
extern widget image(src: text, alt: text, width: opt<size> = opt.NONE) {
    markdown {
        ![\{alt}](\{src})
    }
}

//@about A symbol from a fixed set.
extern widget icon(
    name: glyph,
    tone: opt<color> = opt.NONE,
    size: text_size = text_size.NORMAL,
    label: text = "",
) {
    markdown {
        \{label}
    }
}

//@about Something to press. With no content it shows its label.
extern widget press(
    label: text,
    kind: press_kind = press_kind.BUTTON,
    selected: bool = false,
    disabled: bool = false,
    tone: opt<color> = opt.NONE,
) {
    slot content: opt<view>;
    event click();

    markdown {
        \{label}
    }
}

//@about Text typed by the reader.
extern widget field(
    mut value: text,
    label: text,
    placeholder: text = "",
    lines: int 1..20 = 1,
) {
    event submit();

    markdown {
        \{label}: \{value}
    }
}

//@about A number picked by dragging. Its ends come from range when it is given, and otherwise, with its step, from the variable it is given.
extern widget slider(mut value: number, label: text, range: opt<range<number>> = opt.NONE, disabled: bool = false) {
    markdown {
        \{label}: \{value}
    }
}

//@about Content shown over the page, opened from its anchor. Pass open to keep it with the caller.
extern widget overlay(label: text, mode: overlay_mode = overlay_mode.POPOVER, mut open: bool = false) {
    slot anchor: view;
    slot body: view;
    event open_changed();

    markdown {
        \{anchor}

        \{body}
    }
}
```

**Shared values at the edge.** A `mut` input of an `extern` widget, such as `slider`'s `value`, accepts a variable with any contract of the declared type. The implementer may read that contract, which is where a slider gets its step, and its ends when no `range` is given, and the runtime refuses any value the widget writes that is outside it. Given a `range`, the slider's ends come from it and a drag outside it is refused, so its ends can follow another value: `range = 0..($state.high)`. A variable with no range and no `range` gives a slider from 0 to 1. This is the one case where a wider contract is accepted, and it is allowed because the app boundary is checked at run time anyway.

**Inputs a caller may keep.** `overlay`'s `open`, and `plane`'s `center` and `zoom`, are `mut` inputs with a default: given a variable, the caller keeps the value; left out, the widget keeps it itself. In a loop, rows follow their items, so a widget's own value stays with its item (page 3). `plane`'s `drawn` and `spot`'s `box` are written by the target, so a caller gives them a variable to read.

#### widgets: core.gfx

```java
package core;

//@about A drawing surface with coordinates of its own: x from left to right, y from bottom to top.
extern widget canvas(
    label: text,                                // what it shows, for screen readers and Markdown
    x: range<number> = -1..1,
    y: range<number> = -1..1,
    width: size = size.M,
    aspect: opt<number 0.1..10> = opt.NONE,     // width over height; left out, from the two ranges
) {
    slot layers: list<layer>[1...];
    event click(at: point);                     // a click on empty space, in the canvas's units

    markdown {
        \{label}
    }
}

//@about Shapes drawn together, in the order written. Later layers are drawn on top.
extern widget layer(opacity: number 0..1 = 1, clip: opt<region> = opt.NONE) {
    slot shapes: list<any shape>;

    // writes nothing: the canvas or plane around it writes what the picture shows
    markdown { }
}

//@about What every shape has: a label for screen readers, and an opacity. A shape call that sets an event must give a label.
widget interface shape {
    label: text;
    opacity: number 0..1;
}

//@about A circle around a point, r in the units of its canvas or plane.
extern widget circle(
    at: point,
    r: number 0...,
    fill: opt<color> = opt.NONE,
    stroke: opt<color> = opt.NONE,
    width: stroke = stroke.THIN,                // the stroke's width: a stroke token, or a plain number of pixels
    opacity: number 0..1 = 1,
    label: text = "",
) implements shape {
    event click();
    event enter();
    event leave();

    markdown { }
}

//@about A line through points; closed, it is a polygon and can be filled.
extern widget path(
    points: list<point>[2...],
    closed: bool = false,
    fill: opt<color> = opt.NONE,
    stroke: opt<color> = color.INK,
    width: stroke = stroke.THIN,
    dash: bool = false,
    head: head = head.NONE,                     // an arrow or a dot at the last point
    opacity: number 0..1 = 1,
    label: text = "",
) implements shape {
    event click();
    event enter();
    event leave();

    markdown { }
}

//@about Ordinary widgets placed at a point of the canvas: a label, an image, anything. nudge moves them by pixels, with y up like the canvas.
extern widget place(
    at: point,
    anchor: anchor = anchor.CENTER,
    nudge: point = point { x = 0, y = 0 },
    opacity: number 0..1 = 1,
    label: text = "",
) implements shape {
    slot child: view;

    markdown { }
}

//@about A point the reader drags. It writes where it is to the variable it is given.
extern widget handle(mut at: point, tone: opt<color> = opt.NONE, opacity: number 0..1 = 1, label: text) implements shape {
    markdown { }
}

//@about A colour a shader works out for one pixel. Its channels go from 0 to 1.
record pixel {
    r: number 0..1;
    g: number 0..1;
    b: number 0..1;
    a: number 0..1 = 1;
}

//@about Fills an area with the colour a shader works out for each pixel: at is the pixel's middle,
//@about in the units of the canvas or plane, and px is one pixel's size in those units.
extern widget shade<A>(
    area: region,
    shader: fn(at: point, px: number, args: A): pixel,
    args: A,
    opacity: number 0..1 = 1,
    label: text,
) implements shape {
    markdown { }
}

//@about The four corners of a rectangle, for a path.
fn rect(x0: number, y0: number, x1: number, y1: number): list<point>[4] {
    return [point { x = x0, y = y0 }, point { x = x1, y = y0 }, point { x = x1, y = y1 }, point { x = x0, y = y1 }];
}
```

- **Shapes write no Markdown of their own.** `layer`, `circle`, `path`, `place`, `handle` and `shade` have an empty `markdown { }`, and the canvas, or the plane, around them writes what the picture shows.
- **Positions, radii and nudges are plain numbers**, on a canvas and on a plane: they say where things are drawn, not how the page looks, so they take no tokens. A stroke's `width` takes a `stroke`: a named one by convention, or a plain number.
- **A shader** is an extern fn with a return type (page 6). Declared in a document's `extern` block, the app supplies it; declared in a pack, the pack does, for each target it supports. The target runs it for every pixel of `area`, natively.
- **`args`** is given once and handed to the shader as uniforms: numbers, points, colours (a colour token goes in as the theme's current value) and bools.
- **`pixel`'s colours are its own**, like an `image`'s. The page's colours still take tokens only.
- **An Extended Mark fn fits the type too.** The runtime calls it for each pixel within the step limit, so only small areas fit, and the compiler warns.
- **A shader nobody supplies** draws nothing, and is reported when the page is mounted.

#### widgets: written in Extended Mark

```java
package core;

//@about Takes a share of the spare room in a row or column.
widget grow(by: number 0... = 1) {
    slot child: view;

    view {
        @sizing(grow = by) {
            @child;
        }
    }

    markdown {
        \{child}
    }
}

//@about How much it gives up when there isn't room. 0 never shrinks.
widget shrink(by: number 0... = 1) {
    slot child: view;

    view {
        @sizing(shrink = by) {
            @child;
        }
    }

    markdown {
        \{child}
    }
}

//@about The size it starts from, before growing or shrinking.
widget basis(size: size) {
    slot child: view;

    view {
        @sizing(basis = size) {
            @child;
        }
    }

    markdown {
        \{child}
    }
}

//@about Its smallest width and height.
widget min_size(width: opt<size> = opt.NONE, height: opt<size> = opt.NONE) {
    slot child: view;

    view {
        @sizing(min_width = width, min_height = height) {
            @child;
        }
    }

    markdown {
        \{child}
    }
}

//@about Its largest width and height.
widget max_size(width: opt<size> = opt.NONE, height: opt<size> = opt.NONE) {
    slot child: view;

    view {
        @sizing(max_width = width, max_height = height) {
            @child;
        }
    }

    markdown {
        \{child}
    }
}

//@about Its shape: width divided by height.
widget aspect(ratio: number 0.1..10) {
    slot child: view;

    view {
        @sizing(aspect = ratio) {
            @child;
        }
    }

    markdown {
        \{child}
    }
}

//@about Children one below another.
widget column(
    align: align = align.STRETCH,
    justify: justify = justify.START,
    gap: opt<space> = opt.NONE,
    pad: opt<space> = opt.NONE,
    fill: opt<color> = opt.NONE,
    stroke: opt<color> = opt.NONE,
    edge: edge = edge.ALL,
    radius: opt<radius> = opt.NONE,
    shadow: opt<shadow> = opt.NONE,
) {
    slot children: view;
    event click();

    view {
        @flex(axis = axis.Y, align = align, justify = justify, gap = gap, pad = pad, fill = fill, stroke = stroke, edge = edge, radius = radius, shadow = shadow, click = fn() { invoke click(); }) {
            @children;
        }
    }

    markdown {
        \{children}
    }
}

//@about Children side by side, wrapping when there is no room.
widget row(
    align: align = align.STRETCH,
    justify: justify = justify.START,
    gap: opt<space> = opt.NONE,
    pad: opt<space> = opt.NONE,
    fill: opt<color> = opt.NONE,
    stroke: opt<color> = opt.NONE,
    edge: edge = edge.ALL,
    radius: opt<radius> = opt.NONE,
    shadow: opt<shadow> = opt.NONE,
    wrap: bool = true,
) {
    slot children: view;
    event click();

    view {
        @flex(axis = axis.X, wrap = wrap, align = align, justify = justify, gap = gap, pad = pad, fill = fill, stroke = stroke, edge = edge, radius = radius, shadow = shadow, click = fn() { invoke click(); }) {
            @children;
        }
    }

    markdown {
        \{children}
    }
}

//@about Children on top of each other, the last one in front: a grid with every child in one cell.
widget stack(align: align = align.CENTER, justify: justify = justify.CENTER, pad: opt<space> = opt.NONE) {
    slot children: list<view>;

    view {
        @grid(cols = cols.EQUAL(1), align = align, justify = justify, pad = pad) {
            for (c in children) {
                @cell(row = 1, col = 1) {
                    @c;
                }
            }
        }
    }

    markdown {
        @for (c in children) {
            \{c}
        }
    }
}

//@about How much of something, as a bar.
widget meter(value: number 0..., label: text, max: number 0... = 100, tone: opt<color> = opt.NONE) {
    view {
        @flex(axis = axis.X, fill = color.LINE, radius = radius.PILL, label = label) {
            @grow(by = value.clamp(0, max)) {
                @min_size(height = size.XS) {
                    @flex(fill = tone.or(color.ACCENT), radius = radius.PILL) { }
                }
            }
            @grow(by = (max - value).clamp(0, max)) {     // the same share as max - value.clamp(0, max)
                @flex { }
            }
        }
    }

    markdown {
        \{label}: \{value} of \{max}
    }
}

//@about A titled shell around content, with room for actions.
widget frame(title: text = "", height: opt<size> = opt.NONE) {
    slot body: view;
    slot actions: opt<view>;

    view {
        @column(gap = space.S, pad = space.M, stroke = color.LINE, radius = radius.CARD) {
            @row(justify = justify.BETWEEN, align = align.CENTER) {
                @label(value = title, weight = weight.BOLD);
                if (let a: view = actions) {
                    @a;
                }
            }
            @min_size(height = height) {
                @body;
            }
        }
    }

    markdown {
        **\{title}**

        \{body}
    }
}

//@about A plain titled section, with a note and an optional footer.
widget pane(title: text = "", note: text = "") {
    slot body: view;
    slot footer: opt<view>;

    view {
        @column(gap = space.S) {
            @label(value = title, weight = weight.BOLD);
            @label(value = note, size = text_size.SMALL, tone = color.MUTED);
            @body;
            if (let f: view = footer) {
                @f;
            }
        }
    }

    markdown {
        **\{title}**

        \{body}
    }
}

// one block of an md value, as the extern block of its kind. Private to core
fn block_view(b: block): view {
    match (b) {
        case block.PARAGRAPH(words) {
            return @paragraph(value = words);
        }
        case block.HEADING(level, words) {
            return @heading(level = level, value = words);
        }
        case block.BULLETS(ordered, start, items) {
            return @bullets(ordered = ordered, start = start) {
                for (it in items) {
                    @item(done = it.done) {
                        @blocks(value = md { blocks = it.body });
                    }
                }
            };
        }
        case block.QUOTE(body) {
            return @quote {
                @blocks(value = md { blocks = body });
            };
        }
        case block.CODE(src, lang) {
            return @code(src = src, lang = lang);
        }
        case block.MATH(tex) {
            return @math(tex = tex);
        }
        case block.TABLE(head, rows, align) {
            return @table(head = head, rows = rows, align = align);
        }
        case block.FOOTNOTE(mark, body) {
            return @footnote(mark = mark) {
                @blocks(value = md { blocks = body });
            };
        }
        case block.DIVIDER {
            return @divider;
        }
    }
}

//@about The blocks of an md value, each drawn by the extern Markdown block of its kind.
widget blocks(value: md) {
    view {
        for (b in value.blocks) {
            @block_view(b);
        }
    }

    markdown {
        @for (b in value.blocks) {
            \{@block_view(b)}
        }
    }
}
```

- **Sizing wrappers nest in any order and mean the same.** A chain of `sizing` around one child is folded into one set of properties on that child, so `@grow { @min_size(…) { … } }` and the other way round are equal. Setting one property twice in a chain is a compile error. A child with no wrapper doesn't grow, shrinks by 1, and starts from its own size, as in CSS.
- **Built in**: The eight types the syntax makes, and the syntax itself: literals, operators, holes, prose and `@`.
- **core, declared extern with no body**: the 61 native fns: list storage, Unicode text, exact numbers with their maths, the interface fns of `number`, `duration`, `text` and `bool`, a range's ends and step, a duration in milliseconds, and `clamp`.
- **core, written in Extended Mark**: the six interfaces, `int`, point, region, map, date, moment, template, latex, md, rich_text, the tokens and options, the thirteen widgets above, and 30 fns built from the native ones: or, min, max, some, all, count, find, filter, map, remove_where, first, last, reversed, has, position, unique, sorted, join, sum, starts, ends, like, replace, the range helpers negate, shift, scale, widen, overlap and span, and `rect` for canvas paths.
- **core, supplied by the implementer**: the native fns, page values, `moment.local`, `can_draw_tex` if it replaces the default, and the drawing of the 23 extern widgets (and 7 more for `core.gfx`), marked extern. Extern is only for what Extended Mark can never do on its own, and for Markdown's own blocks.
- **A pack's own types**: Join the syntax by fitting shown, same, ordered, numeric, scaled or literal&lt;T>. They can't add new symbols, on purpose.

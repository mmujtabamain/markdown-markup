# The standard library

Page 5 of 9. What is built in, and all of `core`: types, lists, text, dates and moments, maths and Markdown, tokens, options, `page` and the 40 base widgets.

MKP has a small built-in layer and a library for the rest. Built in is what the syntax itself makes: a number literal has to be some type, and so do `"…"`, `[a, b]`, `a..b` and `@name(…)`. Those types, and the operations an implementer has to do natively anyway, are built in. Everything that can be written in MKP is in `core`, a pack imported by every file without saying so, along with the look: tokens, options, `page` and the base widgets.

| | |
|---|---|
| Built-in types | **8** |
| Built-in interfaces | **6** (shown, same, ordered, numeric, scaled, literal&lt;t>) |
| Built-in fns | **43** |
| core fns written in MKP | **24** |
| Base widgets | **41** (21 extern, 8 more in core.gfx, 12 written in MKP) |

### Built in

These are part of the language and aren't declared in any file. They are listed here as signatures, with every type written.

```txt
types        number  bool  text  duration  list<T>  opt<T>  range<T>  view
interfaces   shown  same  ordered  numeric  scaled  literal<T>          (page 4)
opt<T>       opt.SOME(value)  opt.NONE
```

```java
// range<T>, for numbers, durations, dates and a pack's ordered types: a..b, a..., ...b, with an optional step
fn range<T>.low(self): opt<T>;
fn range<T>.high(self): opt<T>;
fn range<T>.stride(self): opt<T>;
fn range<T>.has(self, x: T): bool;                       // written x in r

// duration: written 250ms or 2s
fn duration.ms(self): number;

// number: exact base-10, 34 significant digits
fn number.round(self): number step 1;                    // halves go away from zero
fn number.floor(self): number step 1;
fn number.ceil(self): number step 1;
fn number.abs(self): number;
fn number.fmt(self, places: number 0..10 step 1): text;
fn number.sign(self): number;                            // -1, 0 or 1
fn number.sqrt(self): number;                            // a negative number is a failure
fn number.pow(self, p: number): number;
fn number.exp(self): number;
fn number.ln(self): number;                              // zero or less is a failure
fn number.sin(self): number;                             // angles in radians
fn number.cos(self): number;
fn number.tan(self): number;
fn number.asin(self): number;
fn number.acos(self): number;
fn number.atan(self): number;
fn number.atan2(self, x: number): number;                // y.atan2(x): the angle of the point (x, y)
fn number.sinh(self): number;
fn number.cosh(self): number;
fn number.tanh(self): number;

// list<T>: xs[i] is another way to write xs.at(i)
fn list<T>.len(self): number 0... step 1;
fn list<T>.at(self, pos: number): opt<T>;                // opt.NONE unless pos is a whole number in the list
fn list<T>.add(mut self, item: T);
fn list<T>.insert(mut self, pos: number 0... step 1, item: T);   // past the end, it is added last
fn list<T>.remove_at(mut self, pos: number 0... step 1);         // outside the list is a failure
fn list<T>.move(mut self, pos: number 0... step 1, to: number 0... step 1);
fn list<T: same>.remove(mut self, item: T);              // every item equal to it
fn list<T: ordered>.sort(mut self);

// text
fn text.len(self): number 0... step 1;
fn text.slice(self, start: number 0... step 1, count: number 0... step 1): text;  // stops at the end
fn text.chars(self): list<text[1]>;
fn text.lower(self): text;
fn text.upper(self): text;
fn text.trim(self): text;
fn text.has(self, part: text): bool;
fn text.split(self, sep: text[1...]): list<text>;
fn text.number(self): opt<number>;                       // "42" and "3.5"; anything else is opt.NONE

// on every ordered type. With constant bounds the result has the range low..high
fn ordered.clamp(self, low: self, high: self): self;
```

How a value is shown in a hole:

| Type | Shown as |
|---|---|
| `number` | Its shortest exact form, with no exponent and no trailing zeros: `42`, `3.5`, `0.3`, `-7` |
| `bool` | `true` or `false` |
| `text` | Itself |
| `duration` | Whole seconds as `2s`, anything else as `250ms` |
| `date` | `2026-11-10` |

For anything meant for a reader, format it: `price.fmt(2)`.

What the syntax makes:

- **`42` and `4.2`** (number): Or a type that fits literal&lt;number>, where one is expected.
- **`"…"`** (text): Or a type that fits literal&lt;text>.
- **`[a, b]`** (list&lt;t>): Or a type that fits literal&lt;list&lt;u>>.
- **`\{x}`** (shown): Any type that fits shown, and any view.
- **`true`, `false`, `if`, `&&`, `||`, `!`** (bool)
- **`250ms`, `2s`** (duration)
- **`a..b`, `x in r`** (range&lt;t>): For numbers, durations, dates and a pack's own ordered types.
- **`xs[i]`, `for`** (list&lt;t>): `xs[i]` gives an `opt`, like `xs.at(i)`. `for` also walks a range of numbers.
- **`if (let …)`, a plain value where an opt is wanted** (opt&lt;t>)
- **`@name(…)`** (view)
- **`+ - * / %`, `< <= > >=`, `== !=`** (numeric, scaled, ordered, same)

### The core files

#### types

```java
package core;

//@about Values looked up by a text key.
record map<T> {
    entries: list<{ key: text, value: T }>;
}

fn map<T>.get(self, key: text): opt<T> {
    for (e in self.entries) {
        if (e.key == key) {
            return opt.SOME(e.value);
        }
    }
    return opt.NONE;
}

fn map<T>.keys(self): list<text> {
    return self.entries.map(fn(e) { return e.key; });
}

fn map<T>.has(self, key: text): bool {
    return self.keys().some(fn(k) { return k == key; });
}

//@about A calendar day, written as a text: "2026-11-10".
record date implements literal<text>, same, ordered, shown {
    year: number;
    month: number;
    day: number;

    require "a date is written as 2026-11-10" {
        return year == year.floor() && month == month.floor() && day == day.floor()
            && year in 1..9999 && month in 1..12 && day in 1..(days_in(year, month));
    }
}

fn date.from(value: text): date {
    return date {
        year = value.slice(0, 4).number().or(0),
        month = value.slice(5, 2).number().or(0),
        day = value.slice(8, 2).number().or(0),
    };
}

// days since 1970-01-01
fn date.days(self): number {
    let y: number = self.month <= 2 ? self.year - 1 : self.year;
    let era: number = (y / 400).floor();
    let yoe: number = y - era * 400;
    let mp: number = (self.month + 9) % 12;
    let doy: number = ((153 * mp + 2) / 5).floor() + self.day - 1;
    let doe: number = yoe * 365 + (yoe / 4).floor() - (yoe / 100).floor() + doy;
    return era * 146097 + doe - 719468;
}

fn date.before(self, other: date): bool {
    return self.days() < other.days();
}

fn date.plus(self, days: number): date {
    return day_number(self.days() + days.round());
}

fn date.days_to(self, other: date): number {
    return other.days() - self.days();
}

fn date.show(self): text {
    return "\{self.year}-\{two(self.month)}-\{two(self.day)}";
}

//@about A moment, written as a text with its offset: "2026-11-10T09:30+01:00".
record moment implements literal<text>, same, ordered, shown {
    day: date;
    minute: number;
    offset: number;

    require "a moment is written as 2026-11-10T09:30+01:00" {
        return minute == minute.floor() && minute in 0..1439 && offset == offset.floor() && offset in -840..840;
    }
}

fn moment.from(value: text): moment {
    let sign: number = value.slice(16, 1) == "-" ? -1 : 1;
    return moment {
        day = date {
            year = value.slice(0, 4).number().or(0),
            month = value.slice(5, 2).number().or(0),
            day = value.slice(8, 2).number().or(0),
        },
        minute = value.slice(11, 2).number().or(-1) * 60 + value.slice(14, 2).number().or(0),
        offset = sign * (value.slice(17, 2).number().or(99) * 60 + value.slice(20, 2).number().or(0)),
    };
}

// minutes since 1970-01-01T00:00 in UTC
fn moment.utc(self): number {
    return self.day.days() * 1440 + self.minute - self.offset;
}

fn moment.same(self, other: moment): bool {
    return self.utc() == other.utc();
}

fn moment.before(self, other: moment): bool {
    return self.utc() < other.utc();
}

fn moment.plus(self, minutes: number): moment {
    return moment_at(self.utc() + minutes.round(), self.offset);
}

fn moment.minutes_to(self, other: moment): number {
    return other.utc() - self.utc();
}

// the same moment, with the offset the reader's zone uses on its date.
// Supplied by the implementer from the platform's zone rules: MKP can never know them
extern fn moment.local(self): moment;

fn moment.time(self): text {
    return "\{two((self.minute / 60).floor())}:\{two(self.minute % 60)}";
}

fn moment.show(self): text {
    let sign: text = self.offset < 0 ? "-" : "+";
    let off: number = self.offset.abs();
    return "\{self.day}T\{self.time()}\{sign}\{two((off / 60).floor())}:\{two(off % 60)}";
}

// helpers, private to core
fn leap(y: number): bool {
    return y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
}

fn days_in(y: number, m: number): number {
    if (m == 2) {
        return leap(y) ? 29 : 28;
    }
    return [4, 6, 9, 11].has(m) ? 30 : 31;
}

fn two(n: number): text {
    return n < 10 ? "0\{n}" : "\{n}";
}

fn day_number(z0: number): date {
    let z: number = z0 + 719468;
    let era: number = (z / 146097).floor();
    let doe: number = z - era * 146097;
    let yoe: number = ((doe - (doe / 1460).floor() + (doe / 36524).floor() - (doe / 146096).floor()) / 365).floor();
    let doy: number = doe - (365 * yoe + (yoe / 4).floor() - (yoe / 100).floor());
    let mp: number = ((5 * doy + 2) / 153).floor();
    let d: number = doy - ((153 * mp + 2) / 5).floor() + 1;
    let m: number = mp < 10 ? mp + 3 : mp - 9;
    return (try date { year = yoe + era * 400 + (m <= 2 ? 1 : 0), month = m, day = d }).or("1970-01-01");
}

fn moment_at(utc: number, offset: number): moment {
    let local: number = utc + offset;
    let days: number = (local / 1440).floor();
    return (try moment { day = day_number(days), minute = local - days * 1440, offset = offset }).or("1970-01-01T00:00+00:00");
}

//@about Maths, written in TeX. Core checks how it is written; the provider may also refuse what it can't draw.
record latex implements literal<text>, shown {
    tex: text[1...];

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

    require "the provider can draw this TeX" {
        return can_draw_tex(tex);
    }
}

fn latex.from(value: text): latex {
    return latex { tex = value };
}

fn latex.show(self): text {
    return self.tex;
}

//@about Whether the provider can draw this TeX, for example whether it knows every command in it. A provider may supply its own; without one, all TeX that core accepts is drawn.
extern fn can_draw_tex(tex: text): bool {
    return true;
}

//@about Markdown written in code. A hole puts it in as Markdown, not escaped. Only a literal becomes md.
record md implements literal<text> {
    source: text;
}

fn md.from(value: text): md {
    return md { source = value };
}

//@about Inline Markdown, parsed by the compiler into segments: from prose, or from a text literal where rich_text is wanted.
record rich_text implements shown {
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
            return m.tex;
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

// TeX as tokens: a command (\frac, \{, \\) or one character. Spaces are dropped. Private to core
fn tex_tokens(tex: text): list<text> {
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
            } else if (c != " ") {
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
    mut depth: number step 1 = 0;
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
    mut depth: number step 1 = 0;
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
fn tex_group(t: list<text>, k: number): text {
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

//@about A place on a canvas.
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
let e: number = 2.718281828459045235360287471352662;

// on every ordered type
fn ordered.min(self, other: self): self {
    return other.before(self) ? other : self;
}

fn ordered.max(self, other: self): self {
    return self.before(other) ? other : self;
}
```

`map`, `date`, `moment`, `latex` and `md` are ordinary records written in MKP, not extern: nothing about them needs the implementer. `date`, `moment`, `latex` and `md` fit `literal<text>`, like `email` on page 4, so `"2026-11-10"` is checked where it is written, and a reader's text becomes one of them only through `try`, or for `md` never. `moment` always carries its offset; named zones and daylight saving are left out. The current time is `page.now`, which the app updates, because drawing can't ask what time it is. `local()` is an extern fn: it shows a moment in the reader's own zone, with the offset that zone uses on that date, from the platform's zone rules. Named zones are not part of the language; authors write offsets. `latex` checks how TeX is written with five `require` blocks of its own, written in MKP, and a sixth asks `can_draw_tex`, an extern fn whose body is the default and which a provider may replace with its own, such as one that refuses a command it can't draw. A hole that holds an `md` puts its source in as Markdown; every other value is escaped. An implementer still supplies them, which is what `extern` means.

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

fn list<T>.count(self, test: fn(item: T): bool): number step 1 {
    mut n: number step 1 = 0;
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
    let start: number step 1 = self.len() - part.len();
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

A `token` is a record whose values can be written out only inside a `tokens` block. Everywhere else they are used by name, so a written-out colour or spacing is a compile error.

```java
package core;

// # and six or eight hex digits. Private to core
fn hex(value: text): bool {
    let digits: list<text[1]> = value.slice(1, 8).lower().chars();
    return value.starts("#") && value.len() != 8 && digits.all(fn(c) { return "0123456789abcdef".has(c); });
}

token color {
    light: text[7..9];
    dark: text[7..9];

    require "a colour is # and six or eight hex digits" {
        return hex(light) && hex(dark);
    }
}

token space {
    px: number 0...;
}

token size {
    px: number 0...;
}

token radius {
    px: number 0...;
}

token font {
    family: text[1...];
    size: number 1...;
    weight: number 100..900 step 1;
    line: number 1..3 = 1.5;
}

token shadow {
    x: number = 0;
    y: number = 0;
    blur: number 0...;
    tone: color;
}

tokens core {
    color.SURFACE = color { light = "#ffffff", dark = "#15171a" };
    color.INK = color { light = "#1a1c1f", dark = "#eceef1" };
    color.MUTED = color { light = "#6b7280", dark = "#9aa3ae" };
    color.LINE = color { light = "#d4d7dc", dark = "#3a3f46" };
    color.ACCENT = color { light = "#2563eb", dark = "#7aa7ff" };
    color.INFO = color { light = "#0284c7", dark = "#38bdf8" };
    color.OK = color { light = "#15803d", dark = "#4ade80" };
    color.WARN = color { light = "#b45309", dark = "#fbbf24" };
    color.BAD = color { light = "#dc2626", dark = "#f87171" };
    color.C1 = color { light = "#2563eb", dark = "#7aa7ff" };
    color.C2 = color { light = "#0d9488", dark = "#2dd4bf" };
    color.C3 = color { light = "#d97706", dark = "#fbbf24" };
    color.C4 = color { light = "#7c3aed", dark = "#c4b5fd" };
    color.C5 = color { light = "#db2777", dark = "#f9a8d4" };
    color.C6 = color { light = "#475569", dark = "#cbd5e1" };

    space.XS = space { px = 2 };
    space.S = space { px = 4 };
    space.M = space { px = 8 };
    space.L = space { px = 16 };
    space.XL = space { px = 32 };

    size.XS = size { px = 8 };
    size.S = size { px = 160 };
    size.M = size { px = 320 };
    size.L = size { px = 480 };

    radius.CARD = radius { px = 8 };
    radius.PILL = radius { px = 999 };

    font.BODY = font { family = "system-ui, sans-serif", size = 16, weight = 400 };
    font.HEADING = font { family = "system-ui, sans-serif", size = 22, weight = 650, line = 1.25 };
    font.MONO = font { family = "ui-monospace, monospace", size = 14, weight = 400, line = 1.45 };

    shadow.RAISED = shadow { y = 1, blur = 3, tone = color { light = "#0000001f", dark = "#0000001f" } };
}
```

These are the default values. `C1` to `C6` are for chart series. An implementer gives them its own look in its own `tokens` block, and the names can't change. Page 6 has the rules.

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

enum track {
    AUTO,
    FR(share: number 1... step 1),
    CH(count: number 1... step 1),
    SIZE(of: size),
}

enum cols {
    EQUAL(count: number 1..12 step 1),
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

These are ordinary enums, so `match` on any of them has to cover every case.

#### page

```java
package core;

//@about What the app tells MKP about the page being read.
extern page {
    width: width = width.WIDE;
    theme: theme = theme.LIGHT;
    today: date = "1970-01-01";
    now: moment = "1970-01-01T00:00+00:00";      // the app's clock
}
```

`page` is an `extern` block like the ones on page 6. The defaults are what a site that supplies nothing gets.

#### widgets

Twenty-one widgets are extern: ten are Markdown's own blocks, so every implementer draws Markdown natively, and eleven are what MKP can't express in terms of the others. Eight more belong to the optional `core.gfx` level. The other twelve are written in MKP below, from the extern ones, so an implementer draws only the twenty-one.

| Extern | Widgets | What MKP can't do itself |
|---|---|---|
| Layout | `flex`, `grid`, `cell`, `sizing` | Lay children along one axis with wrapping; line columns up across rows; place a child in a grid; say how big a child is |
| Markdown blocks | `paragraph`, `heading`, `bullets`, `item`, `quote`, `code`, `math`, `table`, `footnote`, `divider` | Markdown's own blocks, drawn natively, with inline Markdown already parsed into `rich_text` |
| Drawing | `label`, `image`, `icon` | Draw plain text, a picture, and a glyph from the implementer's set |
| Input | `press`, `field`, `slider` | Being clicked, typed into and dragged |
| Above the page | `overlay` | Content outside the layout: popovers, tooltips, dialogs and menus |
| `core.gfx` only | `canvas`, `layer`, `circle`, `path`, `place`, `handle`, `arrow`, `zoom` | Drawing on a surface, arrows between widgets, and panning and zooming |

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
    span: number 1..12 step 1 = 1,
    row: opt<number 1... step 1> = opt.NONE,
    col: opt<number 1... step 1> = opt.NONE,
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
```

#### widgets: extern Markdown blocks

```java
package core;

//@about A paragraph of inline Markdown, parsed by the compiler.
extern widget paragraph(value: rich_text, tone: opt<color> = opt.NONE, align: align = align.START);

//@about A heading, level 1 to 6.
extern widget heading(level: number 1..6 step 1, value: rich_text);

//@about A list: bulleted, or numbered from start.
extern widget bullets(ordered: bool = false, start: number 0... step 1 = 1) {
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

- **Markdown's own blocks are extern.** Every implementer draws them natively, which is what makes MKP a superset of Markdown: a document is Markdown first, and MKP lowers onto the same blocks. They have no `markdown` block, because they are Markdown blocks themselves. Every implementer, a Markdown-only one included, writes each out as the block it stands for, with the spellings page 1 gives.
- **Inline Markdown arrives parsed.** A paragraph, a heading and a table cell take `rich_text`: segments of text, code spans, maths, pictures, footnote marks and line breaks, each with its marks. An implementer draws the segments and never parses Markdown. A hole's value is a `TEXT` segment, so it can never turn into formatting.
- **From code**, a text literal where `rich_text` is wanted is read as a line of prose, holes included: `@paragraph(value = "Read **this**, \{name}.");`. A value from a variable goes through `rich_text.plain(name)`, which keeps it as plain text.

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
    lines: number 1..20 step 1 = 1,
) {
    event submit();

    markdown {
        \{label}: \{value}
    }
}

//@about A number picked by dragging. Its range and step are those of the variable it is given.
extern widget slider(mut value: number, label: text, disabled: bool = false) {
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
}

//@about What every shape has: a label, which a shape that takes events must not leave empty.
widget interface shape {
    label: text;
}

//@about A circle around a point, r in the canvas's own units.
extern widget circle(
    at: point,
    r: number 0...,
    fill: opt<color> = opt.NONE,
    stroke: opt<color> = opt.NONE,
    width: number 0... = 1,                     // the stroke's width, in pixels
    opacity: number 0..1 = 1,
    label: text = "",
) implements shape {
    event click();
    event enter();
    event leave();
}

//@about A line through points; closed, it is a polygon and can be filled.
extern widget path(
    points: list<point>[2...],
    closed: bool = false,
    fill: opt<color> = opt.NONE,
    stroke: opt<color> = color.INK,
    width: number 0... = 1,
    dash: bool = false,
    head: head = head.NONE,                     // an arrow or a dot at the last point
    opacity: number 0..1 = 1,
    label: text = "",
) implements shape {
    event click();
    event enter();
    event leave();
}

//@about Ordinary widgets placed at a point of the canvas: a label, an image, anything. nudge moves them by pixels, with y up like the canvas.
extern widget place(at: point, anchor: anchor = anchor.CENTER, nudge: point = point { x = 0, y = 0 }, label: text = "") implements shape {
    slot child: view;
}

//@about A point the reader drags. It writes where it is to the variable it is given.
extern widget handle(mut at: point, tone: opt<color> = opt.NONE, label: text) implements shape;

//@about A part of the canvas, from one corner to the other, in its units.
record region {
    from: point;
    to: point;
}

//@about The four corners of a rectangle, for a path.
fn rect(x0: number, y0: number, x1: number, y1: number): list<point>[4] {
    return [point { x = x0, y = y0 }, point { x = x1, y = y0 }, point { x = x1, y = y1 }, point { x = x0, y = y1 }];
}

//@about An arrow between two widgets on the page, drawn over the layout and routed to their outlines.
extern widget arrow(
    from: opt<view>,
    to: opt<view>,
    label: text = "",
    head: head = head.ARROW,
    tail: head = head.NONE,
    dash: bool = false,
) {
    markdown {
        \{label}
    }
}

//@about Lets the reader pan and zoom its content, in the optional level core.gfx.
extern widget zoom(max: number 1..10 = 4) {
    slot body: view;

    markdown {
        \{body}
    }
}
```

**Shared values at the edge.** A `mut` input of an `extern` widget, such as `slider`'s `value`, accepts a variable with any contract of the declared type. The implementer may read that contract, which is where a slider gets its ends and its step, and the runtime refuses any value the widget writes that is outside it. A variable with no range gives a slider from 0 to 1. This is the one exception to "sharing needs the same contract", and it is allowed because the app boundary is checked at run time anyway.

**Inputs a caller may keep.** `overlay`'s `open` is a `mut` input with a default: given a variable, the caller keeps whether it is open; left out, the overlay keeps it itself. In a loop over a list that isn't a constant it has to be given, because rows go by position (page 3).

#### widgets: written in MKP

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
            @grow(by = max - value.clamp(0, max)) {
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
```

- **Sizing wrappers nest in any order and mean the same.** A chain of `sizing` around one child is folded into one set of properties on that child, so `@grow { @min_size(…) { … } }` and the other way round are equal. Setting one property twice in a chain is a compile error. A child with no wrapper doesn't grow, shrinks by 1, and starts from its own size, as in CSS.
- **Built in**: The eight types the syntax makes, the six interfaces, and the 43 fns that have to be native: list storage, Unicode text, exact numbers with their maths, and clamp.
- **core, written in MKP**: point, map, date, moment, latex, md, the tokens and options, the twelve widgets above, and 24 fns built from the built-in ones: or, min, max, some, all, count, find, filter, map, remove_where, first, last, reversed, has, position, unique, sorted, join, sum, starts, ends, like, replace, and `rect` for canvas paths.
- **core, supplied by the implementer**: page values, `moment.local`, `can_draw_tex` if it replaces the default, and the drawing of the 21 extern widgets (and 8 more for `core.gfx`), marked extern. Extern is only for what MKP can never do on its own, and for Markdown's own blocks.
- **A pack's own types**: Join the syntax by fitting shown, same, ordered, numeric, scaled or literal&lt;t>. They can't add new symbols, on purpose.

# Examples

Page 7 of 9. The card, stats, checklist and tabs widgets, a diagram of tables on a plane, two drawings on a canvas, and a whole document, written in MKP. Every block on this page, and every other code block in this doc, has been read by the reference parser described on page 9.

### Widgets and a document

#### card

A titled box around anything. One slot of type `view`, so in a document its block is prose.

```java
package kit;

//@about A titled box around anything.
//@param tone the colour of its edge and title
widget card(title: text[1...], tone: opt<color> = opt.NONE) {
    slot body: view;

    view {
        @column(gap = space.S, pad = space.M, stroke = tone.or(color.LINE), radius = radius.CARD) {
            @label(value = title, weight = weight.BOLD, tone = tone);
            @body;
        }
    }

    markdown {
        **\{title}**

        \{body}
    }
}
```

#### stats

A row of key numbers, each with an optional change, note and tone.

```java
package kit;

record stat {
    label: text[1...];
    value: text;
    change: opt<text> = opt.NONE;
    note: opt<text> = opt.NONE;
    tone: opt<color> = opt.NONE;
}

fn moved(s: stat): color {
    if (let t: color = s.tone) {
        return t;
    }
    if (let c: text = s.change) {
        if (c.starts("+")) {
            return color.OK;
        }
        if (c.starts("-")) {
            return color.BAD;
        }
    }
    return color.MUTED;
}

//@about Key numbers in tiles: a label, the number large, how it changed.
//@param items the tiles, in order
widget stats(items: list<stat>[1...]) {
    fn tile(s: stat): view {
        return @column(gap = space.XS, pad = space.M, stroke = color.LINE, radius = radius.CARD) {
            @label(value = s.label, size = text_size.SMALL, tone = color.MUTED, clip = true);
            @row(gap = space.S, align = align.BASELINE) {
                @label(value = s.value, size = text_size.LARGE, weight = weight.BOLD, wrap = false);
                if (let c: text = s.change) {
                    @label(value = c, size = text_size.SMALL, tone = moved(s));
                }
            }
            if (let n: text = s.note) {
                @label(value = n, size = text_size.SMALL, tone = color.MUTED);
            }
        };
    }

    view {
        // at most two tiles a row on a phone, four elsewhere: a whole number 1..4 either way
        let across: int 1..4 = page.width == width.NARROW ? items.len().clamp(1, 2) : items.len().clamp(1, 4);
        @grid(cols = cols.EQUAL(across), gap = space.S) {
            for (s in items) {
                @tile(s);
            }
        }
    }

    markdown {
        @for (s in items) {
        - **\{s.label}**: \{s.value}
        }
    }
}
```

#### checklist

Numbered items to tick off. The ticks are kept as the positions that are ticked, in a `mut` list that is the widget's own variable. The rows hold nothing of their own, so a plain `for` is enough. Its Markdown writes each box with `@if` and a literal `[x]` or `[ ]`, because a hole is always plain text.

```java
package kit;

record task {
    title: text[1...];
    done: bool = false;
}

fn ticked_first(items: list<task>): list<number> {
    mut out: list<number> = [];
    for (k, t in items) {
        if (t.done) {
            out.add(k);
        }
    }
    return out;
}

//@about Numbered items to tick off, under a bar of how many are done.
//@param items the items; done starts one ticked
widget checklist(items: list<task>[1...]) {
    // runs once, when the checklist is made
    mut ticked: list<number> = ticked_first(items);

    fn flip(k: number) {
        if (ticked.has(k)) {
            ticked.remove(k);
        } else {
            ticked.add(k);
        }
    }

    view {
        @column(gap = space.S) {
            @row(gap = space.M, align = align.CENTER) {
                @grow {
                    @meter(value = ticked.len(), max = items.len(), label = "done", tone = color.OK);
                }
                @label(value = "\{ticked.len()} of \{items.len()} done", size = text_size.SMALL, tone = color.MUTED);
            }
            @grid(cols = cols.TRACKS([track.AUTO, track.FR(1)]), gap = space.XS) {
                for (k, t in items) {
                    @label(value = "\{k + 1}", size = text_size.SMALL, tone = color.MUTED);
                    @press(label = t.title, kind = press_kind.CHECK, selected = ticked.has(k), click = fn() { flip(k); });
                }
            }
        }
    }

    markdown {
        @for (k, t in items) {
        @if (ticked.has(k)) {
        - [x] \{t.title}
        } else {
        - [ ] \{t.title}
        }
        }
    }
}
```

#### tabs

Panels under a row of tabs. `slot panels: list<tab>[1...];` collects the `tab` children, and each child's inputs can be read. `panels[open]` gives an `opt`, because nothing says `open` is inside the list. Each `tab` is made by the caller, so a panel keeps its own variables while another one is showing.

```java
package kit;

//@about One panel of a set of tabs.
widget tab(title: text[1...]) {
    slot body: view;

    view {
        @body;
    }

    markdown {
        **\{title}**

        \{body}
    }
}

//@about Panels under a row of tabs, one shown at a time.
widget tabs() {
    slot panels: list<tab>[1...];

    mut open: number = 0;

    view {
        @column(gap = space.M) {
            @row(gap = space.XS, edge = edge.BOTTOM, stroke = color.LINE) {
                for (k, t in panels) {
                    @press(label = t.title, kind = press_kind.TAB, selected = open == k, click = fn() { open = k; });
                }
            }
            if (let p: tab = panels[open]) {
                @p;
            }
        }
    }

    markdown {
        @for (t in panels) {
        \{t}
        }
    }
}
```

In a document:

```markdown
@tabs {
@tab(title = "Web") {
React on Vite.
}
@tab(title = "Mobile") {
Expo and React Native.
}
}
```

#### A diagram of tables

Tables on a plane, joined by lines that end in arrowheads. Each table sits at its own point, placed with `spot`, which writes where the table's box landed. The diagram keeps its own copy of the tables, so each `spot` has a `box` to write to. Each link is a `path` on the plane's background, from one box's outline to the other's, and its label is placed at the middle with another `spot`. It is MKP alone, with no extern of its own. The boxes need `core.live` and the lines `core.gfx`; on a target without them, the diagram shows its Markdown.

```java
package kit;

//@about A table in a diagram: its name and fields, where it goes, and where it landed.
record table_info {
    name: text[1...];
    fields: list<text>;
    at: point;                                      // in the plane's units
    mut box: opt<region> = opt.NONE;                // written by its spot after layout
}

//@about A link from one table to another, by their names.
record link {
    from: text[1...];
    to: text[1...];
    label: text;
}

//@about Where a link's line runs, from one box's outline to the other's.
record link_line {
    from: point;
    to: point;
}

fn link_line.middle(self): point {
    return self.from.add(self.to).scale(0.5);
}

fn box_of(tables: list<table_info>, name: text): opt<region> {
    if (let t: table_info = tables.find(fn(o) { return o.name == name; })) {
        return t.box;
    }
    return opt.NONE;
}

//@about Where a line from the middle of a box toward a point leaves the box's outline.
fn exit(b: region, toward: point): point {
    let m: point = b.middle();
    let d: point = toward.sub(m);
    let w: number = b.width() / 2;
    let h: number = b.height() / 2;
    if (d.x.abs() * h >= d.y.abs() * w) {
        if (d.x == 0) {
            return m;
        }
        return m.add(d.scale(w / d.x.abs()));
    }
    return m.add(d.scale(h / d.y.abs()));
}

//@about The line of a link, once both of its tables have landed.
fn line_of(tables: list<table_info>, l: link): opt<link_line> {
    if (let a: region = box_of(tables, l.from)) {
        if (let b: region = box_of(tables, l.to)) {
            return link_line { from = exit(a, b.middle()), to = exit(b, a.middle()) };
        }
    }
    return opt.NONE;
}

widget table_box(t: table_info) {
    view {
        @column(pad = space.S, stroke = color.LINE, radius = radius.CARD) {
            @label(value = t.name, weight = weight.BOLD);
            for (f in t.fields) {
                @label(value = f, size = text_size.SMALL, tone = color.MUTED);
            }
        }
    }

    markdown {
        **\{t.name}**: \{t.fields.join(", ")}
    }
}

//@about Tables on a plane, joined by a line with an arrowhead for each link.
//@param tables the tables, each at its own point
widget er(tables: list<table_info>[1...], links: list<link>) {
    require "every link names two tables" {
        return links.all(fn(l) { return tables.some(fn(t) { return t.name == l.from; }) && tables.some(fn(t) { return t.name == l.to; }); });
    }

    // runs once, when the diagram is made; each spot writes its table's box here
    mut placed: list<table_info> = tables;

    view {
        @plane(label = "Tables and their links", fit = true) {
            background {
                @layer {
                    for (l in links) {
                        if (let s: link_line = line_of(placed, l)) {
                            @path(points = [s.from, s.to], head = head.ARROW, label = "\{l.from} \{l.label} \{l.to}");
                        }
                    }
                }
            }
            items {
                mut for (t in placed) {
                    if (mut x: table_info = t) {
                        @spot(at = x.at, box = x.box) {
                            @table_box(t = x);
                        }
                    }
                }
                for (l in links) {
                    if (let s: link_line = line_of(placed, l)) {
                        @spot(at = s.middle()) {
                            @label(value = l.label, size = text_size.SMALL, tone = color.MUTED, halo = true);
                        }
                    }
                }
            }
        }
    }

    markdown {
        @for (t in tables) {
        - **\{t.name}**: \{t.fields.join(", ")}
        }

        Links:

        @for (l in links) {
        - \{l.from} \{l.label} \{l.to}
        }
    }
}
```

#### A bar chart drawn on a canvas

The bars answer hover, and the line under the chart says what hovering shows, for readers on a phone.

```java
package charts;

widget bars(items: list<bar>[1...]) {
    mut on: number = -1;

    view {
        @column(gap = space.S) {
            @canvas(label = "Values by item", x = 0..(items.len()), y = 0..(tallest(items))) {
                @layer {
                    for (k, b in items) {
                        @path(
                            points = rect(k + 0.1, 0, k + 0.9, b.value),
                            closed = true,
                            fill = on == k ? color.ACCENT : color.C1,
                            stroke = opt.NONE,
                            label = b.label,
                            enter = fn() { on = k; },
                            leave = fn() { on = -1; },
                        );
                    }
                }
                @layer {
                    for (k, b in items) {
                        @place(at = point { x = k + 0.5, y = 0 }, anchor = anchor.N) {
                            @label(value = b.label, size = text_size.SMALL);
                        }
                    }
                }
            }
            if (let b: bar = items[on]) {
                @label(value = "\{b.label}: \{b.value}", tone = color.MUTED);
            }
        }
    }

    markdown {
        @for (b in items) {
        - \{b.label}: \{b.value}
        }
    }
}
```

#### A point the reader drags

```java
package kit;

let unit: region = region { from = point { x = -1, y = -1 }, to = point { x = 1, y = 1 } };

widget slope() {
    mut p: point = point { x = 0.5, y = 0.5 };

    view {
        @canvas(label = "A line from the centre to a point you drag", width = size.S, aspect = 1) {
            @layer(clip = unit) {
                @path(points = [point { x = -1, y = 0 }, point { x = 1, y = 0 }], stroke = color.LINE);
                @path(points = [point { x = 0, y = -1 }, point { x = 0, y = 1 }], stroke = color.LINE);
                @path(points = [point { x = 0, y = 0 }, p], stroke = color.ACCENT, width = stroke.BOLD, head = head.ARROW);
            }
            @layer {
                @handle(at = p, label = "the end of the line");
                @place(at = p, anchor = anchor.SW, nudge = point { x = 6, y = 6 }) {
                    @label(value = "(\{p.x.fmt(2)}, \{p.y.fmt(2)})", halo = true);
                }
            }
        }
    }

    markdown {
        A line from the centre to (\{p.x.fmt(2)}, \{p.y.fmt(2)}).
    }
}
```

#### A whole document

Front matter, then the definitions, `$state` among them, the `@@@` line, and the document.

````markdown
---
title: Release week
---
import kit;

//@about What this document's widgets share.
$state {
    celsius: int -20..40 = 18;
}
@@@
# Release week

It is \{$state.celsius}°C right now.

@slider(value = $state.celsius, label = "temperature");

@grid(cols = cols.EQUAL(2), gap = space.L) {

@card(title = "Deploys", tone = color.INFO) {
We shipped **42** times, up from 37.
}

@stats(items = [
    stat { label = "Failures", value = "3", change = "-2", tone = color.OK },
    stat { label = "p95", value = "180 ms", note = "API" },
]);

}
````

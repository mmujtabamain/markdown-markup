# Examples

Page 7 of 9. The card, stats, checklist and tabs widgets, and a whole document, written in MKP. Every block on this page, and every other code block in this doc, has been read by the reference parser described on page 9.

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
        let across: number 1..4 step 1 = page.width == width.NARROW ? items.len().clamp(1, 2) : items.len().clamp(1, 4);
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

Numbered items to tick off. The ticks are kept as the positions that are ticked, in a `mut` list that is the widget's own variable. The rows hold nothing of their own, so a plain `for` is enough.

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
        - [\{ticked.has(k) ? "x" : " "}] \{t.title}
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

Boxes placed by the layout, joined by arrows. Each box is held in a list, placed once, and found again by name for its arrows (page 3, "Pointing at a widget").

```java
package kit;

record table_info {
    name: text;
    fields: list<text>;
}

record link {
    from: text;
    to: text;
    label: text;
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

widget er(tables: list<table_info>[1...], links: list<link>) {
    require "every link names two tables" {
        return links.all(fn(l) { return tables.some(fn(t) { return t.name == l.from; }) && tables.some(fn(t) { return t.name == l.to; }); });
    }

    view {
        let boxes: list<table_box> = tables.map(fn(t) { return @table_box(t = t); });
        @grid(cols = cols.EQUAL(3), gap = space.XL) {
            for (b in boxes) {
                @b;
            }
        }
        for (l in links) {
            @arrow(from = boxes.find(fn(b) { return b.t.name == l.from; }), to = boxes.find(fn(b) { return b.t.name == l.to; }), label = l.label);
        }
    }

    markdown {
        @for (t in tables) {
        - **\{t.name}**: \{t.fields.join(", ")}
        }

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
                @path(points = [point { x = 0, y = 0 }, p], stroke = color.ACCENT, width = 2, head = head.ARROW);
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

Front matter, then the definitions, the `@@@` line, and the document.

````markdown
---
title: Release week
---
import kit;

mut celsius: number -20..40 step 1 = 18;
@@@
# Release week

It is \{celsius}°C right now.

@slider(value = celsius, label = "temperature");

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

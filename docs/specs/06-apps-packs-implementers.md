# Apps, packs and implementers

Page 6 of 9. Packs and imports, tokens, talking to the app, what implementing MKP means, failures, warnings and limits.

### Packs and imports

A pack is a folder of `.mkp` files that all start with the same `package` line. They share one scope, so they use each other's declarations without importing. One of the files holds the `pack` block.

```java
package kit;

//@about A set of components for documents.
pack kit@1 {
    uses core@1, charts@2;
    provides card, stats, stat, checklist, task, tab, tabs, box, unit;
}

tokens brand {
    color.PRIMARY = color_value { light = "#2563eb", dark = "#7aa7ff" };
    space.HUGE = 64;
    font.DISPLAY = font_value { family = "Inter", size = 32, weight = 700 };
}
```

| Line | Meaning |
|---|---|
| `pack kit@1` | The pack's name and its version, a whole number. A new number means something that used the old one may break |
| `uses core@1, charts@2;` | The packs this one imports from, each at the version it needs. `core` is imported by every file anyway; listing it pins the version of the language and of `core` the pack is written for |
| `provides …;` | Every name other packs may import: widgets, records, enums, types, interfaces, fns, `let` constants such as `unit` (page 7), and extern blocks. Anything not listed can only be used inside the pack |

- **`import kit;`** makes every name `kit` provides usable in the file. **`import kit.stats;`** brings in that one name, and **`import kit.stats as kit_stats;`** brings it in under another name.
- **Fns added to a type, and the token cases a pack gives values to,** come with the pack: importing any of it brings them in. `as` renames a fn added to a type too: `import b.slug as b_slug;` brings `b`'s `text.slug` in as `text.b_slug`.
- **A clash** between two imported names, two fns with one name on one type, or an import and a declaration in the file, is a compile error on the import. Import the single names you need, or rename one with `as`. Names are never written with their pack in front.
- **A pack has no state.** It holds no variables outside its widgets and no `expose` block: those belong to a document (below). Its widgets share values through `mut` inputs.
- **A document** has no `package` line and no `pack` block. It imports above its `@@@` line and writes no versions: `import kit;`. Whoever builds the page decides which version of each pack it gets, by the packs it builds it with.
- **`@` followed by a digit** names a version, and never starts a view, because a view's `@` is always followed by a name.

### Tokens

A token type is an enum whose cases each stand for a value of one type: `token space: number 0... { XS, S, M, L, XL }`. Core declares `color`, `space`, `size`, `radius`, `font`, `shadow` and `stroke` (page 5), and a pack may declare its own with `token`. A `tokens` block gives the cases their values. The block's own name is a label for people and tools. Lookup never uses it.

- **A value** is written `type.NAME = value;`, with a value of the token's type, and only inside a `tokens` block. Every named case a `token` declaration lists needs a value from the pack that declares it. A colour's value is a `color_value`, with both `light` and `dark`. Custom design is a named case in a pack's own `tokens` block, never a value written inline.
- **A new case.** A pack adds a case to a token type by giving it a value in its own `tokens` block, as `kit` adds `color.PRIMARY` above, and it is used as `color.PRIMARY` wherever its pack is imported. Two visible cases with one name on one type are a compile error. Since any pack can add cases, a `match` on a token always needs `case else`.
- **Restyling.** Only an implementer's pack, one with an `implements` line, may give a new value to a case that `core` declares, as `acme` does below. It can't remove one, and a case it adds is its own, as in any pack. In any other pack, giving a `core` case a value is a compile error.
- **Like an enum.** Tokens compare as cases: `color.OK == color.OK`, and `color.OK != color.ACCENT` even when a theme gives them one value, so restyling never changes a comparison. A case that carries a value equals another only with the same value (`stroke.PX(2) == stroke.PX(2)`), and never a named case (`stroke.PX(2) != stroke.BOLD`).
- **Its value, with no extra word.** A case is accepted where its value's type is wanted, as a plain value is where an `opt` is wanted, and only that way round: `let px: number = stroke.BOLD;`. A record value's fields pass straight through: `color.INK.light`, `font.BODY.size`. `==` stays strict: both sides have the same type, so two tokens compare as cases, and `stroke.BOLD == 2` is false, because `2` becomes `stroke.PX(2)`. To compare values, take them out first: for a `stroke` held in `w`, `let a: number = w;` and `let b: number = stroke.BOLD;`, then `a == b`.
- **A plain value where a token is wanted.** A token type may fit `literal<T>` through a case that carries one value and a `from`, as core's `stroke` does: `width = 2.5` is then accepted, and becomes `stroke.PX(2.5)`. A carrying case stands for its value and needs no line in a `tokens` block. Outside a `tokens` block, that is the only way a token gets a value: the page's colours, spacing and sizes take named cases only.

### Talking to the app

A document and its app talk through channels. An `extern` block declares what the app supplies, and its fns are how MKP tells the app what happened. An `expose` block declares fns the app may call into MKP. One name, here `scores`, ties the two halves of one channel together. The document's `$state` block holds what its widgets share, and the app can read and write it.

```markdown
//@about What the app and the quiz tell each other.
extern scores {
    unit: text = "K";                             // used if the app gives none
    best: opt<list<number>> = opt.NONE;           // not loaded yet
    fn saved(total: int);                         // MKP calls it, the app receives it
}

//@about What this document's widgets share, and what the app can read and write.
$state {
    points: int 0... = 0;
}

// MKP supplies these, and the app calls them
expose scores {
    fn clear() {
        $state.points = 0;
    }
}

//@about A count of points, and a button that adds one.
widget tally(mut points: int) {
    fn add() {
        points = points + 1;
        scores.saved(points);
    }

    view {
        @row(gap = space.S, align = align.CENTER) {
            @label(value = "\{points} \{scores.unit}");
            @press(label = "Add a point", click = add);
            if (let top: list<number> = scores.best) {
                @label(value = "Best so far: \{top.join(", ")}", tone = color.MUTED);
            } else {
                @label(value = "Loading the best scores", tone = color.MUTED);
            }
        }
    }

    markdown {
        \{points} \{scores.unit}
    }
}
@@@
# Quiz

@tally(points = $state.points);
```

- **`$state`** holds the only variables outside widgets: one block per document, above its `@@@` line. Every widget and fn in the document reads a field as `$state.name`, and only actions assign one. Contracts and `require` blocks link the fields, and every change checks the rules that read it (page 2).
- **A pack's widget** can't see `$state`. It takes what it shares as a `mut` input, as `tally` takes `points`, and the document passes it a field. So everything shared is in one place, where the document's own rules can link it. `tally`'s input is an `int` with no range, so whole-number arithmetic proves `points + 1`; each write back is checked against the field's own `int 0...` (page 2, sharing).
- **The app reads and writes `$state`.** It can get the whole of it and set any field. A write from the app is checked like any change: one that breaks a contract or a `require` is refused, and the app is told; one that fits redraws the page once. The app never watches `$state`. It hears what happened only when MKP calls one of a channel's fns, as an event.
- **extern values** flow from the app to MKP. Each has a type and a default, and is constant to MKP code. When the app changes one, everything that reads it is worked out again. The runtime checks each value against its type as it arrives. One that doesn't fit is dropped, the default is used, and the app is told.
- **extern fns** are the same two kinds as every fn. Without a return type, one is an action sent to the app, and can only be called from event handlers, never while drawing: that is how the page tells the app what happened, as `saved` does. With a return type, it changes nothing: it is a value only its supplier can work out, such as `moment.local`, and may be called while drawing. The supplier has to give the same answer for the same arguments. A shader for `shade` (page 5) is one of these, and the target runs it for every pixel.
- **Waiting.** MKP has no waiting and no callbacks. Something that isn't there yet is an `opt` extern value, and the view says what to show for both cases, as `best` does above.
- **expose** is written only at the top of a document, never in a pack or a widget: a pack has no `$state` for it to change, and the app has no way to say which widget on the page it means. `expose scores` declares no name of its own. It answers the `extern` channel of that name, or starts one if the document has none. Its fns are called only by the app, never by MKP code. They return nothing, take constant parameters, and may assign `$state`.
- **Keeping things.** Variables last while the page is open. To keep `$state` between visits, the app saves it and hands it back when it next mounts the page. What it hands back goes through the same checks as a write from the app: a field that doesn't fit keeps its starting value, and the app is told. Anything else is kept through a channel: MKP calls an `extern` fn, and the app hands the value back as an `extern` value next time.

**extern in front of a declaration** means it is supplied from outside MKP: `extern type`, `extern fn` and `extern widget`. Who supplies it depends on where it is declared.

| Declared in | Supplied by |
|---|---|
| `core` | The target, with its own default widgets, which an app may replace through its widget registry |
| A pack | The pack, for each target it supports. Any pack may declare extern widgets and fns of its own |
| A document's `extern` block | The app, when it mounts the page |

- **Nobody supplies it.** An extern widget nobody supplies shows its Markdown instead, whether it is core's or a pack's. A shader nobody supplies draws nothing, and is reported when the page is mounted.
- **A default.** Only an `extern fn` may have a body, which is its default: it runs when its supplier gives none, and a supplier may replace it.

### Implementing MKP

This spec doesn't depend on how MKP is built, or in what language. MKP is the spec, the `core` pack written in MKP itself, and the target checks. An implementer makes a target, MKP on one platform such as the web or Android, and the target supplies every `extern` in `core`: the extern widgets, `page`, `moment.local`, and the native fns on numbers, text and lists. Passing the target checks is what implementing MKP means.

```java
package acme;

pack acme@1 {
    uses core@1;
    implements core.draw@1, core.live@1;
    provides jump;
}

// an implementer can restyle core's tokens
tokens acme {
    color.ACCENT = color_value { light = "#7c3aed", dark = "#c4b5fd" };
}

// and, like any pack, declare extern widgets of its own, which it supplies
//@about A link that scrolls to another widget.
extern widget jump(to: opt<view>, label: text) {
    markdown {
        \{label}
    }
}
```

`core.draw`, `core.live` and `core.gfx` are levels, fixed by this spec. They are not interfaces and are not declared in any file.

| Level | What the target can do | What needs it |
|---|---|---|
| Markdown only | Compile, and write every widget's Markdown | Nothing more. Every widget has a markdown block, perhaps an empty one, or is a Markdown block, so this always works |
| `core.draw` | Draw the 23 extern widgets of `core.draw`, Markdown's own blocks, `plane` and `spot` among them, glyphs, tokens and page values. The other base widgets are written in MKP on top of them | Every widget |
| `core.live` | Hold variables and change `$state`, run events and redraw, and move a plane as the reader drags, pinches or scrolls | A call that has variables of its own, gives a variable to a `mut` input, or sets an event to a handler that can change something (one that assigns a variable, calls an extern action, or invokes an event its own caller set), or that places one that does. An event that is declared but never set needs nothing. Without `core.live`, `$state` keeps its starting values and never changes, and a plane is drawn where its centre puts it and doesn't move |
| `core.gfx` | Draw its 7 widgets: a `canvas`, and the `layer`s of `circle`s, `path`s, `place`d widgets, `handle`s and `shade`s that go on a canvas or on a plane's background | Those widgets, and a plane with a background |
| `core.motion` | A reserved name for timed controls | Nothing in this spec. See page 8 |

The compiler works out the level each call needs from the table. A call in a document that needs a level the target doesn't have shows its Markdown instead.

A target has written obligations, each proved by the target checks: evaluation exactly as page 2 defines it, exact base-10 numbers, events run in order with one redraw, the limits below, failures contained as below, untrusted content kept sandboxed, extern values and the app's writes to `$state` checked, and accessible controls. How it manages memory is its own choice: MKP code can't make a reference cycle, so freeing a widget's values when it leaves the page, or plain reference counting, is enough.

### Failures

A failure is a bug that could not be caught at compile time. There are no exceptions to catch. Each failure is contained and reported, and the rest of the page carries on.

| Failure | When |
|---|---|
| A number that doesn't fit | A division by zero, or a result too large for decimal128 |
| A broken rule | A `require` or a slot's length contract, false for values that are not constants: a widget's, a record's when it is made without `try`, and every one that reads a value that has just changed, `$state`'s among them |
| A position outside a list | `xs[i] = value`, `remove_at` or `move` with one |
| A write that breaks a variable's contract | A value written back through a `mut` input that the caller's variable doesn't allow |
| An item used after it was removed | In the rest of the block that removed it, when the compiler could not see it |
| A layout that doesn't settle | A plane whose spots' boxes keep changing, stopped after a fixed number of layout passes: a failure of the plane |
| A limit passed | Steps, items or depth |

| Where it happens | What the reader sees | What is kept |
|---|---|---|
| While drawing a widget | That widget is replaced by a short notice with the message and the line. In Markdown it is a quote block. It is tried again when an input or variable it reads changes | The rest of the page, and all variables |
| In an event handler | Nothing changes on the page | Everything the handler changed is undone, and the handler stops |
| In a write from the app | Nothing changes on the page | Everything: the write is refused, and the app is told |
| At compile time, when the compiler can see it | A compile error on the line | |

Every failure is also reported to the app with its message and line. A broken rule inside `try` is not a failure: it gives `opt.NONE`.

A literal is never a failure. Its type's `from` runs only at compile time, with the holes as values it places but never reads. A literal whose `from` would have to read a hole is a compile error that names the hole and says to build the record instead, as in `date { year = 2026, month = month, day = 1 }` (page 4).

### Warnings

A warning never stops a page from compiling.

| Warning | When |
|---|---|
| An empty `markdown { }` | Where the widget is declared, so it shows whenever that file is compiled, a pack's included |
| A spot outside its plane's bounds | At compile time when both are constants. When the page runs, it is reported to the app, not as a failure, and the spot is clipped |
| An MKP fn given to `shade` | At compile time: the runtime calls it for every pixel within the step limit, so only small areas fit |
| A bare `$state.name` in a sentence of prose | At compile time: it is shown as text; put it in a hole (page 1) |
| A document widget whose built Markdown depends on a variable | At compile time, on the branch that depends on it (page 1) |
| A use of a `//@deprecated` declaration | At compile time, on every use (page 3) |

### Limits

Every loop ends, but a fn can call itself and a list can keep growing, so the runtime also counts.

| Limit | Value | Applies to |
|---|---|---|
| Items | 10,000 | Any list, text split, or range that is walked |
| Steps | 1,000,000 | One redraw or one event handler. A step is one statement, one call or one turn of a loop |
| Depth | 64 | Calls inside calls, and widgets inside widgets. The same as the renderer the docs use today |

The compiler uses the same limits when it runs `from`, `require` and contracts on constants, where passing one is a compile error.

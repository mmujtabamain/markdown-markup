# Apps, packs and implementers

Page 6 of 9. Packs and imports, versions and migrations, tokens, talking to the app, what implementing MKP means, failures, warnings and limits.

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

### Versions and migrations

A pack's version is a promise: a use that compiles against a release of `kit@1` compiles against every later release of `kit@1`. A change that could break a use makes a new version, `kit@2`, and the new version ships a **migration**: statements that say how each use of `kit@1` becomes a use of `kit@2`. The tools apply it to the documents and packs that use `kit`. A migration is MKP that runs when migrating, never on a page, and the compiler checks it like any other code.

```java
package kit;

migration kit@1 to kit@2 {
    widget chart {
        rename(to = plot);
        rename(input = color, to = tone);
        set(input = values, value = values.map(fn(v) { return point { x = 0, y = v }; }));
    }

    widget badge {
        drop(input = shadow, why = "badges have no shadow in kit@2");
        set(input = size, value = size.S, when = !given(size));
        notify(input = label, why = "a label over 20 characters is cut short now", when = label.length() > 20);
    }

    widget button {
        event click {
            rename(to = press);
            add(arg = at);
        }
    }

    enum state {
        rename(from = state.LATE, to = state.OVERDUE);
    }
}
```

- **A migration** belongs to the pack of the version it moves to, as one of its files, by convention `migrations/kit@2.mkp`. `kit@3` holds `migration kit@1 to kit@2` and `migration kit@2 to kit@3`, so a use written for `kit@1` moves through each in turn. A pack may drop its oldest migrations, and a use older than them is then left for a person.
- **A block** says what happens to the uses of one declaration. It is headed by the declaration's kind and its `kit@1` name: `widget chart`, `record stat`, `enum state`, `token color`, `fn text.slug`. A widget's event has a block of its own inside the widget's, `event click { … }`.
- **Statements apply in order**, each to what the one before it left: after `rename(to = plot)`, the block is working on `plot`.
- **A statement is a call with named arguments.** Where a parameter takes a name, the argument is written bare and checked: `input = color` is an input `chart` had in `kit@1`, and `to = tone` one `plot` has in `kit@2`. Anywhere else a name is the value the use gave, so in `set(input = values, value = values.map(…))` the first `values` is the input and the second its value. A case is written in full, `state.LATE`.
- **`why`** is a text any statement takes. It is shown to whoever migrates, beside each change. Leaving it out of a statement that changes a use is a warning, `rename` aside, whose new name says what changed; `notify` says nothing without it, so there it is a compile error.
- **`when`** is a condition some statements take, over the use: its inputs by name, `given(name)`, constants, and `&&`, `||` and `!`. The statement applies to the uses where it holds.
- **The words** `migration`, `to` and `execute` mean something only where a migration is written, so they stay free as names.

| Statement | What it does to each use |
|---|---|
| `rename(to = …)` | The declaration has a new name. Every reference changes: calls, imports, types, record literals and `match` cases. With `input =`, `slot =`, `field =` or `arg =`, a member has one, and with `from =`, a case. The new name may be one a pack `kit@2` uses provides; a file that then needs an import is given it |
| `move(from = …, to = …)` | What the use gives moves to another place: an input, a field of a record input (`style.color`), a slot, or, after a `wrap`, an input or slot of the widget around it (`frame.title`). The two places' types decide the conversion: a text moved into a slot becomes prose, a variable becomes a hole, and a slot moves into a text only where it holds plain text. A use that gives nothing moves nothing |
| `set(input = …, value = …, when = …)` | The value is written where `when` holds, or into every use without it. The value may read the use's inputs, so `set` also converts. `field =` and `arg =` name a record's field and a fn's argument |
| `drop(…)` | A member, or with no member the declaration, is gone. A value the use gives it is taken out. Code written into it, such as a slot's view or a whole use of a dropped widget, stays as a comment that names the migration and why |
| `wrap(parent = …)` | Each use is put inside a new widget |
| `notify(why = …, when = …)` | Nothing changes. Whoever migrates is told, beside each use where `when` holds |
| `execute { … }` | Any change. A fn body from the `kit@1` use to the `kit@2` one |

- **`execute`** sees the `kit@1` use's inputs, slots and events by name. An input the use left out reads as `kit@1`'s default, and `given(name)` says whether the use wrote it. It returns the `kit@2` use, or nothing to remove the use. Every other statement is shorthand for an `execute`, and `notify`, `ask` and `confirm` can be called in one.
- **On a fn and on an event**, `rename`, `add` and `drop` work from both sides of the call. A fn's use is a call: `add(arg = sep, value = "-")` writes the argument into every call. An event's use is a handler: `add(arg = at)` gives every handler the parameter, which the widget supplies. A handler written in place changes in place, and one given by name is wrapped in a fn that calls it.
- **A value is worked out when migrating** where the use gives a constant. Anything else passes through as the code it is, so `values.map(…)` is written as `sales.map(…)`. A decision about a value that isn't a constant can't be made then, so that use is put to the person, as `ask` does.
- **`ask(why = …, options = […])`** is a choice about one use, made by whoever migrates. **`confirm(why = …)`** is one yes or no for the whole migration. Each `confirm` is numbered in the order it comes up, so a yes can be given to some and not others. Whoever migrates sees every question before answering any. Where no one can be asked, the answers come from a file, and a question nothing answers stops the migration before anything is written. A use nobody answers, or that no statement can finish, stops its file from being written; whoever migrates can instead have the file written with that use left as it was and a TODO above it.
- **A migration fn**, `migration fn name(…) { … }`, is a migration to reuse. Its parameters are names, such as an `input` or a `list<input>`, or values; its body is statements, `for`, `if` and other migration fns. Called in a block, it works on that block's declaration, and it is checked there, against that declaration. Core declares the statements and four helpers written as migration fns: `add`, a `set` for a member `kit@1` didn't have; `nest` and `flatten`, `move`s into a record and out of one; and `split`, which puts each use of one case to the person, with the cases it may become.
- **A fn in a migration** works out values for its statements, and runs only when migrating. A use that gives a variable can't have it written in, so that use is asked, unless the fn calls one that `kit@2` provides.
- **`example(before = …, after = …)`** is a test. The compiler runs `before` through its block, and an `after` that doesn't match is a compile error.

**A surface** is what a released version provided, kept beside the later ones: a file in the pack's folder whose `package` line carries the version. It holds declarations only, each widget and fn as an `extern` signature, and records, enums, token types, `tokens` blocks, aliases, interfaces and `let` constants as they were, without `require` blocks. The tools write it from the pack when a version is released, and nobody edits it. Its names are never in the pack's scope and can't be imported; it is read only against the pack and its migrations.

```java
package kit@1;

extern widget chart(values: list<number>, color: color = color.ACCENT);
extern widget badge(label: text, shadow: bool = false);

record stat {
    label: text;
    value: text;
}

enum state { DONE, TODO, LATE }
```

What the compiler checks, when it compiles the pack:

- **The promise.** A pack is compared with the surface of its own version, when it has one. A change that could break a use is a compile error that says to make a new version: a name, input, slot, event, field, case or fn that is gone; a new input or field with no default; a new case in an enum, since a `match` that lists every case no longer does; a type that accepts less than it did; a changed default, since it changes every use that leaves the input out; a fn or an event whose arguments or result changed. A new declaration, a new input or field with a default, a new token case and a type that accepts more are not breaks. A new name can still clash with a name a document declares when the document imports the whole pack; importing single names avoids that.
- **Each migration against the version it starts from.** `migration kit@1 to kit@2` needs the surface `package kit@1;`. Each block type-checks as a fn from a `kit@1` use to a `kit@2` use, so a name that isn't there, a value of the wrong type and a required input left out are compile errors where they are written.
- **And complete.** Applied to `kit@1`'s surface, the blocks must give exactly what `kit@2` provides. A declaration or a member they leave unaccounted for is a compile error.

A use moves exactly, never by searching the text. Each file is compiled against the surfaces of the versions it was written for, so every reference to the pack is known, including through `import kit.chart as c` and in a record literal whose type comes from where it stands, and only those references change. A word in prose and a file's own declaration of the same name stay as they are. Each change is an edit where the reference is, so the rest of the file, comments included, stays as it was. Before anything is written, whoever migrates is shown every deletion a `drop` makes, each with its file and line. After the last migration, the file is compiled against the pack as it is now; a file that doesn't compile is left unchanged and reported with its errors, unless whoever migrates asks for it to be written all the same. A pack that uses `kit` moves the same way, and its `uses kit@1` becomes `kit@2`. A document writes no versions, so the version it was written for is kept by whatever builds it, beside it.

Migrations and surfaces never reach a page: the IR has neither, and building a document never reads them.

The compiler writes a build in two forms. The **IR** is what a target runs: checked and lowered, with no Markdown left in it. The **resolved IR** is for tools: what the checker understood, with every name resolved to what it names and every value typed, nothing lowered, and each part's place in its source and its comments kept. `mkp migrate` works from it, and so can an editor, a linter or a program that writes MKP. Both are JSON with a versioned schema (`schemas/`): `mkp build` writes the IR and `mkp build --rir` the resolved IR, and no target reads the resolved IR.

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

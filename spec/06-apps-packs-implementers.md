# Apps, packs and implementers

Page 6 of 9. Packs and imports, tokens, talking to the app, what implementing MKP means, failures and limits.

### Packs and imports

A pack is a folder of `.mkp` files that all start with the same `package` line. They share one scope, so they use each other's declarations without importing. One of the files holds the `pack` block.

```java
package kit;

//@about A set of components for documents.
pack kit@1 {
    uses core@1, charts@2;
    provides card, stats, stat, checklist, task, tab, tabs, box;
}

tokens brand {
    color.PRIMARY = color { light = "#2563eb", dark = "#7aa7ff" };
    space.HUGE = space { px = 64 };
    font.DISPLAY = font { family = "Inter", size = 32, weight = 700 };
}
```

| Line | Meaning |
|---|---|
| `pack kit@1` | The pack's name and its version, a whole number. A new number means something that used the old one may break |
| `uses core@1, charts@2;` | The packs this one imports from, each at the version it needs. `core` is imported by every file anyway; listing it pins the version of the language and of `core` the pack is written for |
| `provides …;` | Every name other packs may import: widgets, records, enums, types, interfaces, fns and extern blocks. Anything not listed can only be used inside the pack |

- **`import kit;`** makes every name `kit` provides usable in the file. **`import kit.stats;`** brings in that one name, and **`import kit.stats as kit_stats;`** brings it in under another name.
- **Fns added to a type and tokens** come with the pack: importing any of it brings them in.
- **A clash** between two imported names, or between an import and a declaration in the file, is a compile error on the import. Import the single names you need, or rename one with `as`. Names are never written with their pack in front.
- **A document** has no `package` line and no `pack` block. It imports above its `@@@` line and writes no versions: `import kit;`. The host decides which version of each pack a document gets.
- **`@` followed by a digit** names a version, and never starts a view, because a view's `@` is always followed by a name.

### Tokens

A `tokens` block gives names to values of `token` types: `color`, `space`, `size`, `radius`, `font`, `shadow`, and any a pack declares with `token`. The block's own name is a label for people and tools. Lookup never uses it.

- **A new token** is written `type.NAME = value;` and used as `color.PRIMARY` wherever its pack is imported. Two visible tokens with one name on one type are a compile error.
- **Restyling.** Only an implementer's pack, one with an `implements` line, may give a new value to a token that `core` declares. It can't remove one or add to `core`'s names. In any other pack, naming a `core` token again is a compile error.
- **A colour needs both `light` and `dark`**, and a token's value is written out only inside a `tokens` block. Custom design is a named token in a pack's own `tokens` block, never a value written inline.

### Talking to the app

An `extern` block declares what the app supplies, and its fns are how MKP sends something to the app. An `expose` block declares fns the app may call into MKP. One name, here `scores`, ties the two halves of one channel together.

```java
package quiz;

//@about What the app and the quiz widgets tell each other.
extern scores {
    unit: text = "K";                             // used if the app gives none
    best: opt<list<number>> = opt.NONE;           // not loaded yet
    fn saved(points: number);                     // MKP calls it, the app receives it
}

// a global variable: one for this file, while the page is open
mut points: number = 0;

// MKP supplies these, and the app calls them
expose scores {
    fn clear() {
        points = 0;
    }
}

widget tally() {
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
```

- **extern values** flow from the app to MKP. Each has a type and a default, and is constant to MKP code. When the app changes one, everything that reads it is worked out again. The runtime checks each value against its type as it arrives. One that doesn't fit is dropped, the default is used, and the app is told.
- **extern fns** are the same two kinds as every fn. Without a return type, one is an action sent to the app, and can only be called from event handlers, never while drawing. With a return type, it changes nothing: it is a value only the implementer can work out, such as `moment.local`, and may be called while drawing. The implementer has to give the same answer for the same arguments.
- **Waiting.** MKP has no waiting and no callbacks. Something that isn't there yet is an `opt` extern value, and the view says what to show for both cases, as `best` does above.
- **expose** is written only at the top of a file, never in a widget, because the app has no way to say which widget on the page it means. Its fns return nothing, take constant parameters, and may assign the file's global variables.
- **extern in front of a declaration** means whoever implements MKP supplies it: `extern type`, `extern fn` and `extern widget`. Only an `extern fn` may have a body, which is its default: it runs when the implementer supplies none, and an implementer may replace it. Without a body, the implementer must supply it.
- **Keeping things.** Variables last from the file opening to it closing. To keep anything longer, MKP calls an `extern` fn and the app hands the value back as an `extern` value next time.

### Implementing MKP

MKP ships no runtime and doesn't care what the compiler is written in. It publishes a spec, the `core` pack written in MKP itself, and a conformance suite. An implementer supplies every `extern` in `core`. Passing the suite is what implementing it means.

```java
package acme;

pack acme@1 {
    uses core@1;
    implements core.draw@1, core.live@1;
    provides jump;
}

// an implementer can restyle core's tokens
tokens acme {
    color.ACCENT = color { light = "#7c3aed", dark = "#c4b5fd" };
}

// and add extern widgets of its own
//@about A link that scrolls to another widget.
extern widget jump(to: opt<view>, label: text) {
    markdown {
        \{label}
    }
}
```

`core.draw` and `core.live` are levels, fixed by this spec. They are not interfaces and are not declared in any file.

| Level | What the site can do | What needs it |
|---|---|---|
| Markdown only | Compile, and write every widget's Markdown | Nothing more. Every widget has a markdown block or is a Markdown block, so this always works |
| `core.draw` | Draw the 21 extern widgets, Markdown's own blocks among them, glyphs, tokens and page values. The other base widgets are written in MKP on top of them | Every widget |
| `core.live` | Hold `mut` variables, run events and redraw | A widget that has variables of its own, a `mut` input or an event, or that places one that does, and a file with global variables |
| `core.gfx` | Draw on a `canvas` (layers, circles, paths, placed widgets, handles), arrows between widgets, and `zoom` | Those widgets |
| `core.motion` | A reserved name for timed controls | Nothing in this spec. See page 8 |

The compiler works out the level each widget needs from the table. A call in a document that needs a level the site doesn't have shows its Markdown instead.

A runtime has written obligations, each proved by the suite: evaluation exactly as page 2 defines it, exact base-10 numbers, events run in order with one redraw, the limits below, failures contained as below, untrusted content kept sandboxed, extern values checked against their types, and accessible controls. How it manages memory is its own choice: MKP code can't make a reference cycle, so freeing a widget's values when it leaves the page, or plain reference counting, is enough.

### Failures

A failure is a bug that could not be caught at compile time. There are no exceptions to catch. Each failure is contained and reported, and the rest of the page carries on.

| Failure | When |
|---|---|
| A number that doesn't fit | A division by zero, or a result too large for decimal128 |
| A broken rule | A widget's `require`, or a slot's length contract, false for values that were not constants |
| A position outside a list | `xs[i] = value`, `remove_at` or `move` with one |
| A write that breaks a variable's contract | A value written back through a `mut` input that the caller's variable doesn't allow |
| An item used after it was removed | In the rest of the block that removed it, when the compiler could not see it |
| A limit passed | Steps, items or depth |

| Where it happens | What the reader sees | What is kept |
|---|---|---|
| While drawing a widget | That widget is replaced by a short notice with the message and the line. In Markdown it is a quote block. It is tried again when an input or variable it reads changes | The rest of the page, and all variables |
| In an event handler | Nothing changes on the page | Everything the handler changed is undone, and the handler stops |
| At compile time, when the compiler can see it | A compile error on the line | |

Every failure is also reported to the app with its message and line.

### Limits

Every loop ends, but a fn can call itself and a list can keep growing, so the runtime also counts.

| Limit | Value | Applies to |
|---|---|---|
| Items | 10,000 | Any list, text split, or range that is walked |
| Steps | 1,000,000 | One redraw or one event handler. A step is one statement, one call or one turn of a loop |
| Depth | 64 | Calls inside calls, and widgets inside widgets. The same as the renderer the docs use today |

The compiler uses the same limits when it runs `from`, `require` and contracts on constants, where passing one is a compile error.

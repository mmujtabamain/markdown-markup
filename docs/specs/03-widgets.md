# Widgets

Page 3 of 9. Writing and calling widgets, events, blocks, loops, variables, slots, pointing at a widget, and Markdown.

A widget body is, in this order: `param` inputs, `slot`s, `event`s, `require` blocks, its own `mut` and `let` variables, its fns, `view`, and `markdown` last. Only `view` and `markdown` are required. Inputs can be declared in the parentheses, in the body with `param`, or some in each.

```java
package quiz;

enum check {
    OPEN,
    RIGHT,
    WRONG,
}

//@about What the quiz widgets tell the app.
extern quizzes {
    fn answered(correct: bool, value: text);
}

//@about A question answered in a word.
//@param prompt what to ask
//@param accept the words that count as right
widget ask(
    prompt: text[1...],
    accept: list<text>[1...],
    mut entry: text = "",
) {
    event solved();

    require "no empty answers" {
        return accept.all(fn(a) { return a.trim().len() > 0; });
    }

    mut result: check = check.OPEN;

    fn fits(): bool {
        return accept.some(fn(a) { return a.like(entry); });
    }

    fn submit() {
        result = fits() ? check.RIGHT : check.WRONG;
        quizzes.answered(fits(), entry);
        if (fits()) {
            invoke solved();
        }
    }

    view {
        @column(gap = space.S) {
            @label(value = prompt);
            @row(gap = space.S) {
                @grow {
                    @field(value = entry, label = "your answer", submit = submit);
                }
                @press(label = "Check", click = submit);
            }
            match (result) {
                case check.OPEN { }
                case check.RIGHT {
                    @label(value = "Right.", tone = color.OK);
                }
                case check.WRONG {
                    @label(value = "Not quite.", tone = color.BAD);
                }
            }
        }
    }

    markdown {
        \{prompt}

        Answer: \{accept.join(" or ")}
    }
}
```

- **Events**: Declared with `event solved();`, or `event rated(got: number);` with data, and fired with `invoke solved();`. The caller sets one to a fn with the same parameters and no return type: `@ask(…, solved = add_point);`. An event nobody set does nothing, and needs nothing: a level counts what a call uses, not what a widget declares, so setting an event needs `core.live` only when its handler can change something (page 6).
- **Widgets are types**: a fn that returns an `ask` says `: ask`. Every widget also fits `view`, so a helper that can return several kinds says `: view`.
- **Own value or the caller's**: `mut entry: text = ""` gives each use its own value. A caller that passes a mutable variable, such as a field of the document's `$state`, has the widget write into it: `@ask(…, entry = $state.answer);`. Passing a constant to a `mut` input is a compile error.
- **What the Markdown shows** is up to the widget's `markdown` block. Here it shows the answer; a widget that should not show something leaves it out.
- **Doc comments**: `//@about`, `//@param` and `//@deprecated` sit directly above a declaration. A `//@param` that names no input is a compile error. `//@deprecated use stats2, which shows a trend` makes every use of the declaration a warning with that text.

### Calling a widget

```java
// an event takes a fn. One with the right parameters is passed by its name
@press(label = "One more", click = more);

// anything else is a lambda, whose types come from the event
@press(label = "Reset", click = fn() { t.n = 0; }) {
    @icon(name = glyph.RESET);
}

// the named form of the block: inputs as lines, each slot under its name
@press(label = "One more") {
    click = more;
    content {
        @icon(name = glyph.PLUS);
    }
}

// a widget with several slots always uses the named form
@box(title = "Build") {
    actions {
        @press(label = "Retry", click = retry);
    }
    body {
        @label(value = "It passed.");
    }
}
```

A block is read by its first word. `@`, `let`, `if`, `for`, `mut` or `match` means it holds children, which fill the widget's only slot. A plain name means the named form, where every line is `input = value;` or `slot { … }`. The two can't be mixed. In prose, a named slot is written `@slot name {` (page 1).

A block of children, a slot's block and a `view` block all hold the same five things and nothing else: `let`, `if`, `for`, `match`, and views. There is no assignment in a view, so `name = value;` in a block is always an input.

### Views as values

`@` starts a view expression. What follows is one of three things.

| After `@` | Arguments | Example |
|---|---|---|
| A widget | Named, with an optional block | `@label(value = "Hello")` |
| A fn that returns a view | In order | `@tile(s)` |
| A value that holds a view, or one item of a slot | None | `@body`, `@a` |

- **Drawing**: A view expression written as a statement in a view is drawn at that place. Anywhere else it is a value: after `return`, in a `let`, as an argument.
- **Names after `@`**: A name is looked up first among the values that can follow `@` (a slot, a view held in a value, a fn that returns a view), and as a widget second. Other values are skipped, so in a widget with an input called `label`, `@label(value = label);` still calls the widget `label`.
- **What can be placed**: A value whose type is `view`, a widget, `any` of a widget interface, or a type parameter bounded by one, such as `T` in `<T: chart>` (page 4).
- **Every view is visible**: A call that returns a view is always written with `@`. `tile(s)` without it is a compile error.
- **What a view value is**: A description, not something on the page. It can be held in a `let`, returned, passed to an input and placed. It can't be held in a `mut` variable or compared.
- **Reading one**: The inputs of a widget value can be read: `t.title`. They can't be assigned, and events can't be reached.

### Layout wrappers

Layout is done by ordinary widgets wrapped around an element, not by special properties on every element. `grow`, `shrink`, `basis`, `min_size`, `max_size` and `aspect` each say one thing about how big their child is, with sizes as `size` tokens, never pixels, and they nest in any order. `cell` says where a child sits in a grid, and `spot` where one sits on a `plane`, a space with coordinates of its own (page 5).

```java
@grow {
    @field(value = entry, label = "your answer");
}
@cell(span = 2, place = align.START) {
    @label(value = "Across two columns");
}
@shrink(by = 0) {
    @label(value = "Total");
}
@min_size(height = size.S) {
    @aspect(ratio = 2) {
        @image(src = "latency.png", alt = "Latency this week");
    }
}
```

- **`grow`** takes a share of the spare room: two children with `by = 1` and `by = 2` get a third and two thirds of it.
- **`shrink`** says how much a child gives back when there is too little room; `by = 0` keeps its size.
- **`basis`** is the size a child starts from, before the spare room is shared out or taken back.
- **`min_size`** and **`max_size`** stop a child getting smaller or bigger than a size.
- **`aspect`** ties its height to its width.

*The six sizing wrappers: an interactive figure, in the DevBench doc.*

### Loops

```java
package tasks;

record todo implements same {
    id: number;
    mut title: text;
    mut done: bool = false;
}

widget todo_row(mut t: todo) {
    view {
        @press(label = t.title, kind = press_kind.CHECK, selected = t.done, click = fn() { t.done = !t.done; });
    }

    markdown {
        @if (t.done) {
        - [x] \{t.title}
        } else {
        - [ ] \{t.title}
        }
    }
}

widget todo_list(mut todos: list<todo>) {
    view {
        let open: list<todo> = todos.filter(fn(x) { return !x.done; });
        @column(gap = space.S) {
            // t is an opt<todo>; opened with mut, its row may change the item, and its Delete button the list
            mut for (t in todos) {
                if (mut x: todo = t) {
                    @row(gap = space.S, align = align.CENTER) {
                        @grow {
                            @todo_row(t = x);
                        }
                        @press(label = "Delete \{x.title}", click = fn() { todos.remove(x); }) {
                            @icon(name = glyph.TRASH);
                        }
                    }
                }
            }
            // reading only. open is built anew by filter, so its rows are made again
            for (o in open) {
                @label(value = "Still open: \{o.title}", tone = color.MUTED);
            }
            @press(label = "Clear done", click = fn() { todos.remove_where(fn(o) { return o.done; }); });
        }
    }

    markdown {
        @for (t in todos) {
        @if (t.done) {
        - [x] \{t.title}
        } else {
        - [ ] \{t.title}
        }
        }
    }
}
```

```java
// ranges step by 1 unless they say otherwise
for (i in 0..10) {
    @label(value = "\{i}");               // 0 to 10
}
for (i in 0..(limit - 1)) {
    @label(value = "\{i}");               // 0 to limit - 1
}
for (i in 0..100 step 5) {
    @label(value = "\{i}");
}
for (i in 10..1 step -1) {
    @label(value = "\{i}");               // 10 down to 1
}
for (k, t in todos) {
    @label(value = "\{k + 1}. \{t.title}");   // position and item: k is an int 0...
}
```

- **for**: Reads. It walks a list, a slot that holds a list, or a range of numbers, and makes no copy: the loop variable is the item itself. The body can't change the list or its items, and a change to either is a compile error. It can still update the fn's own `mut` locals, such as a running total.
- **mut for**: Needs a `mut` list. It walks a copy of the list made when the loop starts, once per item, in the copy's order, and the copy is dropped when the loop ends. The loop variable is an `opt` for the real item: the item while it is still in the list, and `opt.NONE` once it has been removed, by this loop or by anything else. Items added during the loop aren't visited, and moving or sorting the list doesn't change the loop's order (page 2, "A list being walked").
- **Writing through**: `if (mut x: todo = t)` opens the `opt` for writing, as `if (let …)` opens one for reading. Writing `x.done = true` or removing `x` acts on the real item, wherever it now is. It opens any `opt` that can be written: a `mut` variable, a field of one, or a `mut for` variable. Once `x` is removed, it can't be used in the rest of its block.
- **Handlers in a row**: A lambda may assign an `if (mut …)` variable, as it may a `mut for` one, and the write goes to the real item. A row leaves with its item, so its handlers can't write an item that is gone.
- **Every loop ends**: `for` walks a list or a range, which holds at most 10,000 items, and `mut for` runs once for each item its list had when it started. So a loop always ends, and there is no while loop. Filtering, mapping, moving and removing by a test (`xs.remove_where(test)`) are list fns.
- **A range that runs down**: `10..1` holds nothing without a negative `step`.
- **Size**: A list or a range holds at most 10,000 items.

#### Where variables live

- **The document's `$state`**: A document's shared variables are the fields of its one `$state` block, written above its `@@@` line. Every widget and fn in the document uses them as `$state.name`, and only actions assign them. They last while the page is open, and the app can read and write them (page 6). There are no other shared variables: a `mut` at the top of a file is a compile error that points to `$state`.
- **No state in packs**: A pack's widgets share what the document passes to their `mut` inputs, such as `@tally(points = $state.points);`, so every shared value is in the document's `$state`.
- **A widget's own variables**: A `mut` in a widget body, or a `mut` input with a default that the caller didn't give. There is one per use of the widget, so two tab sets on a page each remember their own open tab.
- **Starting values run once.** `mut ticked: list<number> = ticked_first(items);` is worked out when the widget is made, with the inputs as they are then. A later change to `items` does not run it again. A value that should follow an input is a `let`.
- **A widget is the same widget while its call is the same call.** A widget on the page is identified by where its call is written: the chain of calls, loop items and branches that leads to it. Its own variables last as long as that call keeps being reached. When an `if` or `match` takes another branch, the widgets in the old branch are gone, and coming back makes new ones.
- **Rows follow their items.** The runtime knows which item of a list is which, as `mut for` does, and a widget in a loop keeps its own variables with its item: delete the first item, and the second item's row keeps its own open tab. An item it doesn't know gets a new widget, starting from its defaults. That is every item of a list built anew, by `filter`, `sorted` or `reversed`, or replaced by the app, so its rows are made again. A row's memory can be lost that way, but it never moves to another item. Focus, the caret and scrolling are the implementer's, and stay with their rows.
- **Where a view is placed does not matter.** Children are made by the caller, so they keep their variables however the widget that receives them shows, hides or reorders them. A view value placed twice is two widgets with separate variables.
- **One redraw per event.** When an event handler ends, everything that reads what it changed is worked out again, once.

State that has to survive a list built anew lives in the items. Here each note keeps whether it is being edited:

```java
record note {
    mut words: text;
    mut editing: bool = false;
}

widget notes(mut items: list<note>) {
    view {
        @column(gap = space.S) {
            mut for (n in items) {
                if (mut x: note = n) {
                    @row(gap = space.S) {
                        if (x.editing) {
                            @field(value = x.words, label = "Note", submit = fn() { x.editing = false; });
                        } else {
                            @label(value = x.words);
                            @press(label = "Edit", click = fn() { x.editing = true; });
                        }
                    }
                }
            }
        }
    }

    markdown {
        @for (n in items) {
        - \{n.words}
        }
    }
}
```

### Slots

A slot is where a caller puts content of its own. It's declared in the widget's body with `slot`, and filled only by a block, never with `=`.

| Declared | Holds | Used in the widget |
|---|---|---|
| `slot body: view;` | Anything, any amount, prose included | `@body;` |
| `slot footer: opt<view>;` | The same, and may be left out | `if (let f: view = footer) { @f; }` |
| `slot header: tab;` | Exactly one `tab` | `@header;`, `header.title` |
| `slot panels: list<tab>[1...];` | Only `tab` widgets, one or more | `for (p in panels) { @p; }`, `panels.len()`, `panels[i]` |
| `slot charts: list<any chart>;` | Any mix of widgets that fit `chart` | The same |

A slot with a widget type takes only calls of that type, with `for`, `if` and `match` around them. Text, other widgets and helpers that return `view` are compile errors there. A length contract on a slot is checked by the compiler when the children are written out one by one, and when the widget is made otherwise.

A widget fits a widget interface by its inputs and events (page 4), so an interface that a slot takes asks for something only its own kind of widget has. Core's `layer` takes `list<any shape>`, and `shape` asks for `opacity` as well as `label`, which keeps a `press` or an `icon` out of a layer (page 5).

```java
package kit;

widget box(title: text[1...]) {
    slot body: view;
    slot actions: opt<view>;

    view {
        @column(gap = space.S) {
            @row(justify = justify.BETWEEN) {
                @label(value = title, weight = weight.BOLD);
                if (let a: view = actions) {
                    @a;
                }
            }
            @body;
        }
    }

    markdown {
        **\{title}**

        \{body}
    }
}

// an input that receives a fn
widget repeat<T>(items: list<T>, entry: fn(item: T): view) {
    view {
        for (it in items) {
            @entry(it);
        }
    }

    markdown {
        \{items.len()} items
    }
}

// generics, with a bound
interface scored {
    score: number;
}

widget leaders<T: scored>(items: list<T>, name: fn(item: T): text) {
    view {
        @column(gap = space.XS) {
            for (it in items) {
                @row(justify = justify.BETWEEN) {
                    @label(value = name(it));
                    @label(value = it.score.fmt(1));
                }
            }
        }
    }

    markdown {
        @for (it in items) {
        - \{name(it)}: \{it.score.fmt(1)}
        }
    }
}
```

```java
// both forms are valid: the lambda's types written out, or taken from the input
@repeat(items = people, entry = fn(p: person): view { return @label(value = p.name); });
@repeat(items = people, entry = fn(p) { return @label(value = p.name); });

@leaders(items = players, name = fn(p) { return p.nick; });
```

### Pointing at a widget

A widget held in a variable is a view value, and any widget's input can take one. That is how one widget points at another. `acme`'s extern `jump` (page 6), a link that scrolls to another widget, takes the widget it goes to as `to`:

```java
let users_box: label = @label(value = "Users");
let orders_box: label = @label(value = "Orders");

@row(gap = space.S) {
    @jump(to = users_box, label = "Go to users");
    @jump(to = orders_box, label = "Go to orders");
}
@users_box;
@orders_box;
```

- **A held widget is a description until it is placed.** Placed twice, it is two widgets. What `jump` does with a view that is placed twice, or isn't on the page at all (a branch that wasn't taken, or a `find` that found nothing), is up to whoever supplies `jump`. The compiler checks neither: it knows nothing about what a widget does with a view it is given.
- **Any pack can do the same.** A pack may declare an extern widget that takes a view, and the pack supplies it for each target it supports. One that nobody supplies shows its Markdown (page 6).
- **For data**, keep the widgets in a list, place them in a loop, and find them with list fns. The `opt` that `find` gives goes straight into an input such as `to: opt<view>`.

### Markdown

Every widget ends with a `markdown` block: what the widget is when there is nothing to draw on. It is parsed exactly like prose below a `@@@` line, by the rules on page 1, so it lowers onto the same Markdown blocks, with `@if`, `@for` and `@match` for logic. It uses the starting values of any variables. A widget declared in a document may leave the block out, and MKP builds it from the view.

- **Holes**: A hole that holds a slot or a widget value puts that view's own Markdown there, which is how `\{body}` in `box` works. A hole that holds a value that fits `shown` puts in its text, as plain text that is never read as Markdown. So a hole can't write a task box: `todo_row` writes `[x]` and `[ ]` itself, with `@if`.
- **An `opt` in a hole**: A paragraph with a hole that holds an `opt` is a compile error that names the hole, because a literal with an `opt` hole is an `opt` (page 4) and `paragraph` takes a `rich_text`. For a `stat` called `s` (page 2), give the hole a fallback, as in `\{s.note.or("none")}`, or open the value first with `@if (let n: text = s.note) {`.
- **Markdown values**: An `md` holds blocks, so it goes in no hole. `@blocks(value = note);` places them, in a view or in a `markdown` block (page 5).
- **Lists**: List items that follow one another make one list, across a loop's turns too. Any other block ends the list, and the next item starts a new one. A list that ends up with no items, such as one from a loop over an empty list, writes nothing.
- **Quotes and list items**: A call, a control line or a closing `}` can't start inside a Markdown quote or list item, as in prose: it is a compile error that says to use `@quote`, or `@bullets` and `@item`.
- **Writing nothing**: An empty block, `markdown { }`, says the widget writes nothing, for parts whose meaning the widget around them writes, such as a canvas's shapes. The compiler warns where such a widget is declared, so the warning shows whenever that file is compiled, a pack's included. A warning never stops a page from compiling.

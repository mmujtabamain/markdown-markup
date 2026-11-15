# Widgets

Page 3 of 9. Writing and calling widgets, events, blocks, loops, variables, slots, ids and Markdown.

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

- **Events**: Declared with `event solved();`, or `event rated(got: number);` with data, and fired with `invoke solved();`. The caller sets one to a fn with the same parameters and no return type: `@ask(…, solved = add_point);`. An event nobody set does nothing.
- **Widgets are types**: a fn that returns a `ask` says `: ask`. Every widget also fits `view`, so a helper that can return several kinds says `: view`.
- **Own value or the caller's**: `mut entry: text = ""` gives each use its own value. A caller that passes a mutable variable has the widget write into it: `@ask(…, entry = e);`. Passing a constant to a `mut` input is a compile error.
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
- **Every view is visible**: A call that returns a view is always written with `@`. `tile(s)` without it is a compile error.
- **What a view value is**: A description, not something on the page. It can be held in a `let`, returned, passed to an input and placed. It can't be held in a `mut` variable or compared.
- **Reading one**: The inputs of a widget value can be read: `t.title`. They can't be assigned, and events can't be reached.

### Layout wrappers

Layout is done by ordinary widgets wrapped around an element, not by special properties on every element. `grow`, `shrink`, `basis`, `min_size`, `max_size` and `aspect` each say one thing about how big their child is, with sizes as `size` tokens, never pixels, and they nest in any order. `cell` says where a child sits in a grid.

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
        - [\{t.done ? "x" : " "}] \{t.title}
    }
}

widget todo_list(mut todos: list<todo>) {
    view {
        let open: list<todo> = todos.filter(fn(x) { return !x.done; });
        @column(gap = space.S) {
            // each row may change its item, and its Delete button the list
            mut for (t in todos) {
                @row(gap = space.S, align = align.CENTER) {
                    @grow {
                        @todo_row(t = t);
                    }
                    @press(label = "Delete \{t.title}", click = fn() { todos.remove(t); }) {
                        @icon(name = glyph.TRASH);
                    }
                }
            }
            // reading only
            for (x in open) {
                @label(value = "Still open: \{x.title}", tone = color.MUTED);
            }
            @press(label = "Clear done", click = fn() { todos.remove_where(fn(x) { return x.done; }); });
        }
    }

    markdown {
        @for (t in todos) {
        - [\{t.done ? "x" : " "}] \{t.title}
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
    @label(value = "\{k + 1}. \{t.title}");   // position and item
}
```

- **for**: The loop variable and the list are constant. It walks a list, a slot that holds a list, or a range of numbers.
- **mut for**: Needs a `mut` list. The loop variable writes through to the item, so `t.done = true` changes that item. The list is read again before every iteration, and the loop takes the next position (page 2, "A list being walked").
- **Every loop ends**: Both loops walk a list or a range, and a list holds at most 10,000 items, so a loop always ends. There is no while loop: removing while walking is `xs.remove_where(test)`, and filtering, mapping and moving are list fns too.
- **A range that runs down**: `10..1` holds nothing without a negative `step`.
- **Size**: A list or a range holds at most 10,000 items.

#### Where variables live

- **Global variables**: A `mut` at the top of a file. There is one per file, and it lasts while the page is open.
- **A widget's own variables**: A `mut` in a widget body, or a `mut` input with a default that the caller didn't give. There is one per use of the widget, so two tab sets on a page each remember their own open tab.
- **Starting values run once.** `mut ticked: list<number> = first(items);` is worked out when the widget is made, with the inputs as they are then. A later change to `items` does not run it again. A value that should follow an input is a `let`.
- **A widget is the same widget while its call is the same call.** A widget on the page is identified by where its call is written: the chain of calls, loop positions and branches that leads to it. Its own variables last as long as that call keeps being reached. When an `if` or `match` takes another branch, the widgets in the old branch are gone, and coming back makes new ones.
- **Rows go by position.** A row is whatever item is at its position. That is right as long as a row keeps nothing of its own, so in a loop over a list that isn't a constant, a widget with its own variables is a compile error. It says to keep the value in the item, or with the caller under an id of its own. Over a constant list or a range, rows may keep their own variables, because positions never shift. Focus, the caret and scrolling are the implementer's, and follow positions.
- **Where a view is placed does not matter.** Children are made by the caller, so they keep their variables however the widget that receives them shows, hides or reorders them. A view value placed twice is two widgets with separate variables.
- **One redraw per event.** When an event handler ends, everything that reads what it changed is worked out again, once.

A row that needs a switch of its own, such as an Edit button, keeps it in the item:

```java
record note {
    mut words: text;
    mut editing: bool = false;
}

widget notes(mut items: list<note>) {
    view {
        @column(gap = space.S) {
            mut for (n in items) {
                @row(gap = space.S) {
                    if (n.editing) {
                        @field(value = n.words, label = "Note", submit = fn() { n.editing = false; });
                    } else {
                        @label(value = n.words);
                        @press(label = "Edit", click = fn() { n.editing = true; });
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

A widget held in a variable is how one widget points at another. An `arrow` (page 5, `core.gfx`) joins two widgets that are on the page:

```java
let users_box: label = @label(value = "users");
let orders_box: label = @label(value = "orders");

@row(gap = space.XL) {
    @users_box;
    @orders_box;
}
@arrow(from = users_box, to = orders_box, label = "places");
```

- **A held widget is a description until it is placed.** Placed twice, it is two widgets. So a widget used as an arrow's end has to be placed exactly once in the same view, and the compiler checks that.
- **An end that isn't on the page draws no arrow**: a branch that wasn't taken, or a `find` that found nothing.
- **For data**, keep the widgets in a list, place them in a loop, and find them with list fns. Page 7 has a diagram of tables drawn this way.

### Markdown

Every widget ends with a `markdown` block: what the widget is when there is nothing to draw on. It is prose, read by the rules on page 1, with `@if`, `@for` and `@match` for logic. It uses the starting values of any variables. A widget declared in a document may leave the block out, and MKP builds it from the view.

A hole that holds a slot or a widget value puts that view's own Markdown there, which is how `\{body}` in `box` works. A hole that holds anything else puts in escaped text.

# Interfaces

Page 4 of 9. Fitting an interface, the six standard interfaces, operators, literals, generics and widget interfaces.

An interface names what a type can do: fields and fns, or for a widget its inputs and events. There's no inheritance. Interfaces only describe, and they never give a type anything. Inside an interface, `self` is the type that fits it.

### Fitting one

```java
package kit;

interface labelled {
    label: text;
}

// a promise, checked here: a missing label is reported on this line
record labelled_stat implements labelled {
    label: text[1...];
    value: text;
}

// a fn added to an interface works for every type that fits it
fn labelled.initial(self): text {
    return self.label.slice(0, 1).upper();
}
```

```java
// fits too, without saying so, because it has a label
let svc: { label: text, up: bool } = { label = "api", up = true };

let first: text = labelled_stat { label = "Deploys", value = "42" }.initial();    // "D"
let second: text = svc.initial();                                                // "A"
```

**A type fits an interface when it has what the interface asks for.** That is the one rule, for every interface, the six standard ones included. `implements` is a checked promise, written where the type is declared: a missing field or fn is reported on that line. A type that doesn't say it still fits, so inline records and other packs' types fit too, and it is still checked at compile time.

What counts towards fitting is fixed, so a type fits an interface everywhere or nowhere:

- **Fields.** A field the interface asks for is met by a field of that name whose type is accepted where the interface's type is wanted. An interface can't ask for a `mut` field.
- **Fns.** Only fns declared in the pack of the type or in the pack of the interface count, and their signatures have to match exactly.
- **Helpers from elsewhere.** Any pack can still add a fn to any type, as `stat.line` on page 2 does. Such a fn can be called wherever it is imported, and it never makes a type fit anything. Two visible fns with one name on one type are a compile error, so one of them is imported under another name: `import b.slug as b_slug;` (page 6).

### The standard interfaces

The language's own features are built on six interfaces, which core declares as ordinary interfaces (page 5), so your types can join in, by having what they ask for. A fn in an interface writes `self` when it's called on a value. The one fn without it, `from`, is called on the type, as any fn declared without `self` is, such as `email.from(entry)` below. The compiler calls it for every literal.

```java
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
```

| Type | Fits |
|---|---|
| `number`, `duration` | shown, same, ordered, numeric, scaled. `number`'s `*`, `/` and `%` are built in |
| `text`, `bool` | shown, same, ordered |
| `point`, `date` (core) | `point`: shown, same, numeric, scaled. `date`: shown, same, ordered, literal&lt;text> |
| Enums | same, when every value they carry does. Enums whose cases carry nothing also fit ordered, in the order written |
| Tokens | same, like enum cases: by case, never by value. Not ordered: packs may add cases, so they have no order |
| Records | same, when all their fields do, compared field by field, unless their pack writes a `same` fn for them, which is then what `==` and `!=` mean. Anything else, they get from fns written in their pack |
| Inline records, lists, `opt` | same, when their parts do |
| `view`, widgets, fns | none of the six |

- **Tokens compare as cases.** `color.OK == color.OK`, and `color.C1 != color.ACCENT` even when a theme gives them one value. A case that carries a value equals the same case with the same value, and never a named case: `stroke.PX(2) == stroke.PX(2)`, and `stroke.PX(2) != stroke.BOLD`.
- **`==` stays strict**: both sides are the same type. So `stroke.BOLD == 2` is false, because the `2` becomes `stroke.PX(2)`. To compare values, take them out first: for a `stroke` called `w`, `let a: number = w;` and `let b: number = stroke.BOLD;`, then `a == b`.

### Operators on your own types

There is no operator overloading. An operator is shorthand for an interface's fn.

| Written | Means | Needs |
|---|---|---|
| `a == b`, `a != b` | `a.same(b)`, `!a.same(b)` | same |
| `a < b`, `a > b` | `a.before(b)`, `b.before(a)` | ordered |
| `a <= b`, `a >= b` | `!b.before(a)`, `!a.before(b)` | ordered |
| `x in r` | `r.has(x)` | ordered |
| `a + b`, `a - b` | `a.add(b)`, `a.sub(b)` | numeric |
| `a * k`, `k * a` | `a.scale(k)` | scaled, and `k` is a number |
| `a / k` | `a.scale(1 / k)` | scaled |
| `-a` | `a.scale(-1)` | scaled |

`before` has to be a strict order: never true both ways, and never true of a value and itself. Sorting keeps equal items in the order they had.

```java
record vec2 implements numeric, scaled, shown {
    x: number;
    y: number;
}

fn vec2.add(self, other: vec2): vec2 {
    return vec2 { x = self.x + other.x, y = self.y + other.y };
}

fn vec2.sub(self, other: vec2): vec2 {
    return vec2 { x = self.x - other.x, y = self.y - other.y };
}

fn vec2.scale(self, k: number): vec2 {
    return vec2 { x = self.x * k, y = self.y * k };
}

fn vec2.show(self): text {
    return "(\{self.x}, \{self.y})";
}

fn middle(a: vec2, b: vec2): vec2 {
    return (a + b) / 2;                  // a.add(b).scale(0.5)
}
```

### Literals for your own types

A type that fits `literal<T>` takes a literal of `T` wherever it's the type expected, and the literal is a call to the type's `from`. `from` returns an `opt`, `opt.NONE` for a value that doesn't make one, and is written like any other code: `try` in front of a record turns a broken contract or `require` block into `opt.NONE`. For a literal, the compiler calls `from` at compile time, as it runs any value fn on constants, and `opt.NONE` is a compile error on the literal's own line, with the message of the rule that failed. `from` is an ordinary fn on the type, so it can also be called by name.

```java
record email implements literal<text>, shown {
    address: text[3...];

    require "an email address has an @" {
        return address.has("@");
    }
}

fn email.from(value: text): opt<email> {
    return try email { address = value };    // checks text[3...] and the require block
}

fn email.show(self): text {
    return self.address;
}

record money implements literal<number>, numeric, scaled, ordered, same, shown {
    cents: int;
}

fn money.from(value: number): opt<money> {
    return money { cents = (value * 100).round() };    // never NONE: a plain value is accepted where an opt is wanted
}

fn money.add(self, other: money): money {
    return money { cents = self.cents + other.cents };
}

fn money.sub(self, other: money): money {
    return money { cents = self.cents - other.cents };
}

fn money.scale(self, k: number): money {
    return money { cents = (self.cents * k).round() };
}

fn money.before(self, other: money): bool {
    return self.cents < other.cents;
}

fn money.show(self): text {
    return (self.cents / 100).fmt(2);
}

let to: email = "ops@example.com";    // email.from gives opt.SOME at compile time
let price: money = 4.99;
let total: money = price * 3;         // through scaled

fn entered(entry: text): opt<email> {
    return email.from(entry);         // when the page runs: an opt, the same as try
}
```

- **A bad literal**: `let broken: email = "nobody";` is a compile error that says "an email address has an @".
- **A value typed by a reader** may be wrong, so it gives an `opt`: `email.from(entry)` and `try email { address = entry }` are both an `opt<email>`.
- **Tokens**: A token type may fit `literal<T>` through a case that carries one value of the token's type, and a `from` that makes that case. Core's `stroke` does, with its case `PX(px: number 0.25..16)` and `fn stroke.from(value: number): opt<stroke>` (page 5), so a plain number is accepted where a `stroke` is wanted: `width = 2.5` is `stroke.PX(2.5)`. The page's own colours, spacing and sizes take tokens only.
- **What the compiler can run**: `from`, `require` blocks and contracts on constants are run at compile time. That works for any fn that returns a value and reads only its arguments and constants. Extern values and variables are not constants. An extern fn that returns a value is run with the implementer's version when the compiler is told which implementer the page is for, and with its default body otherwise. With neither, the call waits for the page to run.

#### Literals with holes

A literal with holes, where a type that fits `literal<template>` is wanted, reaches `from` as a `template`: core's record of the literal's pieces and its holes, kept apart (page 5). `from` places each hole as a value and never reads it as text, so a hole can't turn into formatting. Core's `rich_text`, `md` and `latex` fit `literal<template>`, and a pack's type can too.

```java
@paragraph(value = "Read **this**, \{name}.");
// rich_text.from gets template { pieces = ["Read **this**, ", "."], holes = [hole.TEXT(name.show())] }
```

- **A hole that holds an `opt`** makes the literal an `opt` of its type, and `opt.NONE` when the hole is `NONE`. With page 2's `stat`, `"Note: \{s.note}"` where a `rich_text` is wanted is an `opt<rich_text>`, which `paragraph` doesn't take. A fallback in the hole, `\{s.note.or("none")}`, makes it a plain `rich_text` again.
- **A hole that `from` would have to read** is a compile error that names the hole and says to build the record instead. A type that takes no `template` would get the hole glued into the text and parsed again, so in `let start: date = "2026-\{month}-01";` even a month of 7 would fail, as "2026-7-01". The fix is `date { year = 2026, month = month, day = 1 }`, where `month` is proved to fit `date`'s field like any value given to a contract (page 2).
- **Only holes that are placed, never read, stay in literals**: those of text, `rich_text`, `md` and `latex`. For a literal, `from` runs only at compile time, where a hole is a value it can place but not see.

That covers every piece of syntax a type can join: literals, holes, `==`, `<` and sorting, ranges, and arithmetic. New symbols are left out on purpose: a pack can't add an operator, a literal form like `250ms`, or `for` and `xs[i]` on its own types (it gives them a fn that returns a list instead). Every file then reads the same way, and every symbol in it is one the reader already knows.

### Generics

```java
fn caption<T: labelled>(xs: list<T>): text {
    return xs.map(fn(x) { return x.label; }).join(", ");
}

fn total<T: numeric>(xs: list<T>): opt<T> {
    return xs.sum();
}

// two bounds on one parameter
fn priced<T: labelled + shown>(x: T): text {
    return "\{x.label}: \{x}";
}

// a generic record
record pair<A, B> {
    first: A;
    second: B;
}

// a list widget that shows any labelled data
widget picker<T: labelled>(items: list<T>, mut chosen: number = 0) {
    view {
        @column(gap = space.XS) {
            for (k, it in items) {
                @press(label = it.label, kind = press_kind.OPTION, selected = chosen == k, click = fn() { chosen = k; });
            }
        }
    }

    markdown {
        @for (it in items) {
            - \{it.label}
        }
    }
}
```

- **Type arguments are never written at a use.** `pair { first = 1, second = "one" }` and `@picker(items = people)` work them out from the values, and `xs.map(fn(x) { return x.label; })` works out `U` from what the lambda returns. So every type parameter has to appear in a parameter, an input, a field or a slot. Angle brackets are only ever written in a type, never in an expression.
- **A bound** `T: labelled` is read "T, which fits labelled". A bound names an interface, with its type arguments if it has any: `T: literal<text>`. Type parameters are always capitals, so a reader sees at once which types in a signature are generic.
- **Constant values widen, shared values don't.** A constant `list<bar_chart>` is accepted where a `list<any chart>` is wanted, and a `list<number 0..10>` where a `list<number>` is. A `mut` value has to have exactly the type that is wanted, with no widening to `any`. Its contract may be narrower, item by item for lists, and every value written back is checked against it (page 2).

### Widget interfaces

A `widget interface` lists inputs and events, and only widgets fit it.

```java
package charts;

widget interface chart {
    title: text;
    event picked(index: number);
}

record bar {
    label: text;
    value: number 0...;
}

fn tallest(items: list<bar>): number 0... {
    mut best: number 0... = 0;
    for (b in items) {
        if (b.value > best) {
            best = b.value;                  // b.value is a number 0...
        }
    }
    return best;
}

widget bar_chart(title: text, items: list<bar>[1...]) implements chart {
    event picked(index: number);

    view {
        @column(gap = space.XS) {
            @label(value = title, weight = weight.BOLD);
            for (k, b in items) {
                @press(label = b.label, kind = press_kind.PLAIN, click = fn() { invoke picked(k); }) {
                    @meter(value = b.value, max = tallest(items), label = b.label);
                }
            }
        }
    }

    markdown {
        **\{title}**

        @for (b in items) {
            - \{b.label}: \{b.value}
        }
    }
}

// accepts any mix of widgets that fit chart, from any pack
widget dashboard() {
    slot charts: list<any chart>[1...];

    view {
        @grid(cols = cols.EQUAL(2), gap = space.L) {
            for (c in charts) {
                @c;
            }
        }
    }

    markdown {
        @for (c in charts) {
            \{c}
        }
    }
}

// all the same kind, whichever it is: every item is the same T
widget compare<T: chart>() {
    slot charts: list<T>[2...];

    view {
        @row(gap = space.L) {
            for (c in charts) {
                @grow {
                    @c;
                }
            }
        }
    }

    markdown {
        @for (c in charts) {
            \{c}
        }
    }
}
```

The parent can read what the interface promises: `c.title` works for every chart. The app finds widgets the same way, by interface and never by a widget's name.

### One kind, or any kind

A bare interface name is never a type on its own, so it can't be confused with a generic bound. There are two ways to use one, and they mean different things.

- **`any chart`** is read as "any type that fits chart". A list of them can mix a bar_chart and a line_chart, and code can use only what the interface promises. A constant can hold one: `let pick: any chart = @bar_chart(title = "Latency", items = bars);`.
- **`<T: chart>`** is read as "one type T, which fits chart". Every item is the same kind, and the compiler knows which, so a fn that takes a `T` and returns a `T` gives back the exact type it was given.
- **`chart` alone** as a type is a compile error that points to both.
- **Where `any` works**: For an interface that uses `self` only in front of the dot or as a return type. `any shown` and `any chart` are fine. `any same`, `any ordered` and `any numeric` are compile errors, because comparing or adding two values needs both to be the same type. Use `<T: same>` there.
- **Drawing**: Only a `view`, a widget type, `any` of a widget interface, or a type parameter bounded by a widget interface (`<T: chart>`, as in `compare`) can be placed with `@`.

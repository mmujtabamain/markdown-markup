# Values and types

Page 2 of 9. Records, enums, constant and mut, passing values, optional values, numbers, contracts and the proofs they need, and what a fn may change.

Eight types are built in, because the syntax makes them: `number`, `bool`, `text`, `duration`, `list<T>`, `opt<T>`, `range<T>` and `view`. Everything else, from `int`, `point`, `date`, `moment`, `latex`, `md` and `template` to the token types, the options and `page`, is declared in `core`, the standard library, which is written in Extended Mark and imported by every file. Page 5 has all of it.

A type is written in one of five forms.

| Form | Example | Meaning |
|---|---|---|
| A name | `stat`, `list<stat>`, `T` | A built-in or declared type, with its type arguments, or a type parameter (always capitals) |
| Any fitting type | `any chart` | Any type that fits the interface `chart` |
| A fn | `fn(item: T): bool`, `fn(item: T)` | A fn. With no return type it returns nothing. The parameter names are for the reader and are not part of the type |
| An inline record | `{ name: text, up: bool }` | A record with no declared name |
| With a contract | `number 0..10`, `int 1...`, `text[1...]` | Any of the above, narrowed. See Contracts below |

```java
package quiz;

//@about How far a job has got.
enum stage {
    IDLE,
    RUNNING,
    FAILED(why: text),
    DONE,
}

//@about One tile.
record stat {
    label: text[1...];               // required
    value: text;                     // required
    change: opt<text> = opt.NONE;    // optional, may be absent
    note: opt<text> = opt.NONE;
    tone: opt<color> = opt.NONE;
    size: int 1... = 16;             // optional, falls back to 16
    mut seen: bool = false;          // can change
}

// another name for a type, not a new type
type percent = number 0..100;

let limit: number = 10;

// returns a value, so it can't change anything
fn moved(s: stat): color {
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

// a fn added to a type, called on a value: s.line()
fn stat.line(self): text {
    return "- **\{self.label}**: \{self.value}";
}

// a fn on the type itself, with no self: stat.blank("Deploys")
fn stat.blank(label: text[1...]): stat {
    return stat { label = label, value = "-" };
}

// returns nothing, so it may change its mut parameter
fn mark(mut s: stat) {
    s.seen = true;
}
```

- **Making a record**: `stat { label = "Deploys", value = "42" }`. A field with `= value` can be left out, and one without must be given. Use a default when there's a sensible value, and `opt<T>` when "not given" itself means something. A record with `require` blocks runs them when it is made (Bigger rules, below).
- **Changing one field of a constant record**: `s with { seen = true }` is a copy of `s` with that field replaced.
- **Enum cases**: `stage.FAILED("timeout")` gives the case its values in order. They are read back with `match`.
- **Tokens** are enums too. `token space: number 0... { XS, S, M, L, XL }` lists the cases and the type of the value each stands for, and the values are given in a `tokens` block (page 5). A case is accepted where its value's type is wanted, one way only, as a plain value is where an `opt` is: `let gap: number = space.M;`. A record value's fields are reached straight through it: `color.INK.light`. Tokens compare as cases, so `color.OK != color.ACCENT` even where a theme gives the two one value.
- **Fns on a type**: `stat.line` has `self`, so it is called on a value: `s.line()`. `stat.blank` has none, so it is called on the type: `stat.blank("Deploys")`. Any pack can declare either kind. In `name.f(…)`, `name` is a value when a value of that name is visible, and a type otherwise, so there is one reading.
- **`type`** gives a type another name. `percent` and `number 0..100` are the same type everywhere. A contract written after the name adds to its own: core's `int` is `number step 1`, so `int 0..10` is `number 0..10 step 1`. Two contracts that can't both hold, such as `int step 0.5`, are a compile error.
- **Comparing records**: `==` compares two records field by field, unless their pack writes a `same` fn for the record. Then that fn is what `==` and `!=` mean (page 4).
- **Recursion**: A record or an enum may hold its own type only inside a `list` or an `opt`. A fn may call itself, and a widget may place itself. All of them are bounded by the depth limit on page 6.

### Constant and mut

| Where | Constant (default) | Mutable |
|---|---|---|
| Local in a fn | `let x: number = 0;` | `mut x: number = 0;` |
| Top of a file | `let limit: number = 10;` (a constant) | None: a `mut` here is a compile error |
| A document's `$state` | None | `tries: int = 0;` in the `$state` block, used as `$state.tries` |
| In a widget | `let n: number = a + 1;` | `mut open: number = 0;` (the widget's own variable) |
| Widget input | `t: tally`, or `param t: tally;` in the body | `mut t: tally`, or `param mut t: tally;` |
| fn parameter | `fn f(t: tally)` | `fn f(mut t: tally)` |
| Lambda parameter | `fn(t: tally) { … }` | `fn(mut t: tally) { … }` |
| Record field | `size: number = 1;` | `mut n: number = 0;` |
| Inline record | `{ name = "api" }` | `{ mut up = true }` |
| Loop variable | `for (t in todos)` | `mut for (t in todos)`, where `t` is an `opt` for the real item |
| Opening an `opt` | `if (let c: text = s.change)` | `if (mut x: todo = t)` |
| extern value | Constant to Extended Mark code | None |

- **Every `let` and `mut` writes its type**, `if (let c: text = …)` and `if (mut x: todo = …)` included. Names bound by `for` and `case` take the type of what they walk or open, because they are not declarations: in `mut for (t in todos)`, `t` is an `opt<todo>`.
- **A literal takes the type that is expected**: `stat { … }`, `[1, 2]` and `opt.NONE` are checked against the declared type. With nothing to aim for, as in `"\{42}"`, `42` is a `number`.
- **A literal with holes** is an `opt` when one of its holes is (Optional values, below). A literal whose type's `from` would have to read a hole is a compile error that names the hole and says to build the record: `"2026-\{month}-01"` is no `date`, and `date { year = 2026, month = month, day = 1 }` is, with `month` proved to be an `int 1..12`. A hole is glued in as text and parsed again, so even a month of 7 would fail as `2026-7-01`. Holes stay in literals only where they are placed and never read: in `text`, `rich_text`, `md` and `latex` (page 4).
- **A lambda's types may come from where it is used.** Passed to an input, a parameter or an event, or given to a `let` that writes its type, a lambda may leave out its parameter types and its return type: `fn(p) { return p.nick; }`. Anywhere else it writes them all. Writing them is always allowed.

### Passing values

Everything is passed by reference. A plain parameter or input is read-only, so whether the fn sees the caller's value or a copy can't be told apart, and nothing is copied to make a call. `mut` on a parameter, an input or `self`, and a name opened with `if (mut …)`, let it write through to the value it stands for, and the caller has to pass something mutable.

Assigning makes a value of its own. `let b: stat = a;`, `mut out: list<number> = xs;` and `return a;` give the new name its own value, so changing one never changes the other. The implementer copies only when one of them is changed.

```java
fn sorted_copy(xs: list<number>): list<number> {
    mut out: list<number> = xs;      // out is its own value: xs is untouched
    out.sort();
    return out;
}

fn sweep(mut stats: list<stat>) {
    mut for (t in stats) {           // t is an opt<stat>, for the real item
        if (mut s: stat = t) {       // still in the list
            if (s.seen) {
                stats.remove(s);     // the loop goes on with the next item of its copy
            } else {
                s.seen = true;       // writes the real item, wherever it now is
            }
        }
    }
}
```

- **One value, one mut**: The same variable, or a variable and a part of it, can't be passed to a `mut` parameter and to another parameter of the same call. A name opened from a `mut for` variable comes from the loop's copy, so `stats.remove(s)` passes the list and an item, not the list and a part of itself.
- **A list being walked**: `mut for (t in xs)` walks a copy of `xs` made when the loop starts, once per item, in its order, so it always ends. `t` is an `opt` for the real item: `opt.NONE` once it has been removed, by this loop or by anything else. Opened with `if (mut x: T = t)`, writing to `x` or removing it acts on `xs`, wherever the item now is, even after the list has been moved or sorted. Items added during the loop aren't visited; they are in the list after it. The copy is dropped when the loop ends, and a loop that changes nothing copies nothing.
- **Plain `for` makes no copy.** It can't change the list it walks or its items, and a change to them in its body is a compile error. It can still update its own locals, such as a running total.
- **After a removal**: Once a body or an event handler removes `x` from its list, `x` can't be used in the rest of that block. It is a compile error when the compiler can see it, and a failure when it can't.
- **Lambdas**: A lambda reads its parameters, and the constants, `let`s and `for` variables around it, as they were when it was made. The variables it may assign it reads and writes where they live, so after `$state.tries = $state.tries + 1;` the next read sees the new value. A lambda with no return type may assign `$state`'s fields, the widget's own variables, a `mut` input, and a `mut for` or `if (mut …)` variable, whose writes go to the real item. A row leaves the page with its item, so its handlers can never write an item that is gone. A lambda can't assign a `mut` local of the fn it is written in.
- **Derived values**: A `let` at the top of a document or in a widget or a view is worked out again whenever something it reads changes, such as a `$state` field or an input. One whose expression is a constant is a constant (Contracts, below). A `let` inside a fn is an ordinary local.
- **Memory** is the implementer's. Extended Mark code has no pointers, no freeing and no null, and indexing gives an `opt`, so it can't cause a memory error. Values can't form cycles, because assigning makes a value of its own and a reference can't be stored, so no tracing garbage collector is needed.

### Optional values

```java
// open it: c exists only inside the block
if (let c: text = s.change) {
    @label(value = c);
} else {
    @label(value = "no change");
}

// or give a fallback
@label(value = s.label, tone = s.tone.or(color.MUTED));

// or handle both cases
match (s.note) {
    case opt.SOME(n) {
        @label(value = n);
    }
    case opt.NONE { }
}
```

Using an `opt<color>` where a `color` is wanted is an ordinary type error. A plain value is accepted where an `opt` is wanted: `tone = color.OK`. To change the value inside an `opt`, open it with `if (mut x: T = …)` instead of `let`: on a `mut` variable, a field of one, or a `mut for` variable, writing to `x` writes the value inside.

- **A literal with an `opt` hole** is an `opt` itself: `"\{s.label}: \{s.change}"` is an `opt<text>`, and `opt.NONE` when `s.change` is. A literal with no `opt` hole is a plain value, so `.or(…)` in the hole gives one: `"\{s.label}: \{s.change.or("no change")}"`.
- **An `opt` may hold an `opt`**, as reaching into a list of optional readings does. Two rules keep one reading: a plain value is wrapped as many times as needed, and `opt.NONE` on its own is always the outermost level. An item that is there and empty is written `opt.SOME(opt.NONE)`.

```java
let readings: list<opt<number>> = [opt.SOME(3), opt.NONE];
let b: opt<opt<number>> = readings[1];       // opt.SOME(opt.NONE): the item is there, and empty
let c: opt<opt<number>> = readings[5];       // opt.NONE: there is no item 5
let d: opt<opt<number>> = 3;                 // opt.SOME(opt.SOME(3))
```

### Numbers

There is one number type, `number`. It is exact base-10: IEEE 754 decimal128, with 34 significant digits. So `0.1 + 0.2` is `0.3`, and money and percentages are always exact.

- **`+ - * /`** give the exact result when it fits in 34 digits, and otherwise round it to 34 digits, halves to even. `1 / 3` is `0.3333…` to 34 digits, so `(1 / 3) * 3` is `0.9999…`, not `1`.
- **`%`** is the remainder and has the sign of the left side. **`-x`** negates.
- **Maths** is a set of fns on `number`: `x.sqrt()`, `x.pow(2)`, `x.exp()`, `x.ln()`, `a.sin()` and the other trig and hyperbolic fns, with angles in radians, and `y.atan2(x)`. `pi` and `euler` are core constants. Results are rounded to 34 digits like every other number.
- **Maths with no answer** gives an `opt`: `sqrt`, `ln`, `asin`, `acos` and `pow` return one, which is `opt.NONE` for `sqrt` below 0, `ln` at 0 or below, `asin` and `acos` outside `-1..1`, and `pow` of 0 to a negative power or of a negative number to a power that isn't whole. So `area.sqrt().or(0)`.
- **Whole numbers are a contract**: core's `int`, which is `number step 1`. `count: int 0...` is a whole number, 0 or more. Lengths, positions and the results of `round()`, `floor()` and `ceil()` are `int`s.
- **Failures**: a division by zero, and a result too large for decimal128 (beyond 10^6144, as for `1000.exp()`), are failures (page 6), or compile errors when the compiler can see them.
- **`duration`** counts milliseconds and is written `250ms` or `2s`. It is a separate type, because a duration is not a plain number: `d.ms()` gives one.

```java
let half: number = 7 / 2;                // 3.5
let rest: number = 7 % 2;                // 1
let whole: int = (7 / 2).floor();        // 3
let sum: number = 0.1 + 0.2;             // 0.3
let third: number = 1 / 3;               // 0.3333… to 34 digits
let root: opt<number> = (-4).sqrt();     // opt.NONE: no real root
```

### Contracts

A contract narrows a type. There are four kinds.

```java
start: number 0... = 5;                  // a range: 0 or more
below: number ...10;                     // 10 or less
level: number 0..10;                     // both bounds are always included
offset: number -20..40;                  // the minus is the bound's own sign
grade: number 0..limit;                  // a bound can be a named constant
last: number 0..(limit - 1);             // anything longer goes in brackets
count: int 0...;                         // a whole number, 0 or more: number 0... step 1
ratio: number 0.4..10;
volume: number 0..1 step 0.05;
delay: duration 100ms..10s;
name: text[1...];                        // a length: square brackets, for text and lists
code: text[3];                           // exactly 3 characters
items: list<stat>[1...];
pair: list<number>[2];                   // exactly 2 items
scores: list<number 0..100>[1..50];      // a range on each item, a length on the list
note: opt<text[1...]> = opt.NONE;
tone: color only (color.INFO, color.OK, color.WARN, color.BAD) = color.INFO;
side: text only ("left", "right") = "left";
```

- **A range** `low..high` is for numbers, durations, dates and a pack's own ordered types. Either side can be left open with a third dot. Text has no ranges: it has a length and `only`.
- **A minus before a range's number** is that bound's sign: `-20..40` is `(-20)..40`. A whole range can't be negated: `-(1..10)` is a compile error that points to core's `range.negate` (page 5).
- **`step`** adds that the value is a whole number of steps from the low bound, or from 0 when there is none. `step 1` makes a whole number, which core calls `int`.
- **A length** `[low..high]`, `[low...]` or `[n]` counts the characters of a text or the items of a list. `[3]` is exactly 3, short for `[3..3]`. Nothing is ever padded to fit.
- **`only (…)`** lists the allowed values, for types that implement `same`, and the values are constants. Tokens compare as cases, so the `tone` above takes those four cases and no other, whatever values a theme gives them.
- **A bound** is a number with an optional sign, a duration, a named constant, or a constant expression in brackets. Bounds are always constants. A type can't depend on a value that is only known when the page runs.
- **Constants** are literals, enum cases (tokens among them), top-level `let` values whose expression is itself a constant, and arithmetic over those. A `let` that reads a variable, `$state` or an extern value is not a constant.

#### When a value is accepted

A value with a narrower contract is always accepted where a wider one, or none, is wanted. Going the other way needs a proof, and this is the complete list.

| Proof | Example | What the compiler then knows |
|---|---|---|
| The value is a constant | `level = 7` | Checked on the spot. Out of range is a compile error on that line |
| `if (x in low..high)` | `if (n in 0..100) { … }` | Inside the block, `x` has that range. `x` is a `let`, a parameter or a loop variable |
| `if (x.len() in low..high)` | `if (name.len() in 1...) { … }` | Inside the block, `x` has that length |
| `clamp` with constant bounds | `(n + 1).clamp(0, 10)` | The result is in `0..10`, and whole when the value and the bounds are |
| `clamp` with ranged bounds | `value.clamp(0, max)`, with `max: number 0...` | The result runs from the low bound's lowest value to the high bound's highest: here `0...` |
| `round`, `floor`, `ceil` | `share.round()` | The result is an `int` |
| Whole-number arithmetic | `a + b` on two `int`s | `+`, `-`, `*` and `%` on whole numbers give a whole number |
| A list literal | `[a, b, c]` | It has exactly as many items as are written: here 3 |
| A position | `for (k, x in xs)` | `k` is an `int 0...` |
| A range loop | `for (i in 0..100 step 5)` | With a constant start, end and step (1 when none is written), `i` is in that range, and whole when the start and the step are. With other bounds, `i` is a plain `number` |
| `len()` | `items.len()` | An `int` with the list's or text's length contract as its range |
| The two sides of `? :` | `wide ? n.clamp(1, 4) : n.clamp(1, 2)` | The result covers both sides: `1..4` |

Everything else gives the plain type. In particular, arithmetic on anything but constants loses its range: `a + b` on two `number 0..10` is a `number` (an `int`, if both were whole). A value with no proof where a contract is wanted is a compile error that asks for one. It never becomes an `opt`: only `try` turns a value that doesn't fit into `opt.NONE` (Bigger rules, below).

```java
fn rank(score: number 0..100): text {
    return score > 50 ? "pass" : "fail";
}

fn grade(n: number): text {
    if (n in 0..100) {
        return rank(n);                  // n is a number 0..100 here
    }
    return "out of range";
}

fn bump(n: number 0..10): number 0..10 {
    return (n + 1).clamp(0, 10);
}
```

- **Assigning to a mut value** needs the same proof every time: `level = (level + 1).clamp(0, 10);`.
- **Sharing checks every write.** A variable can be given to a `mut` parameter or input when its contract is inside the input's: a `number 4..10` into a `number 1..20`, or `0..1 step 0.05` into `0..1`. Reading is then always safe. Writing is checked when the page runs: every value written back through the input is checked against the variable's own contract, and one that doesn't fit is a failure, so the event that wrote it is undone. A variable with a wider contract than the input's is a compile error until it is narrowed, because the widget could read a value it doesn't expect. The same holds item by item for lists.
- **Length and change.** `add`, `insert`, `remove`, `remove_at` and `remove_where` are for lists with no length contract.

#### Reaching into a list

An item may or may not be there, so reaching for one always gives an `opt`. `xs[i]` and `xs.at(i)` are two ways to write the same thing, and neither needs a proof.

```java
fn pair(xs: list<text>): text {
    if (let a: text = xs[0]) {
        if (let b: text = xs[1]) {
            return "\{a} and \{b}";
        }
    }
    return "fewer than two";
}

fn third(xs: list<text>): text {
    return xs.at(2).or("there is no third");
}
```

- **Outside the list**, and at a position that isn't a whole number, the answer is `opt.NONE`.
- **Walking a list** gives each item directly, so a loop never needs to reach by position: `for (k, x in xs)` hands out the position `k` and the item `x`.
- **`xs[i] = value;`** replaces the item at `i` in a `mut` list. A position outside the list is a failure.

#### Bigger rules

Anything a contract can't say is a `require` block, in a record, a widget or a document's `$state`. It names what's wrong, returns a `bool`, and every one has to return `true`.

```java
record span {
    start: number;
    end: number;

    require "a span has to end after it starts" {
        return end > start;
    }
}

// from constants: the compiler runs the require block, and a false is a compile error
let week: span = span { start = 0, end = 7 };

// from values that can't be wrong: the rule runs when the page runs, and a false is a failure
fn week_from(day: number): span {
    return span { start = day, end = day + 7 };
}

// from values that may be wrong, such as a reader's: try, and the answer is an opt
fn entered(a: number, b: number): opt<span> {
    return try span { start = a, end = b };
}
```

- **Made anywhere.** A record that has `require` blocks can be made anywhere. Its rules run when it is made: at compile time for constants, where a `false` is a compile error, and when the page runs for anything else, where a `false` is a failure. Write `try` in front to get an `opt` instead, for values that may be wrong.
- **`try`** in front of a record literal, a `with`, or a case that carries values, such as `try stroke.PX(value)`, gives an `opt`: the value when every contract and every `require` holds, and `opt.NONE` when one does not. So a value under `try` needs no proof. Without `try`, each field's contract still needs its proof.
- **Contracts first.** A limit on one field is best written as that field's contract, which is proved at compile time, as `date`'s `month: int 1..12` is (page 5). A `require` is for rules across fields, such as a span's end coming after its start, or a day fitting its month.
- **Every change is checked.** Whenever a value changes, every contract and `require` block that reads it is checked, wherever it lives: in a record, a widget or `$state`. A rule that fails is handled where the change happened: in an event handler it is a failure, and the event is undone; under `try` the answer is `opt.NONE`; a write from the app is refused and reported. Values that have to move together change in one step, so the rules see only the result: `$state = $state with { low = a, high = b };`.
- **Mut fields.** So a record with `require` blocks may have `mut` fields: every change to one checks its rules again.
- **In a widget**, a `require` reads inputs only. With constant inputs it is checked by the compiler. Otherwise it is checked when the widget is made and when an input changes, and a `false` is a failure of that widget.

### What a fn may change

Drawing a page never changes anything. Without that rule, a fn called from a view could count how often it runs:

```java
$state {
    draws: number = 0;
}

// a compile error: a fn that returns a value can't assign a variable
fn counted(): text {
    $state.draws = $state.draws + 1;
    return "\{$state.draws}";
}
```

The number shown would depend on how often the implementer happened to redraw: once on a desktop, several times on a phone that resized, and once more every time someone exported Markdown. With the rule, every change starts in an action: an event handler, or a call or a write from the app. What the page shows doesn't depend on how often it is drawn, an implementer can redraw only what changed, exporting Markdown or previewing can't change anything, and "why did this change?" always has one answer: the action that ran.

The return type tells the two kinds apart without a new keyword. A fn with a return type answers a question. A fn with none is an action.

| | Has a return type | Has none |
|---|---|---|
| Assign its own locals | yes | yes |
| Call an action on its own `mut` local (`out.add(x)`) | yes | yes |
| Take a `mut` parameter | no | yes |
| Assign a `$state` field, a widget's own variable, a `mut` input, or a `mut for` or `if (mut …)` variable | no | yes |
| `invoke` an event, call an `extern` fn that has no return type | no | yes |
| Be called from a view, a `markdown` block, a `require`, a contract or a starting value | yes | no |

A lambda follows the same table. An `extern` fn that has a return type is called like any fn that has one. Writing `: void` is allowed and means the same as no return type. A `return x;` in a fn with no return type is a compile error that says to add one.

### if, else and match

```java
fn describe(s: stage, tries: number): text {
    match (s) {
        case stage.IDLE, stage.DONE {
            return "at rest";
        }
        case stage.FAILED(why) {
            return "failed: \{why}";
        }
        case else {
            if (tries == 0) {
                return "first run";
            } else if (tries < 3) {
                return "retrying";
            } else {
                return "still retrying";
            }
        }
    }
}
```

- **`match`** takes an enum, a `bool`, a `number` or a `text`. For an enum or a bool every case is listed, or `case else` takes the rest. For a `number` or a `text`, `case else` is required, and so it is for a token: a pack may add cases to a token type, so the list is never known to be complete.
- **A case** is one enum case, with a new name for each of its values in order, or a literal. Several can share one body, separated by commas, when none of them binds a name.
- **`if`** takes a `bool` in brackets, `let name: type = value` to open an `opt`, or `mut name: type = value` to open one that can be written. `else` and `else if` follow the closing brace on the same line.
- **Statements, not values.** `if` and `match` don't produce a value. `cond ? a : b` does.
- **Order**: Expressions are worked out left to right, and arguments in the order written. `a && b` works out `b` only when `a` is true, `a || b` only when `a` is false, and `c ? a : b` only the side it returns. So `n != 0 && 10 / n > 2` is false for `n = 0`, not a failure.

### Text

A text is a sequence of Unicode characters (scalar values), kept in the composed form NFC. `len`, `slice` and `chars` count those characters. Text is ordered by character number, not by language, which is enough for sorting and is why text has no ranges. `lower` and `upper` use Unicode's default mapping. A text literal with holes is a `text`, or an `opt<text>` when one of its holes is an `opt` (Optional values, above).

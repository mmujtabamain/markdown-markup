# Values and types

Page 2 of 9. Records, enums, constant and mut, passing values, optional values, numbers, contracts and the proofs they need, and what a fn may change.

Eight types are built in, because the syntax makes them: `number`, `bool`, `text`, `duration`, `list<T>`, `opt<T>`, `range<T>` and `view`. Everything else, from `point`, `date`, `moment`, `latex` and `md` to the tokens, the options and `page`, is declared in `core`, the standard library, which is written in MKP and imported by every file. Page 5 has all of it.

A type is written in one of five forms.

| Form | Example | Meaning |
|---|---|---|
| A name | `stat`, `list<stat>`, `T` | A built-in or declared type, with its type arguments, or a type parameter (always capitals) |
| Any fitting type | `any chart` | Any type that fits the interface `chart` |
| A fn | `fn(item: T): bool`, `fn(item: T)` | A fn. With no return type it returns nothing. The parameter names are for the reader and are not part of the type |
| An inline record | `{ name: text, up: bool }` | A record with no declared name |
| With a contract | `number 0..10`, `text[1...]` | Any of the above, narrowed. See Contracts below |

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
    size: number 1... step 1 = 16;   // optional, falls back to 16
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

// a fn added to a type
fn stat.line(self): text {
    return "- **\{self.label}**: \{self.value}";
}

// returns nothing, so it may change its mut parameter
fn mark(mut s: stat) {
    s.seen = true;
}
```

- **Making a record**: `stat { label = "Deploys", value = "42" }`. A field with `= value` can be left out, and one without must be given. Use a default when there's a sensible value, and `opt<T>` when "not given" itself means something.
- **Changing one field of a constant record**: `s with { seen = true }` is a copy of `s` with that field replaced.
- **Enum cases**: `stage.FAILED("timeout")` gives the case its values in order. They are read back with `match`.
- **`type`** gives a type another name. `percent` and `number 0..100` are the same type everywhere.
- **Recursion**: A record may hold its own type only inside a `list` or an `opt`. A fn may call itself, and a widget may place itself. All three are bounded by the depth limit on page 6.

### Constant and mut

| Where | Constant (default) | Mutable |
|---|---|---|
| Local in a fn | `let x: number = 0;` | `mut x: number = 0;` |
| Top of a file | `let limit: number = 10;` (a constant) | `mut tries: number = 0;` (a global variable) |
| In a widget | `let n: number = a + 1;` | `mut open: number = 0;` (the widget's own variable) |
| Widget input | `t: tally`, or `param t: tally;` in the body | `mut t: tally`, or `param mut t: tally;` |
| fn parameter | `fn f(t: tally)` | `fn f(mut t: tally)` |
| Lambda parameter | `fn(t: tally) { … }` | `fn(mut t: tally) { … }` |
| Record field | `size: number = 1;` | `mut n: number = 0;` |
| Inline record | `{ name = "api" }` | `{ mut up = true }` |
| Loop variable | `for (t in todos)` | `mut for (t in todos)` |
| extern value | Constant to MKP code | None |

- **Every `let` and `mut` writes its type**, `if (let c: text = …)` included. Names bound by `for` and `case` take the type of what they walk or open, because they are not declarations.
- **A literal takes the type that is expected**: `stat { … }`, `[1, 2]` and `opt.NONE` are checked against the declared type. With nothing to aim for, as in `"\{42}"`, `42` is a `number`.
- **A lambda's types may come from where it is used.** Passed to an input, a parameter or an event, or given to a `let` that writes its type, a lambda may leave out its parameter types and its return type: `fn(p) { return p.nick; }`. Anywhere else it writes them all. Writing them is always allowed.

### Passing values

Everything is passed by reference. A plain parameter or input is read-only, so whether the fn sees the caller's value or a copy can't be told apart, and nothing is copied to make a call. `mut` on a parameter, an input, `self` or a loop variable lets it write through to the caller's value, and the caller has to pass something mutable.

Assigning makes a value of its own. `let b: stat = a;`, `mut out: list<number> = xs;` and `return a;` give the new name its own value, so changing one never changes the other. The implementer copies only when one of them is changed.

```java
fn sorted_copy(xs: list<number>): list<number> {
    mut out: list<number> = xs;      // out is its own value: xs is untouched
    out.sort();
    return out;
}
```

- **One value, one mut**: The same variable, or a variable and a part of it, can't be passed to a `mut` parameter and to another parameter of the same call.
- **A list being walked**: `mut for (t in xs)` reads `xs` again before every iteration and takes the next position, and it ends when the position is past the end. The body can change `t`, and it can add to `xs` and remove from it. Removing the current item moves the next one into its place, so that one is skipped: to remove while walking, use `xs.remove_where(test)`. The compiler warns when a walk removes from its own list. A body that keeps adding to its own list is stopped by the item limit (page 6).
- **After a removal**: Once a body or an event handler removes `t` from its list, `t` can't be used in the rest of that block. It is a compile error when the compiler can see it, and a failure when it can't.
- **Lambdas**: A lambda reads the values around it as they were when it was made. A lambda with no return type may assign global variables, the widget's own variables, a `mut` input, and a `mut for` variable. It can't assign a `mut` local of the fn it is written in.
- **Derived values**: A `let` at the top of a document or in a widget or a view is worked out again whenever something it reads changes. A `let` inside a fn is an ordinary local.
- **Memory** is the implementer's. MKP code has no pointers, no freeing and no null, and indexes are proved, so it can't cause a memory error. Values can't form cycles, because assigning makes a value of its own and a reference can't be stored, so no tracing garbage collector is needed.

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

Using an `opt<color>` where a `color` is wanted is an ordinary type error. A plain value is accepted where an `opt` is wanted: `tone = color.OK`. An `opt` of an `opt` is not a type, so that rule has one reading.

### Numbers

There is one number type, `number`. It is exact base-10: IEEE 754 decimal128, with 34 significant digits. So `0.1 + 0.2` is `0.3`, and money and percentages are always exact.

- **`+ - * /`** give the exact result when it fits in 34 digits, and otherwise round it to 34 digits, halves to even. `1 / 3` is `0.3333…` to 34 digits, so `(1 / 3) * 3` is `0.9999…`, not `1`.
- **`%`** is the remainder and has the sign of the left side. **`-x`** negates.
- **Maths** is a set of fns on `number`: `x.sqrt()`, `x.pow(2)`, `x.exp()`, `x.ln()`, `a.sin()` and the other trig and hyperbolic fns, with angles in radians, and `y.atan2(x)`. `pi` and `e` are core constants. Results are rounded to 34 digits like every other number, and `sqrt` of a negative number or `ln` of zero is a failure.
- **Whole numbers are a contract**: `count: number 0... step 1`. Lengths, positions and the results of `round()`, `floor()` and `ceil()` are whole numbers this way.
- **Failures**: a division by zero, and a result too large for decimal128 (beyond 10^6144), are failures (page 6), or compile errors when the compiler can see them.
- **`duration`** counts milliseconds and is written `250ms` or `2s`. It is a separate type, because a duration is not a plain number: `d.ms()` gives one.

```java
let half: number = 7 / 2;                // 3.5
let rest: number = 7 % 2;                // 1
let whole: number = (7 / 2).floor();     // 3
let sum: number = 0.1 + 0.2;             // 0.3
let third: number = 1 / 3;               // 0.3333… to 34 digits
```

### Contracts

A contract narrows a type. There are four kinds.

```java
start: number 0... = 5;                  // a range: 0 or more
below: number ...10;                     // 10 or less
level: number 0..10;                     // both bounds are always included
offset: number -20..40;
grade: number 0..limit;                  // a bound can be a named constant
last: number 0..(limit - 1);             // anything longer goes in brackets
count: number 0... step 1;               // a whole number, 0 or more
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
- **`step`** adds that the value is a whole number of steps from the low bound, or from 0 when there is none. `step 1` makes a whole number.
- **A length** `[low..high]`, `[low...]` or `[n]` counts the characters of a text or the items of a list. `[3]` is exactly 3, short for `[3..3]`. Nothing is ever padded to fit.
- **`only (…)`** lists the allowed values, for types that implement `same`.
- **A bound** is a number with an optional sign, a duration, a named constant, or a constant expression in brackets. Bounds are always constants. A type can't depend on a value that is only known when the page runs.
- **Constants** are literals, top-level `let` values, tokens, enum cases, and arithmetic over those.

#### When a value is accepted

A value with a narrower contract is always accepted where a wider one, or none, is wanted. Going the other way needs a proof, and this is the complete list.

| Proof | Example | What the compiler then knows |
|---|---|---|
| The value is a constant | `level = 7` | Checked on the spot. Out of range is a compile error on that line |
| `if (x in low..high)` | `if (n in 0..100) { … }` | Inside the block, `x` has that range. `x` is a `let`, a parameter or a loop variable |
| `if (x.len() in low..high)` | `if (name.len() in 1...) { … }` | Inside the block, `x` has that length |
| `clamp` with constant bounds | `(n + 1).clamp(0, 10)` | The result is in `0..10`, and whole when the value and the bounds are |
| `round`, `floor`, `ceil` | `share.round()` | The result is a whole number |
| Whole-number arithmetic | `a + b` on two whole numbers | `+`, `-`, `*` and `%` on whole numbers give a whole number |
| A range loop | `for (i in 0..9)` | `i` is a whole number in `0..9` |
| `len()` | `items.len()` | A whole number with the list's or text's length contract as its range |
| The two sides of `? :` | `wide ? n.clamp(1, 4) : n.clamp(1, 2)` | The result covers both sides: `1..4` |

Everything else gives the plain type. In particular, arithmetic on anything but constants loses its range: `a + b` on two `number 0..10` is a `number` (a whole one, if both were whole).

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

Anything a contract can't say is a `require` block, in a record or a widget. It names what's wrong, returns a `bool`, and every one has to return `true`.

```java
record span {
    start: number;
    end: number;

    require "a span has to end after it starts" {
        return end > start;
    }
}

// from constants: the compiler runs the require block
let week: span = span { start = 0, end = 7 };

// from values that are only known later: try, and the answer is an opt
fn between(a: number, b: number): opt<span> {
    return try span { start = a, end = b };
}
```

- **`try`** in front of a record literal or a `with` gives an `opt`: the record when every `require` holds, and `opt.NONE` when one does not. Without `try`, a record that has `require` blocks can only be made from constants.
- **No mut fields.** A record with a `require` block has no `mut` fields, so it can't be changed into a state its rules forbid. Change it with `try s with { … }`.
- **In a widget**, a `require` reads inputs only. With constant inputs it is checked by the compiler. Otherwise it is checked when the widget is made and when an input changes, and a `false` is a failure of that widget.

### What a fn may change

Drawing a page never changes anything. Without that rule, a fn called from a view could count how often it runs:

```java
mut draws: number = 0;

// a compile error: a fn that returns a value can't assign a variable
fn counted(): text {
    draws = draws + 1;
    return "\{draws}";
}
```

The number shown would depend on how often the implementer happened to redraw: once on a desktop, several times on a phone that resized, and once more every time someone exported Markdown. With the rule, every change starts in an event handler. What the page shows doesn't depend on how often it is drawn, an implementer can redraw only what changed, exporting Markdown or previewing can't change anything, and "why did this change?" always has one answer: the handler that ran.

The return type tells the two kinds apart without a new keyword. A fn with a return type answers a question. A fn with none is an action.

| | Has a return type | Has none |
|---|---|---|
| Assign its own locals | yes | yes |
| Call an action on its own `mut` local (`out.add(x)`) | yes | yes |
| Take a `mut` parameter | no | yes |
| Assign a global variable, a widget's own variable, a `mut` input or a `mut for` variable | no | yes |
| `invoke` an event, call an `extern` fn | no | yes |
| Be called from a view, a `markdown` block, a `require`, a contract or a starting value | yes | no |

A lambda follows the same table. Writing `: void` is allowed and means the same as no return type. A `return x;` in a fn with no return type is a compile error that says to add one.

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

- **`match`** takes an enum, a `bool`, a `number` or a `text`. For an enum or a bool every case is listed, or `case else` takes the rest. For a `number` or a `text`, `case else` is required.
- **A case** is one enum case, with a new name for each of its values in order, or a literal. Several can share one body, separated by commas, when none of them binds a name.
- **`if`** takes a `bool` in brackets, or `let name: type = value` to open an `opt`. `else` and `else if` follow the closing brace on the same line.
- **Statements, not values.** `if` and `match` don't produce a value. `cond ? a : b` does.

### Text

A text is a sequence of Unicode characters (scalar values), kept in the composed form NFC. `len`, `slice` and `chars` count those characters. Text is ordered by character number, not by language, which is enough for sorting and is why text has no ranges. `lower` and `upper` use Unicode's default mapping.

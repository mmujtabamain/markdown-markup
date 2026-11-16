# Grammar and the reference parser

Page 9 of 9. The grammar the other pages follow, and the reference parser that reads every example in this doc.

### Reading it

`a b` is a then b. `a | b` is either. `[ a ]` is optional. `{ a }` is any number of times. Words in quotes are written as they stand. Every rule needs one token of lookahead, and two in three places, which are marked. A statement is read as an expression first, and as an assignment when `=` follows.

### Tokens

```txt
name      = small { small | digit | "_" }                 every name: types, values, fns, widgets
CAPS      = capital { capital | digit | "_" }             cases after a dot, an enum's or a token's; type parameters alone
number    = digits [ "." digits ]                         a number never starts or ends with a dot
digits    = digit { digit | "_" }
duration  = number ( "ms" | "s" )
text      = '"' piece { hole piece } '"'                  on one line; with holes, a template literal
piece     = { character | escape }
escape    = '\"' | "\\" | "\n" | "\t" | "\u{" hex "}"
hole      = "\{" expr "}"
comment   = "//" to the end of the line
doc       = "//@about" words | "//@param" name words | "//@deprecated" words   above a declaration
```

A keyword is never a `name`. `$state` is a keyword, written as one word, and the only token that starts with `$`: `$` on its own, or in front of any other name (`$abc`), is a compile error, so no name can collide with `$state`. Maths in code is a `latex` value, written as a text literal where one is expected. MKP has no attributes: `#` is not a token in code, and in prose a `#` at the start of a line is always a Markdown heading. `1...` is the tokens `1` and `...`, and `0..10` is `0`, `..` and `10`, because a number needs a digit on both sides of its dot.

A text with holes is a template literal: its pieces, the text between the holes, and its holes are kept apart, so a hole is always a value and never text that is read again. Where a type that fits `literal<template>` is wanted, the literal reaches that type's `from` as a `template` (page 4). A hole that holds an `opt` makes the literal an `opt`.

### Files and declarations

```txt
file      = "package" name [ "@" number ] ";" { import } { decl }   a pack's file; with a version, a surface
document  = [ frontmatter ] [ definitions divider ] prose
definitions = { import } { decl | state | expose }       no package and no pack; at most one state
divider   = a line that holds only "@@@"
frontmatter = a line "---", YAML lines, a line "---", at the very top
import    = "import" name [ "." name ] [ "as" name ] ";"

decl      = enum | record | token | alias | interface | fn | widget | extern | pack | tokens | let
          | migration | migfn                                      only in a pack's file
enum      = "enum" name [ generics ] "{" case { "," case } [ "," ] "}"
case      = CAPS [ "(" name ":" type { "," name ":" type } ")" ]
record    = "record" name [ generics ] [ implements ] "{" { field ";" | require } "}"
token     = "token" name ":" type [ implements ] "{" case { "," case } [ "," ] "}"   values only in a tokens block
field     = [ "mut" ] name ":" type [ "=" expr ]
alias     = "type" name "=" type ";"
interface = [ "widget" ] "interface" name [ generics ] "{" { name ":" type ";" | fnsig ";" | event } "}"
generics  = "<" tparam { "," tparam } ">"
tparam    = CAPS [ ":" iface { "+" iface } ]
implements= "implements" iface { "," iface }
iface     = name [ "<" type { "," type } ">" ]                an interface, with its type arguments

fn        = fnsig block
fnsig     = "fn" [ name [ generics ] "." ] name [ generics ] "(" [ params ] ")" [ ":" rtype ]
params    = param { "," param } [ "," ]
param     = [ "mut" ] "self" [ ":" type ] | [ "mut" ] name ":" type
rtype     = type | "void"                                 no return type means void

widget    = "widget" name [ generics ] "(" [ inputs ] ")" [ implements ] "{" wbody "}"
inputs    = field { "," field } [ "," ]
wbody     = { "param" field ";" } { slot } { event } { require } { own | let }
            { fn } "view" vblock [ "markdown" prose-block ]      markdown required in a .mkp file
slot      = "slot" name ":" type ";"
event     = "event" name "(" [ params ] ")" ";"
require   = "require" text block
own       = "mut" name ":" type "=" expr ";"                     a widget's own variable
let       = "let" name ":" type "=" expr ";"
state     = "$state" "{" { name ":" type "=" expr ";" | require } "}"   what a document's widgets share
expose    = "expose" name "{" { fn } "}"                         answers the extern block of that name

extern    = "extern" name "{" { field ";" | fnsig ";" } "}"
          | "extern" "type" name [ generics ] [ implements ] ";"
          | "extern" fnsig ( ";" | block )                       a block is the default body
          | "extern" "widget" name [ generics ] "(" [ inputs ] ")" [ implements ]
            ( ";" | "{" { slot } { event } [ "markdown" prose-block ] "}" )
pack      = "pack" name "@" number "{" { packline ";" } "}"
packline  = "uses" pref { "," pref } | "provides" name { "," name }
          | "implements" name "." name "@" number { "," name "." name "@" number }
pref      = name "@" number                                 a pack at a version
migration = "migration" pref "to" pref "{" { fn | mblock } "}"   in a pack's file
mblock    = mkind name [ "." name ] "{" { mstmt } "}"              a kit@1 declaration's uses
mkind     = "widget" | "record" | "enum" | "token" | "fn" | "type" | "let" | "interface"
mstmt     = "execute" block | "event" name "{" { mstmt } "}" | stmt
migfn     = "migration" fnsig "{" { mstmt } "}"                   a migration fn
tokens    = "tokens" name "{" { name "." CAPS "=" expr ";" } "}"
```

There are no variables at the top of a file or a document. A document's shared values are the fields of its `$state` block, written once, above the `@@@` line, each with a starting value, and read and written as `$state.name` anywhere in the document. A `mut` at the top of a document is a compile error that points to `$state`. A pack keeps no state, so a pack's files have no `$state` block, never read `$state`, and have no `expose`. A widget's own variables live in its body, one set for each use of the widget.

`expose` declares no name of its own: it answers the `extern` block of its name, or starts that channel when there is none, and only the app calls its fns.

A token is an enum whose cases stand for values of the type after its colon. A case that carries values is written as an enum's is, such as `PX(px: number 0.25..16)`, and one that carries a single value of the token's type needs no line in a `tokens` block. A line in a `tokens` block gives a named case its value, and a line for a name the token doesn't declare adds a case, which is why a `match` on a token needs `case else`.

A file whose `package` line carries a version is a surface (page 6). It holds only enum, record, token, `tokens`, alias, interface, `extern` and `let` declarations, with no `require` blocks: its widgets and fns are `extern` signatures. A migration's statements are calls with named arguments, such as `rename(input = color, to = tone);`: core declares them, and where a parameter takes a name, a bare name is that name. `migration`, `to` and `execute` are words only where a migration is written.

`provides` may list `let` constants as well as declarations. A fn a pack adds to a type comes with any import of the pack, and `as` can rename one: `import b.slug as b_slug;` brings `b`'s `text.slug` in as `text.b_slug`.

### Types

```txt
type      = base [ contract ]
base      = name [ "<" type { "," type } ">" ] [ "[" ( range | bound ) "]" ]
          | CAPS [ "[" ( range | bound ) "]" ]                     a type parameter
          | "any" name | "view" | "self"
          | "fn" "(" [ params ] ")" [ ":" rtype ]
          | "{" field { "," field } "}"
contract  = range | "step" bound | "only" "(" expr { "," expr } ")"
range     = ( bound ".." bound | bound "..." | "..." bound ) [ "step" bound ]
bound     = [ "-" ] ( number | duration ) | name | "(" expr ")"
```

After a `base`, a number, a minus, a bracket, three dots, `step` or `only` starts a contract. A name starts one only when two or three dots follow it (two tokens of lookahead). A range after `text` is a compile error, because text has a length and `only` instead. Nothing else can follow a type, so there is one reading. A minus in a bound is a number's sign, so a negative name is written in brackets, `(-x)`. Types nest, `opt` included: `opt<opt<number>>` is a type, and its `>>` is two tokens.

### Statements

```txt
block     = "{" { stmt } "}"
stmt      = let
          | "mut" name ":" type "=" expr ";"
          | "return" [ expr ] ";"
          | "invoke" name "(" [ args ] ")" ";"
          | if | walk | match
          | expr [ "=" expr ] ";"                      the left side of "=" is a place
place     = ( name | "self" | "$state" ) { "." name | "[" expr "]" }
if        = "if" "(" cond ")" body { "else" "if" "(" cond ")" body } [ "else" body ]
cond      = expr | ( "let" | "mut" ) name ":" type "=" expr
walk      = [ "mut" ] "for" "(" name [ "," name ] "in" expr ")" body
match     = "match" "(" expr ")" "{" { "case" patterns body } "}"
patterns  = "else" | pattern { "," pattern }
pattern   = name "." CAPS [ "(" name { "," name } ")" ] | [ "-" ] number | text | "true" | "false"
```

`body` is a `block` inside a fn and a `vblock` inside a view. `mut` starts a loop when `for` follows it, and a local otherwise (two tokens of lookahead). A statement is read as an expression, and when `=` follows, that expression is the place assigned: a name, `self` or `$state`, with fields and items after it. Every loop is a walk over a list or a range, so every loop ends.

`if (let x: T = o)` opens an `opt` to read it. `if (mut x: T = o)` opens one that can be written, a `mut` variable, a field of one or a `mut for` variable, and writing to `x` writes the value inside. `mut for (t in xs)` walks a copy of `xs` made when the loop starts, and `t` is an `opt` for the real item: `opt.NONE` once that item has been removed. Plain `for` makes no copy and can't change its list.

### Views

```txt
vblock    = "{" { vstmt } "}"
vstmt     = let | if | walk | match | vexpr ( ";" | callblock )
vexpr     = "@" name [ "(" [ args ] ")" ]
callblock = vblock                                             children, for a widget with one slot
          | "{" { name "=" expr ";" | name vblock } "}"        inputs and named slots
args      = expr { "," expr } [ "," ]                          a fn: in order
          | name "=" expr { "," name "=" expr } [ "," ]        a widget: named
```

A call's block is the named form when its first token is a name, and children otherwise. An argument is named when a name is followed by `=` (two tokens of lookahead).

### Expressions

Loosest first. `==`, `!=`, the four comparisons and `in` don't chain: `a < b < c` is a compile error.

```txt
expr      = or [ "?" expr ":" expr ]
or        = and { "||" and }
and       = equal { "&&" equal }
equal     = compare [ ( "==" | "!=" ) compare ]
compare   = sum [ ( "<" | "<=" | ">" | ">=" | "in" ) sum ]
sum       = term { ( "+" | "-" ) term }
term      = unary { ( "*" | "/" | "%" ) unary }
unary     = ( "!" | "-" ) unary | postfix
postfix   = primary { "." name [ "(" [ args ] ")" ] | "." CAPS [ "(" [ args ] ")" ]
                    | "[" expr "]" | "(" [ args ] ")" | "with" "{" inits "}" }
primary   = atom [ ( ".." bound | "..." ) [ "step" bound ] ]   a range when dots follow
          | "..." bound [ "step" bound ]
          | text | "true" | "false" | "self" | "$state"
          | "[" [ expr { "," expr } [ "," ] ] "]"
          | name "{" inits "}" | "{" inits "}"                  a record, named or inline
          | "try" postfix                                       in front of a record, a with or a case with values
          | lambda
          | vexpr [ callblock ]
atom      = number | duration | name | "(" expr ")"
lambda    = "fn" "(" [ lparam { "," lparam } ] ")" [ ":" rtype ] block
lparam    = [ "mut" ] name [ ":" type ]                         types from where it is used
inits     = [ [ "mut" ] name "=" expr { "," [ "mut" ] name "=" expr } [ "," ] ]
```

In an expression a range's bounds are a number, a name or a bracketed expression, so `0..(n - 1)` is written with brackets and `0..n - 1` is a type error and not a surprise. A minus in front of the number that starts a range is that bound's sign, so `-840..840` is `(-840)..840`. A whole range can't be negated: `-(1..10)` and `-x..5` are compile errors that point to `range.negate`. A name directly in front of `{` is always a record, because every condition is in brackets and no statement puts a bare value in front of a block. `$state` is a value and never a type, so `$state {` starts no record: several fields change at once with `$state = $state with { … };`.

`try` in front of a record, a `with` or a case that carries values, such as `try stroke.PX(value)`, checks every contract and `require` block of the value it makes, and gives an `opt`: `opt.NONE` when one of them fails.

### Prose

Prose is read a line at a time. This grammar is for a document below its `@@@` line and for a `markdown` block.

```txt
prose       = { line }
line        = fence | maths | call | control | slot-line | comment-line | text-line
fence       = a fenced code block, of any language: skipped whole and shown as code
maths       = a line of only "$$", lines of TeX with holes, a line of only "$$"     a maths block
call        = vexpr ";"                                 no block
            | vexpr " {" end-of-line prose "}"          the block is prose, closed by a line of only "}"
control     = "@if (" cond ") {" prose { "} else if (" cond ") {" prose } [ "} else {" prose ] "}"
            | "@" [ "mut " ] "for (" name [ "," name ] "in" expr ") {" prose "}"
            | "@match (" expr ") {" { "case" patterns " {" prose "}" } "}"
slot-line   = "@slot" name " {" prose "}"               directly inside a call's block
comment-line = "@//" to the end of the line             read as if the line weren't there
text-line   = any other line: Markdown, with holes outside code spans, and $maths$
prose-block = "{" end-of-line prose "}"
```

A line that starts with `@` and a small letter, after up to three spaces, is a `call`, a `control` or a `slot-line`, and anything else there is a compile error. A line that starts with `@//`, after up to three spaces, is a `comment-line`: nothing draws it, Markdown out leaves it out, and it ends no paragraph. `\@` is a literal @, so `\@//` is text. A call's arguments may run over several lines. A call, a control line, a comment line or a closing `}` never starts inside a Markdown quote or list item: `> @card(…) {` and `- @label(…);` are compile errors, and a quote or a list that holds widgets is written with `@quote`, or with `@bullets` and `@item`. An @ at the start of a quote or a list item is written `\@`.

A line that holds only `$$` opens a maths block, and the next such line closes it. The lines between are TeX, never calls or control lines, and the block lowers to `math`. Inline maths pairs an opening `$` with the next `$` on its line, skipping `\$`, and when that one can't close, the opening `$` is text. Maths never spans lines, and an inline `$` never pairs across a `$$` line.

Each place in prose has its own escapes:

```txt
in text     \{…} is a hole, \\{ shows \{, \@ shows @, \} shows }, \$ shows $; any other backslash is CommonMark's
in maths    \{…} is a hole, \\{ gives TeX \{; any other backslash reaches TeX as written, so \\, \$ and \_ are TeX's
in code     code spans, fenced code and indented code have no escapes and no holes
```

### The reference parser

`mkpcheck.py` is a parser for this grammar, written for this doc. It reads every MKP code block in the nine pages, and on top of the grammar it checks what can be checked without types.

- **Keywords and names** (pass): A keyword is never a name, after a dot included. A name is all small letters, or all capitals for a case. `$state` is a keyword, and `$` starts no other name.
- **Declared types** (pass): Every `let` and `mut` writes its type. Definitions write their parameter types; a lambda may leave them out.
- **No shadowing** (pass): No declaration reuses a value name that is visible where it is written.
- **What follows @** (pass): Every `@name` is a visible value or fn, with arguments in order, or a declared widget.
- **Widget calls** (pass): Every argument is named, is a declared input or event, and is set once. Every input without a default is given.
- **Blocks and slots** (pass): A block of children goes to a widget with exactly one slot. A named block, or a `@slot` line in prose, names a real slot. No slot has a widget's name.
- **Cases and tokens** (pass): Every `type.CAPITALS` is a declared enum case or token case, counting the cases that `tokens` blocks add. Every `tokens` line names a declared token type, and a `match` on a token has a `case else`.
- **Widget bodies** (pass): The body order, a `markdown` block on every widget in a .mkp file, no `expose` in a widget, and `//@param` lines that name real inputs.
- **State** (pass): No `mut` at the top of a document or a file. At most one `$state` block, above a document's `@@@` line, each field with a starting value. No `$state` and no `expose` in a pack's files.
- **Documents and prose** (pass): Front matter, the `@@@` divider, no drawing above it, calls, control lines, slot lines, block ends, `$$` maths blocks, holes and `\@`, and no call inside a quote or a list item.
- **Types, proofs, effects** (skipped): Not checked by a program. A type checker is the next step, and these rules were checked by hand.

- **Code blocks read**: 56 (all pass)
- **Widget calls checked**: 209 (against 66 declared widgets)
- **Cases and tokens checked**: 302
- **Broken examples caught**: 97 of 97 (one rule broken in each)

The second number matters as much as the first. A checker that passes everything proves nothing, so `tests/negative.md` holds 97 small examples that each break one rule, and the parser has to report every one.

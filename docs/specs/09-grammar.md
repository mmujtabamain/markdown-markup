# Grammar and the reference parser

Page 9 of 9. The grammar the other pages follow, and the reference parser that reads every example in this doc.

### Reading it

`a b` is a then b. `a | b` is either. `[ a ]` is optional. `{ a }` is any number of times. Words in quotes are written as they stand. Every rule needs one token of lookahead, and two in three places, which are marked.

### Tokens

```txt
name      = small { small | digit | "_" }                 every name: types, values, fns, widgets
CAPS      = capital { capital | digit | "_" }             cases and tokens after a dot; type parameters alone
number    = digits [ "." digits ]                         a number never starts or ends with a dot
digits    = digit { digit | "_" }
duration  = number ( "ms" | "s" )
text      = '"' { character | escape | hole } '"'         on one line
escape    = '\"' | "\\" | "\n" | "\t" | "\u{" hex "}"
hole      = "\{" expr "}"
comment   = "//" to the end of the line
doc       = "//@about" words | "//@param" name words | "//@deprecated" words   above a declaration
```

A keyword is never a `name`. MKP has no attributes: `#` is not a token in code, and in prose a `#` at the start of a line is always a Markdown heading. `$` is not a token in code: maths in code is a `latex` value, written as a text literal where one is expected. `1...` is the tokens `1` and `...`, and `0..10` is `0`, `..` and `10`, because a number needs a digit on both sides of its dot.

### Files and declarations

```txt
file      = "package" name ";" { import } { decl | global | expose }
document  = [ frontmatter ] [ definitions divider ] prose
definitions = { import } { decl | global | expose }       a .mkp file without package and pack
divider   = a line that holds only "@@@"
frontmatter = a line "---", YAML lines, a line "---", at the very top
import    = "import" name [ "." name ] [ "as" name ] ";"

decl      = enum | record | token | alias | interface | fn | widget | extern | pack | tokens | let
enum      = "enum" name [ generics ] "{" case { "," case } [ "," ] "}"
case      = CAPS [ "(" field { "," field } ")" ]
record    = "record" name [ generics ] [ implements ] "{" { field ";" | require } "}"
token     = "token" name "{" { field ";" | require } "}"       values only in a tokens block
field     = [ "mut" ] name ":" type [ "=" expr ]
alias     = "type" name "=" type ";"
interface = [ "widget" ] "interface" name [ generics ] "{" { name ":" type ";" | fnsig ";" | event } "}"
generics  = "<" tparam { "," tparam } ">"
tparam    = CAPS [ ":" name { "+" name } ]
implements= "implements" type { "," type }

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
global    = "mut" name ":" type "=" expr ";"                     a global variable
let       = "let" name ":" type "=" expr ";"
expose    = "expose" name "{" { fn } "}"

extern    = "extern" name "{" { field ";" | fnsig ";" } "}"
          | "extern" "type" name [ generics ] [ implements ] ";"
          | "extern" fnsig ( ";" | block )                       a block is the default
          | "extern" "widget" name [ generics ] "(" [ inputs ] ")" [ implements ]
            ( ";" | "{" { slot } { event } [ "markdown" prose-block ] "}" )
pack      = "pack" name "@" number "{" { packline ";" } "}"
packline  = "uses" pref { "," pref } | "provides" name { "," name }
          | "implements" name "." name "@" number { "," name "." name "@" number }
pref      = name "@" number                                 a pack at a version
tokens    = "tokens" name "{" { name "." CAPS "=" expr ";" } "}"
```

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

After a `base`, a number, a minus, a bracket, three dots, `step` or `only` starts a contract. A name starts one only when two or three dots follow it (two tokens of lookahead). A range after `text` is a compile error, because text has a length and `only` instead. Nothing else can follow a type, so there is one reading.

### Statements

```txt
block     = "{" { stmt } "}"
stmt      = let
          | "mut" name ":" type "=" expr ";"
          | place "=" expr ";"
          | "return" [ expr ] ";"
          | "invoke" name "(" [ args ] ")" ";"
          | if | walk | match
          | expr ";"
place     = ( name | "self" ) { "." name | "[" expr "]" }
if        = "if" "(" cond ")" body { "else" "if" "(" cond ")" body } [ "else" body ]
cond      = expr | "let" name ":" type "=" expr
walk      = [ "mut" ] "for" "(" name [ "," name ] "in" expr ")" body
match     = "match" "(" expr ")" "{" { "case" patterns body } "}"
patterns  = "else" | pattern { "," pattern }
pattern   = name "." CAPS [ "(" name { "," name } ")" ] | number | text | "true" | "false"
```

`body` is a `block` inside a fn and a `vblock` inside a view. `mut` starts a loop when `for` follows it, and a local otherwise (two tokens of lookahead). Every loop is a walk over a list or a range, so every loop ends.

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
primary   = number | duration | text | "true" | "false" | "self" | name
          | "(" expr ")" | "[" [ expr { "," expr } [ "," ] ] "]"
          | name "{" inits "}" | "{" inits "}"                  a record, named or inline
          | "try" postfix                                       in front of a record or a with
          | lambda
          | vexpr [ callblock ]
          | range
lambda    = "fn" "(" [ lparam { "," lparam } ] ")" [ ":" rtype ] block
lparam    = [ "mut" ] name [ ":" type ]                         types from where it is used
inits     = [ [ "mut" ] name "=" expr { "," [ "mut" ] name "=" expr } [ "," ] ]
```

In an expression a range's bounds are a number, a name or a bracketed expression, so `0..(n - 1)` is written with brackets and `0..n - 1` is a type error and not a surprise. A name directly in front of `{` is always a record, because every condition is in brackets and no statement puts a bare value in front of a block.

### Prose

Prose is read a line at a time. This grammar is for a document below its `@@@` line and for a `markdown` block.

```txt
prose       = { line }
line        = fence | call | control | slot-line | text-line
fence       = a fenced code block, of any language: skipped whole and shown as code
call        = vexpr ";"                                 no block
            | vexpr " {" end-of-line prose "}"          the block is prose, closed by a line of only "}"
control     = "@if (" cond ") {" prose { "} else if (" cond ") {" prose } [ "} else {" prose ] "}"
            | "@" [ "mut " ] "for (" name [ "," name ] "in" expr ") {" prose "}"
            | "@match (" expr ") {" { "case" patterns " {" prose "}" } "}"
slot-line   = "@slot" name " {" prose "}"               directly inside a call's block
text-line   = any other line: Markdown, with holes outside code spans, and $maths$
prose-block = "{" end-of-line prose "}"
```

A line that starts with `@` and a small letter, after up to three spaces, is a `call`, a `control` or a `slot-line`, and anything else there is a compile error. `\@` is a literal @. A call's arguments may run over several lines.

### The reference parser

`mkpcheck.py` is a parser for this grammar, written for this doc. It reads every MKP code block in the nine pages, and on top of the grammar it checks what can be checked without types.

- **Keywords and names** (pass): A keyword is never a name, after a dot included. A name is all small letters, or all capitals for a case or token.
- **Declared types** (pass): Every `let` and `mut` writes its type. Definitions write their parameter types; a lambda may leave them out.
- **No shadowing** (pass): No declaration reuses a value name that is visible where it is written.
- **What follows @** (pass): Every `@name` is a visible value or fn, with arguments in order, or a declared widget.
- **Widget calls** (pass): Every argument is named, is a declared input or event, and is set once. Every input without a default is given.
- **Blocks and slots** (pass): A block of children goes to a widget with exactly one slot. A named block, or a `@slot` line in prose, names a real slot. No slot has a widget's name.
- **Rows by position** (pass): A widget with variables of its own isn't drawn directly in a loop over a list that isn't a constant.
- **Cases and tokens** (pass): Every `type.CAPITALS` is a declared enum case or token.
- **Widget bodies** (pass): The body order, a `markdown` block on every widget in a .mkp file, no `expose` in a widget, and `//@param` lines that name real inputs.
- **Documents and prose** (pass): Front matter, the `@@@` divider, no drawing above it, calls, control lines, slot lines, block ends, holes and `\@`.
- **Types, proofs, effects** (skipped): Not checked by a program. A type checker is the next step, and these rules were checked by hand.

- **Code blocks read**: 51 (all pass)
- **Widget calls checked**: 188 (against 64 declared widgets)
- **Cases and tokens checked**: 266
- **Broken examples caught**: 70 of 70 (one rule broken in each)

The second number matters as much as the first. A checker that passes everything proves nothing, so `tests/negative.md` holds 70 small examples that each break one rule, and the parser has to report every one.

# rest: 50 messages

## E246 `mkp.profile` error at `packages/core/src/profile.ts:47`

message: there is no profile "lesson" among the packs given

block:
```
# Notes

A plain paragraph.

--- checked with ---
--profile lesson
```

builder: Easy: just ask for a profile that is not among the packs. The message is clear.

- reader 1 (yes): The check names profile `lesson`, but no pack given to the check defines it. | fix: Pass the pack that defines `lesson` to the check, or remove the `--profile lesson` argument. | confusing: 
- reader 2 (yes): No lesson profile is among the packs given to the check. | fix: Pass the pack that defines the lesson profile, or delete the '--profile lesson' line. | confusing: 
- reader 3 (partly): The check asks for the 'lesson' profile, but no pack that defines it was given to the checker. | fix: cannot infer (I do not know which pack defines the lesson profile, so the run needs that pack passed in) | confusing: The block only has the flag '--profile lesson'. I do not know where packs are supplied or what pack name to use.

## E247 `mkp.front-type` error at `packages/core/src/profile.ts:61`

message: front matter level must be int

block:
```
--- doc.mkp.md ---
---
title: Limits
level: advanced
---
# Limits

--- manifest.mkp ---
profile lesson@1 "Shape of a lesson."
  requires core@1
  front title text
  
  front level int
--- checked with ---
--profile lesson
```

builder: Easy. The message says what the field must be but not what was found; YAML value "advanced" is not echoed.

- reader 1 (yes): The manifest declares `front level int`, so the document's `level` must be a number. The document gives the word `advanced`. | fix: level: 2 | confusing: 
- reader 2 (yes): The front field level is an int, and the document gives the text advanced. | fix: level: 2 | confusing: 
- reader 3 (yes): The front matter level is declared as an int in the profile, but the document gives text. | fix: level: 2 | confusing: 

## E248 `mkp.front-unknown` error at `packages/core/src/profile.ts:63`

message: the lesson profile has no front-matter field "author"

block:
```
--- doc.mkp.md ---
---
title: Limits
author: Sam
---
# Limits

--- manifest.mkp ---
profile lesson@1 "Shape of a lesson."
  requires core@1
  front title text
  
--- checked with ---
--profile lesson
```

builder: Easy. Clear, though it does not list the fields that do exist.

- reader 1 (yes): The lesson profile declares only `title` in its front matter, so `author` is not allowed. | fix: Delete the `author: Sam` line from the document, or add `front author text` to the profile. | confusing: 
- reader 2 (yes): The lesson profile has no front-matter field named author. The document has author: Sam. | fix: Delete the 'author: Sam' line, or add 'front author text' to the profile. | confusing: 
- reader 3 (yes): The lesson profile does not have a front-matter field called author. | fix: cannot infer | confusing: I do not know whether author should be declared in the profile, or whether the field should be removed from the document.

## E249 `mkp.role` error at `packages/core/src/profile.ts:71`

message: "warmup" is not a section role of lesson (intro, example)

block:
```
--- doc.mkp.md ---
---
title: Limits
---
# Limits

## Warm up
{role=warmup}

--- manifest.mkp ---
profile lesson@1 "Shape of a lesson."
  requires core@1
  front title text
  
  roles intro example
--- checked with ---
--profile lesson
```

builder: Needed to find the role syntax ({role=...} under a heading, from a test). Message lists valid roles, good.

- reader 1 (yes): `role=warmup` is not one of the section roles of the profile, which are intro and example. | fix: {role=intro} | confusing: 
- reader 2 (yes): warmup is not one of the section roles, which are intro and example. | fix: {role=intro} | confusing: 
- reader 3 (yes): 'warmup' is not one of the roles that the lesson profile allows (intro, example). | fix: ## Warm up
{role=intro} | confusing: 

## E250 `mkp.attr-type` error at `packages/core/src/profile.ts:78`

message: weight must be choice(core|extra)

block:
```
--- doc.mkp.md ---
---
title: Limits
---
# Limits

A limit is where a function heads.
{weight=optional}

--- manifest.mkp ---
profile lesson@1 "Shape of a lesson."
  requires core@1
  front title text
  
  attr weight choice(core|extra) "how much it matters"
--- checked with ---
--profile lesson
```

builder: Attribute syntax came from a test. The message names the attribute and the choices but not the wrong value given.

- reader 1 (yes): The `weight` attribute takes only the choices core or extra. The document gives `optional`. | fix: {weight=core} | confusing: 
- reader 2 (yes): weight must be core or extra, and the document says optional. | fix: {weight=core} | confusing: 
- reader 3 (yes): The attribute 'weight' takes one of core or extra, and 'optional' is not one of them. | fix: {weight=extra} | confusing: 

## E251 `mkp.rule.depth` error at `packages/core/src/profile.ts:99`

message: sections go two deep at most

block:
```
--- doc.mkp.md ---
---
title: Limits
---
# Limits

## Idea

### Detail

--- manifest.mkp ---
profile lesson@1 "Shape of a lesson."
  requires core@1
  front title text
  
  front scope text = topic
  front course text = ""
  front sources list(text)
  roles example
  rule depth headings 2 "sections go two deep at most"
--- checked with ---
--profile lesson
```

builder: Rule syntax came from tests. The message is only the author-written text from the rule, with no hint of the value found or the rule used.

- reader 1 (yes): The rule limits sections to two levels, and the document uses a third level (### Detail). | fix: Change `### Detail` to `## Detail`, or keep it as a sub-part of Idea. | confusing: 
- reader 2 (yes): The ### Detail heading is a third heading level. Sections may go only two levels deep. | fix: Remove the '### Detail' heading (or make it a bold line). | confusing: 
- reader 3 (yes): Sections can go only two levels deep, and the document has ### under ##. | fix: Change '### Detail' to '## Detail'. | confusing: The message says two levels, but I am not sure whether the count starts at the title or at the first ##.

## E252 `mkp.rule.first` error at `packages/core/src/profile.ts:105`

message: a lesson starts with a heading

block:
```
--- doc.mkp.md ---
---
title: Limits
---
A limit is where a function heads.

# Limits

--- manifest.mkp ---
profile lesson@1 "Shape of a lesson."
  requires core@1
  front title text
  
  front scope text = topic
  front course text = ""
  front sources list(text)
  roles example
  rule first body heading "a lesson starts with a heading"
--- checked with ---
--profile lesson
```

builder: Rule syntax came from tests. The message is only the author-written text from the rule, with no hint of the value found or the rule used.

- reader 1 (yes): The rule needs the first block of the lesson to be a heading. The document starts with a paragraph. | fix: Move the `# Limits` heading above the paragraph. | confusing: 
- reader 2 (yes): A lesson must begin with a heading, but this one begins with a paragraph. | fix: Move 'A limit is where a function heads.' below the '# Limits' heading. | confusing: 
- reader 3 (yes): A lesson has to start with a heading, but the first line here is a paragraph. | fix: Move '# Limits' above 'A limit is where a function heads.' | confusing: 

## E253 `mkp.rule.required` error at `packages/core/src/profile.ts:109`

message: cite at least one source

block:
```
--- doc.mkp.md ---
---
title: Limits
sources: []
---
# Limits

--- manifest.mkp ---
profile lesson@1 "Shape of a lesson."
  requires core@1
  front title text
  
  front scope text = topic
  front course text = ""
  front sources list(text)
  roles example
  rule required front.sources "cite at least one source"
--- checked with ---
--profile lesson
```

builder: Rule syntax came from tests. The message is only the author-written text from the rule, with no hint of the value found or the rule used.

- reader 1 (yes): The rule requires at least one source, and `sources` is empty. | fix: sources: ["Smith 2020"] | confusing: 
- reader 2 (yes): The rule requires at least one source, and the list is empty. | fix: sources: ["Textbook, p. 4"] | confusing: 
- reader 3 (yes): The rule requires at least one source, and the sources list is empty. | fix: sources: ["Source One"] | confusing: 

## E254 `mkp.rule.one-of` error at `packages/core/src/profile.ts:113`

message: scope is topic or chapter

block:
```
--- doc.mkp.md ---
---
title: Limits
scope: unit
---
# Limits

--- manifest.mkp ---
profile lesson@1 "Shape of a lesson."
  requires core@1
  front title text
  
  front scope text = topic
  front course text = ""
  front sources list(text)
  roles example
  rule one-of front.scope topic chapter "scope is topic or chapter"
--- checked with ---
--profile lesson
```

builder: Rule syntax came from tests. The message is only the author-written text from the rule, with no hint of the value found or the rule used.

- reader 1 (yes): `scope` must be topic or chapter, and the document gives `unit`. | fix: scope: topic | confusing: 
- reader 2 (yes): scope must be topic or chapter. The document says unit. | fix: scope: topic | confusing: 
- reader 3 (yes): scope must be topic or chapter, and the document gives unit. | fix: scope: topic | confusing: I chose topic. The author may have meant chapter.

## E255 `mkp.rule.pattern` error at `packages/core/src/profile.ts:124`

message: course ids are kebab-case

block:
```
--- doc.mkp.md ---
---
title: Limits
course: Calculus 1
---
# Limits

--- manifest.mkp ---
profile lesson@1 "Shape of a lesson."
  requires core@1
  front title text
  
  front scope text = topic
  front course text = ""
  front sources list(text)
  roles example
  rule pattern front.course "^[a-z-]+$" "course ids are kebab-case"
--- checked with ---
--profile lesson
```

builder: Rule syntax came from tests. The message is only the author-written text from the rule, with no hint of the value found or the rule used.

- reader 1 (yes): The course id must be kebab-case, and 'Calculus 1' has capitals and a space. | fix: course: calculus-1 | confusing: 
- reader 2 (yes): A course id must be kebab-case, and 'Calculus 1' has capitals and a space. | fix: course: calculus-1 | confusing: 
- reader 3 (yes): The course id must be kebab-case (lowercase words joined by hyphens), and 'Calculus 1' has capitals and a space. | fix: course: calculus-1 | confusing: 

## E256 `mkp.rule.max-length` error at `packages/core/src/profile.ts:130`

message: keep titles short

block:
```
--- doc.mkp.md ---
---
title: Limits of functions
---
# Limits

--- manifest.mkp ---
profile lesson@1 "Shape of a lesson."
  requires core@1
  front title text
  
  front scope text = topic
  front course text = ""
  front sources list(text)
  roles example
  rule max-length front.title 10 "keep titles short"
--- checked with ---
--profile lesson
```

builder: Rule syntax came from tests. The message is only the author-written text from the rule, with no hint of the value found or the rule used.

- reader 1 (yes): The rule limits the title to 10 characters. "Limits of functions" is 19. | fix: title: Limits | confusing: 
- reader 2 (yes): The title is longer than the 10-character limit. | fix: title: Limits | confusing: 
- reader 3 (yes): The title is longer than 10 characters, which breaks the max-length rule. | fix: title: Limits | confusing: 

## E257 `mkp.rule.count` error at `packages/core/src/profile.ts:139`

message: one to three examples

block:
```
--- doc.mkp.md ---
---
title: Limits
---
# Limits

--- manifest.mkp ---
profile lesson@1 "Shape of a lesson."
  requires core@1
  front title text
  
  front scope text = topic
  front course text = ""
  front sources list(text)
  roles example
  rule count roles.example 1..3 "one to three examples"
--- checked with ---
--profile lesson
```

builder: Rule syntax came from tests. The message is only the author-written text from the rule, with no hint of the value found or the rule used.

- reader 1 (yes): The rule needs one to three examples, and the document has none. | fix: Add an example block to the document, or change the rule's range. | confusing: The document has no example syntax shown, so I can't write one.
- reader 2 (partly): The profile requires one to three example roles, but the document has none. | fix: cannot infer (add an example section; the syntax is not shown) | confusing: I do not know how a role is marked in the document.
- reader 3 (yes): The rule needs one to three examples, and the document has none. | fix: cannot infer | confusing: The block has no example section, and I do not know what content it should have.

## E258 `mkp.rule.count` error at `packages/core/src/profile.ts:140`

message: exactly two examples

block:
```
--- doc.mkp.md ---
---
title: Limits
---
# Limits

## One
{role=example}

--- manifest.mkp ---
profile lesson@1 "Shape of a lesson."
  requires core@1
  front title text
  
  front scope text = topic
  front course text = ""
  front sources list(text)
  roles example
  rule count roles.example 2 "exactly two examples"
--- checked with ---
--profile lesson
```

builder: Rule syntax came from tests. The message is only the author-written text from the rule, with no hint of the value found or the rule used.

- reader 1 (yes): The rule needs exactly two examples, and the document has one. | fix: Add a second section with `{role=example}`. | confusing: 
- reader 2 (yes): The rule needs exactly two example sections, and the document has one. | fix: Add a second '{role=example}' section. | confusing: 
- reader 3 (yes): The lesson rule needs exactly two example sections, but only one has role=example. | fix: Add a second section, for example '## Two' followed by '{role=example}'. | confusing: 

## E259 `mkp.rule.required` error at `packages/core/src/profile.ts:94`

message: required front.sources

block:
```
--- doc.mkp.md ---
---
title: Limits
---
# Limits

--- manifest.mkp ---
profile lesson@1 "Shape of a lesson."
  requires core@1
  front title text
  
  front sources list(text)
  rule required front.sources
--- checked with ---
--profile lesson
```

builder: With no message string on the rule, the message is just "required front.sources": the rule name and path, no explanation of what is missing.

- reader 1 (yes): The manifest requires `front.sources`, but the document has no `sources` key. | fix: Add `sources: ["Some source"]` to the document's front matter. | confusing: 
- reader 2 (yes): The rule requires front.sources, and the document has none. | fix: sources: ["Textbook"] | confusing: 
- reader 3 (yes): The rule requires front.sources to be set, and the document does not set it. | fix: sources: ["Source One"] | confusing: The example source is invented; I do not know which real source should go here.

## E260 `mkp.profile` error at `packages/core/src/profile.ts:122`

message: rule pattern front.course: "[a-z" is not a valid pattern

block:
```
--- doc.mkp.md ---
---
title: Limits
course: calc
---
# Limits

--- manifest.mkp ---
profile lesson@1 "Shape of a lesson."
  requires core@1
  front title text
  
  front course text = ""
  rule pattern front.course "[a-z" "course ids are kebab-case"
--- checked with ---
--profile lesson
```

builder: A broken regex in the profile is reported against line 1 of the document, not the manifest line that holds it, and is reported once per run of the rule.

- reader 1 (partly): The pattern `[a-z` in the rule is a broken regular expression, because the bracket is not closed. | fix: rule pattern front.course "[a-z]+" "course ids are kebab-case" | confusing: I'm assuming the rule language uses standard regular expressions.
- reader 2 (yes): The rule pattern is a regular expression, and [a-z is missing its closing bracket. | fix: rule pattern front.course "[a-z]+" "course ids are kebab-case" | confusing: 
- reader 3 (yes): The pattern '[a-z' is not a valid regular expression, because the bracket is not closed. | fix: rule pattern front.course "^[a-z]+$" "course ids are kebab-case" | confusing: 

## E261 `mkp.profile` error at `packages/core/src/profile.ts:144`

message: unknown rule "length"; rules are required, one-of, pattern, max-length, count, depth and first

block:
```
--- doc.mkp.md ---
# Notes

A plain paragraph.

--- manifest.mkp ---
profile lesson@1 "Shape of a lesson."
  requires core@1
  front title text
  
  rule length front.title 10 "short titles"
--- checked with ---
--profile lesson
```

builder: Unknown rule name. The message lists valid rules; but position is the document line 1 rather than the manifest.

- reader 1 (yes): `length` is not a rule. The rule for length is `max-length`. | fix:   rule max-length front.title 10 "short titles" | confusing: 
- reader 2 (yes): length is not a rule. The valid rules include max-length, which fits this check. | fix: rule max-length front.title 10 "short titles" | confusing: 
- reader 3 (yes): 'length' is not a rule name. The valid rule for a maximum length is 'max-length'. | fix:   rule max-length front.title 10 "short titles" | confusing: 

## E262 `mkp.pack-duplicate` error at `packages/core/src/check/program.ts:96`

message: pack notes@1 is given twice

block:
```
--- doc.mkp.md ---
# Notes

```note
label: Remember the units
summary: A note.
```

--- manifest.mkp ---
pack notes@1 "Small notes for lessons."
  requires core@1
  provides note

--- note.mkp ---
note@1 "A short note with a label."
  in label text "the label"
  text label
  project md = label

--- note.fixture.json ---
{"widget":"note@1","cases":{"basic":{"props":{"label":"Hello"},"summary":"Hello"}}}
--- checked with ---
--pack {pack}
```

builder: Natural mistake (passing the same --pack twice). Message has no position, so the where is empty-ish; it does not say which paths were given.

- reader 1 (partly): The pack `notes@1` is given twice, probably once in the manifest and once in the check command, which also lists it. | fix: Keep the pack in only one place: remove the `--pack {pack}` argument or the second copy. I can't tell which one the checker expects. | confusing: The message doesn't say where the two uses are.
- reader 2 (yes): The pack notes@1 is given to the check twice. | fix: Remove one of the two --pack notes@1 entries. | confusing: 
- reader 3 (yes): The pack notes@1 was passed twice on the command line. | fix: Pass --pack notes@1 once in the check command. | confusing: The check line still reads '--pack {pack}', so it is unclear whether the template was filled in wrongly.

## E263 `mkp.duplicate-definition` error at `packages/core/src/check/program.ts:108`

message: note@1 is defined twice in pack notes

block:
```
--- doc.mkp.md ---
# Notes

```note
label: Remember the units
summary: A note.
```

--- manifest.mkp ---
pack notes@1 "Small notes for lessons."
  requires core@1
  provides note

--- note.mkp ---
note@1 "A short note with a label."
  in label text "the label"
  text label
  project md = label

--- note.fixture.json ---
{"widget":"note@1","cases":{"basic":{"props":{"label":"Hello"},"summary":"Hello"}}}
--- extra.mkp ---
note@1 "A short note with a label."
  in label text "the label"
  text label
  project md = label

```

builder: Easy. Position is of the second definition; message does not say where the first is.

- reader 1 (yes): `note@1` is defined twice in pack notes, once in note.mkp and again in extra.mkp. | fix: Delete extra.mkp, or rename its widget to a different name and version. | confusing: 
- reader 2 (yes): note@1 is defined in both note.mkp and extra.mkp. | fix: Delete extra.mkp, or rename the definition in it. | confusing: 
- reader 3 (yes): note@1 is defined twice in the pack notes, once in note.mkp and once in extra.mkp. | fix: Delete extra.mkp, or rename its widget to note@2. | confusing: 

## E264 `mkp.op-untyped` error at `packages/core/src/check/program.ts:126`

message: op + must type every parameter; dispatch uses them (6.22)

block:
```
--- manifest.mkp ---
pack notes@1 "Small notes for lessons."
  requires core@1
  provides note

--- note.mkp ---
note@1 "A short note with a label."
  in label text "the label"
  text label
  project md = label
type vec2 = {x: num, y: num}
op +(a: vec2, b): vec2 = {x: a.x + b.x, y: a.y}

```

builder: Op with one untyped parameter. The "(6.22)" section number in the message is meaningless to an author.

- reader 1 (partly): The operator `+` takes two parameters, and each must have a type. The `b` parameter has no type, and the result is not checked. | fix: op +(a: vec2, b: vec2): vec2 = {x: a.x + b.x, y: a.y + b.y} | confusing: The message refers to a spec section 6.22 which I don't have. I also don't see why `y` is wrong, since it isn't part of the message.
- reader 2 (yes): Every parameter of an op must have a type, and b has none. The result also uses a.y where it should use b.y. | fix: op +(a: vec2, b: vec2): vec2 = {x: a.x + b.x, y: a.y + b.y} | confusing: 
- reader 3 (yes): The operator '+' needs every parameter typed, and parameter 'b' has no type. | fix: op +(a: vec2, b: vec2): vec2 = {x: a.x + b.x, y: a.y} | confusing: 

## E265 `mkp.untyped` error at `packages/core/src/check/program.ts:128`

message: fn double must type every parameter and its result: fn double(x: num): num = …

block:
```
--- manifest.mkp ---
pack notes@1 "Small notes for lessons."
  requires core@1
  provides note

--- note.mkp ---
note@1 "A short note with a label."
  in label text "the label"
  text label
  project md = label
fn double(x) = x * 2

```

builder: The message example fn double(x: num): num = ... is helpful; the "fn" without types is a natural mistake from other languages.

- reader 1 (yes): `fn double` must type each parameter and its result, and the block gives neither. | fix: fn double(x: num): num = x * 2 | confusing: 
- reader 2 (yes): fn parameters and the result must be typed. | fix: fn double(x: num): num = x * 2 | confusing: 
- reader 3 (yes): The fn 'double' has an untyped parameter 'x' and no typed result. Both are required. | fix: fn double(x: num): num = x * 2 | confusing: 

## E266 `mkp.pack-reserved` error at `packages/core/src/build.ts:223`

message: the pack name "core" is reserved for the base set

block:
```
--- manifest.mkp ---
pack core@1 "Small notes for lessons."
  requires core@1
  provides note

--- note.mkp ---
note@1 "A short note with a label."
  in label text "the label"
  text label
  project md = label

```

builder: Easy to hit by accident when naming a pack "core". Position is just the pack folder at line 1, not the manifest.

- reader 1 (yes): `core` is a reserved pack name for the base set. | fix: Rename the pack, e.g. `pack corenotes@1` in manifest.mkp. | confusing: 
- reader 2 (yes): The pack name core is reserved for the base set. | fix: pack notes@1 "Small notes for lessons." | confusing: 
- reader 3 (yes): The pack name core is reserved for the base set, and this pack uses it. | fix: pack notes@1 "Small notes for lessons." | confusing: I renamed the pack to notes. The name is my guess, and the requires line still names core@1, which is the base set.

## E267 `mkp.pack-depends` error at `packages/core/src/build.ts:241`

message: notes depends on chips@1, which this build was not given (pass it with --pack)

block:
```
--- doc.mkp.md ---
# Notes

```note
label: Remember the units
summary: A note.
```

--- manifest.mkp ---
pack notes@1 "Small notes for lessons."
  requires core@1
  depends chips@1
  provides note

--- note.mkp ---
note@1 "A short note with a label."
  in label text "the label"
  text label
  project md = label

--- note.fixture.json ---
{"widget":"note@1","cases":{"basic":{"props":{"label":"Hello"},"summary":"Hello"}}}
```

builder: The fix hint says pass it with --pack, which is CLI-specific.

- reader 1 (yes): `notes` depends on chips@1, but the build was not given that pack. | fix: Pass the chips pack with --pack when building, or remove the `depends chips@1` line. | confusing: 
- reader 2 (partly): notes depends on chips@1, but this build was not given that pack. | fix: Pass the chips pack with --pack, or remove the 'depends chips@1' line. | confusing: I cannot tell which of the two options the project wants.
- reader 3 (yes): The 'notes' pack depends on chips@1, but that pack was not given to the build. | fix: Pass the chips pack with --pack, or remove the line 'depends chips@1' if notes does not need it. | confusing: 

## E268 `mkp.duplicate-type` error at `packages/core/src/check/program.ts:114`

message: type size is declared twice in pack notes

block:
```
--- manifest.mkp ---
pack notes@1 "Small notes for lessons."
  requires core@1
  provides note size

--- note.mkp ---
note@1 "A short note with a label."
  in label text "the label"
  text label
  project md = label
type size = {w: num, h: num}
type size = {w: num, h: num, d: num}

```

builder: I first wrote "provides note, size" with a comma and got a different error (provides "note,"): the manifest list is space separated and the message quotes the comma, which is how I noticed. The duplicate itself is plain; the message does not say where the first declaration is.

- reader 1 (yes): `type size` is declared twice in the same pack. | fix: Delete one of the two `type size` lines, or rename one of them. | confusing: 
- reader 2 (yes): The type size is declared twice in the same pack. | fix: Delete the first 'type size = {w: num, h: num}' line. | confusing: 
- reader 3 (yes): The type 'size' is declared twice in the same pack. | fix: Delete one of the two 'type size' lines. | confusing: 

## E269 `mkp.duplicate-definition` error at `packages/core/src/check/program.ts:148`

message: interface scored@1 is declared twice in pack notes

block:
```
--- manifest.mkp ---
pack notes@1 "Small notes for lessons."
  requires core@1
  provides note scored

--- note.mkp ---
note@1 "A short note with a label."
  in label text "the label"
  text label
  project md = label
interface scored@1 "Reports a score."
  in of int
  signal scored {got: int}
  project md
interface scored@1 "Reports a score."
  in of int
  signal scored {got: int}
  project md

```

builder: Same code as the widget duplicate but the wording differs ("declared twice" for interfaces, "defined twice" for widgets).

- reader 1 (yes): The interface `scored@1` is declared twice in the same pack. | fix: Delete the second copy of the interface block. | confusing: The `project md` line inside the interface is also unexpected, but the message doesn't mention it.
- reader 2 (yes): The interface scored@1 appears twice in the same pack. | fix: Delete the second copy of the interface scored@1 block. | confusing: 
- reader 3 (yes): interface scored@1 is declared twice in the pack notes, once with each identical body. | fix: Delete the second interface scored@1 block. | confusing: 

## E270 `mkp.pack-depends` error at `packages/core/src/build.ts:242`

message: notes depends on chips@2; this build has chips@1

block:
```
--- doc.mkp.md ---
# Notes

```note
label: Remember the units
summary: A note.
```

--- manifest.mkp ---
pack notes@1 "Small notes for lessons."
  requires core@1
  depends chips@2
  provides note

--- note.mkp ---
note@1 "A short note with a label."
  in label text "the label"
  text label
  project md = label

--- note.fixture.json ---
{"widget":"note@1","cases":{"basic":{"props":{"label":"Hello"},"summary":"Hello"}}}
--- manifest.mkp  (second pack) ---
pack chips@1 "Chips."
  requires core@1
  provides chip

--- chip.mkp  (second pack) ---
chip@1 "A small chip."
  in label text
  text label
  project md = label

```

builder: Needs two packs to show. The message says what the build has but the manifests of the two packs sit in different folders; the position points at the depending manifest, good.

- reader 1 (yes): `notes` depends on chips@2, but the build has chips@1. | fix: Change the dependency to `depends chips@1`, or supply chips@2. | confusing: 
- reader 2 (yes): notes depends on chips@2, but the build has chips@1. | fix: depends chips@1 | confusing: 
- reader 3 (yes): The notes pack asks for chips@2, but the build only has chips@1. | fix:   depends chips@1 | confusing: 

## E271 `mkp.capability` error at `packages/core/src/build.ts:244`

message: notes requires audio@1, which is not a known capability (core@1, gfx@1)

block:
```
--- doc.mkp.md ---
# Notes

```note
label: Remember the units
summary: A note.
```

--- manifest.mkp ---
pack notes@1 "Small notes for lessons."
  requires core@1
  requires audio@1
  provides note

--- note.mkp ---
note@1 "A short note with a label."
  in label text "the label"
  text label
  project md = label

--- note.fixture.json ---
{"widget":"note@1","cases":{"basic":{"props":{"label":"Hello"},"summary":"Hello"}}}
```

builder: The capability list in the message (core@1, gfx@1) is useful; I guessed audio@1 as a plausible capability.

- reader 1 (yes): The manifest requires `audio@1`, which is not one of the known capabilities (core@1, gfx@1). | fix: Delete the `requires audio@1` line. | confusing: 
- reader 2 (partly): audio is not a known capability. Only core and gfx are. | fix: Remove 'requires audio@1', or use a capability that exists. | confusing: I cannot tell whether an audio capability is expected from another pack.
- reader 3 (yes): The pack requires audio@1, which this build does not provide. Only core@1 and gfx@1 exist. | fix: Delete the line 'requires audio@1'. | confusing: 

## E272 `mkp.pack-provides` error at `packages/core/src/build.ts:247`

message: notes provides "callout", but no definition, type, fn or constant has that name

block:
```
--- doc.mkp.md ---
# Notes

```note
label: Remember the units
summary: A note.
```

--- manifest.mkp ---
pack notes@1 "Small notes for lessons."
  requires core@1
  provides note callout

--- note.mkp ---
note@1 "A short note with a label."
  in label text "the label"
  text label
  project md = label

--- note.fixture.json ---
{"widget":"note@1","cases":{"basic":{"props":{"label":"Hello"},"summary":"Hello"}}}
```

builder: Easy. Names the pack and name; the position is the manifest line 1 not the provides line.

- reader 1 (yes): The manifest says the pack provides `callout`, but no definition, type, fn or constant has that name. | fix: Remove `callout` from the provides line, or add a definition named callout. | confusing: 
- reader 2 (yes): callout is listed in provides, but no definition, type, fn or constant has that name. | fix: pack notes@1 "Small notes for lessons."
  requires core@1
  provides note | confusing: 
- reader 3 (yes): notes provides callout, but no definition, type, fn or constant with that name exists. | fix: Delete 'callout' from the provides line, or define it. | confusing: 

## E273 `mkp.reserved` error at `packages/core/src/build.ts:261`

message: column is a base widget name and is reserved

block:
```
--- manifest.mkp ---
pack extras@1 "Extra layouts."
  requires core@1
  provides column

--- column.mkp ---
column@1 "A column with a heading."
  in title text
  text title
  project md = title

```

builder: Naming a widget like a base one (column) is natural. No position is printed for this error.

- reader 1 (yes): `column` is a built-in widget name and can't be used for a provide. | fix: Rename the widget and the provide, e.g. `titledcolumn@1` and `provides titledcolumn`. | confusing: 
- reader 2 (yes): column is a base widget name and is reserved, so a pack cannot provide it. | fix: Rename the widget to colheading@1 in the file and in provides. | confusing: 
- reader 3 (yes): 'column' is a base widget name and is reserved, so this pack cannot use it. | fix: Rename the widget and pack to a free name, for example 'columnbox@1' in column.mkp and 'provides columnbox'. | confusing: 

## E274 `mkp.reserved` error at `packages/core/src/build.ts:263`

message: slot is a built-in node name (each, switch, case, else, slot, fill, controls, arrow) and is reserved

block:
```
--- manifest.mkp ---
pack extras@1 "Extra layouts."
  requires core@1
  provides slot

--- slot.mkp ---
slot@1 "A time slot."
  in label text
  text label
  project md = label

```

builder: "slot" is a natural widget name for a timetable; the message dumps the whole list of built-in node names, which helps. No position.

- reader 1 (yes): `slot` is a built-in name and can't be used for a widget or pack name. | fix: Rename the widget and the provide, e.g. `timeslot@1 "A time slot."` and `provides timeslot`. | confusing: 
- reader 2 (yes): slot is a built-in name and cannot be used for a widget. | fix: Rename the widget to timeslot@1 in the file and in provides. | confusing: 
- reader 3 (yes): 'slot' is a built-in node name and cannot be used as a pack name. | fix: Rename the widget and the pack, for example 'timeslot@1'. | confusing: 

## E275 `mkp.capability-fallback` warning at `packages/core/src/build.ts:278`

message: note requires audio@1; providers without it show its fallback

block:
```
--- manifest.mkp ---
pack notes@1 "Small notes for lessons."
  requires core@1
  provides note

--- note.mkp ---
note@1 "A short note with a label."
  requires audio@1
  in label text "the label"
  text label
  project md = label

```

builder: Triggered by a definition-level "requires audio@1" which is not offered by the checker; I had to read def.ts to learn the syntax.

- reader 1 (partly): The note requires `audio@1`. A provider that lacks it will show the fallback text, so the note needs an `about` text. | fix: Add an about text to the note definition, or remove `requires audio@1`. | confusing: I don't know where the 'about' text goes.
- reader 2 (partly): note requires audio@1. A host without audio should show note's fallback, and no fallback is given. | fix: Add under note@1: about "A short note." | confusing: "Providers without it show its fallback" — I am guessing that 'about' is the fallback, from the earlier message.
- reader 3 (yes): note requires audio@1, which providers may not have. They show the fallback instead. | fix: cannot infer | confusing: The message says providers without audio show the fallback, but the block gives no fallback text, so I cannot tell what to write.

## E276 `mkp.limit` error at `packages/core/src/build.ts:380`

message: level1 nests definitions 13 deep; at most 12

block:
```
--- manifest.mkp ---
pack outline@1 "A nested outline."
  requires core@1
  provides level1 level2 level3 level4 level5 level6 level7 level8 level9 level10 level11 level12 level13

--- levels.mkp ---
level1@1 "Level 1 of the outline."
  in label text
  column
    level2 label=label
  project md = label
level2@1 "Level 2 of the outline."
  in label text
  column
    level3 label=label
  project md = label
level3@1 "Level 3 of the outline."
  in label text
  column
    level4 label=label
  project md = label
level4@1 "Level 4 of the outline."
  in label text
  column
    level5 label=label
  project md = label
level5@1 "Level 5 of the outline."
  in label text
  column
    level6 label=label
  project md = label
level6@1 "Level 6 of the outline."
  in label text
  column
    level7 label=label
  project md = label
level7@1 "Level 7 of the outline."
  in label text
  column
    level8 label=label
  project md = label
level8@1 "Level 8 of the outline."
  in label text
  column
    level9 label=label
  project md = label
level9@1 "Level 9 of the outline."
  in label text
  column
    level10 label=label
  project md = label
level10@1 "Level 10 of the outline."
  in label text
  column
    level11 label=label
  project md = label
level11@1 "Level 11 of the outline."
  in label text
  column
    level12 label=label
  project md = label
level12@1 "Level 12 of the outline."
  in label text
  column
    level13 label=label
  project md = label
level13@1 "Level 13 of the outline."
  in label text
  text label
  project md = label

```

builder: Needed 13 definitions in a chain to reach 12-deep nesting; a natural program rarely gets here, so the limit is hard to hit by accident.

- reader 1 (yes): The chain of definitions nests 13 levels deep, and the limit is 12. The innermost is level13. | fix: Remove one level, e.g. make level12 use text directly instead of calling level13. | confusing: 
- reader 2 (partly): The chain of level definitions nests 13 deep, and the limit is 12. | fix: Remove level13 and let level12 show label as text instead. | confusing: I cannot tell whether removing a level changes what the outline should show.
- reader 3 (yes): The chain of nested levels is 13 deep, and the maximum is 12. | fix: Remove one level, for example delete 'level13' and its use in 'level12', and change 'level12' to show its label directly. | confusing: 

## E277 `mkp.name-clash` warning at `packages/core/src/build.ts:260`

message: note is provided by notes and remarks; uses must be qualified as pack:note

block:
```
--- manifest.mkp ---
pack notes@1 "Small notes for lessons."
  requires core@1
  provides note

--- note.mkp ---
note@1 "A short note with a label."
  in label text "the label"
  text label
  project md = label

--- note.fixture.json ---
{"widget":"note@1","cases":{"basic":{"props":{"label":"Hello"},"summary":"Hello"}}}
--- manifest.mkp  (second pack) ---
pack remarks@1 "More notes."
  requires core@1
  provides note

--- note.mkp  (second pack) ---
note@1 "A margin note."
  in label text "the label"
  text label
  project md = label

```

builder: A warning, not an error. It has no position. "pack:name" qualification syntax is only hinted at.

- reader 1 (partly): The name `note` is provided by two packs (notes and remarks), so a bare `note` is ambiguous. A use must be qualified as `pack:note`. | fix: Change the fence ```note to ```notes:note in the document. | confusing: The block doesn't show a use of `note` in the document, so I'm inferring where the qualified name goes.
- reader 2 (partly): note is provided by two packs, so a use must name the pack, as pack:note. | fix: notes:note "A short note." | confusing: I do not know where in the document this use is, so the fix may apply to the wrong place.
- reader 3 (yes): 'note' is provided by two packs, so it must be used as pack:note. | fix: Use 'notes:note' or 'remarks:note' wherever note is referenced. | confusing: 

## E278 `mkp.version-changed` error at `packages/core/src/build.ts:399`

message: notes:note@1 changed since it was locked; a behaviour change is a new version (@N+1), or build with --relock while the pack is unpublished

block:
```
--- doc.mkp.md ---
# Notes

```note
label: Remember the units
summary: A note.
```

--- mkp.lock ---
{
 "packs": [
  {
   "pack": "notes",
   "version": 1,
   "digest": "sha256:0000000000000000000000000000000000000000000000000000000000000000"
  }
 ],
 "defs": {
  "notes:note@1": "sha256:d756add7afb1d1b33b50ce977e7673675400b351c7d088672d2cec763213d92e"
 }
}
--- manifest.mkp ---
pack notes@1 "Small notes for lessons."
  requires core@1
  provides note

--- note.mkp ---
note@1 "A short note with a label."
  in label text "the label"
  text label tone=muted
  project md = label

```

builder: Must edit a definition after locking. The lock shown is trimmed to the pack and definition it names. Error carries no position and no hint of which line changed.

- reader 1 (partly): The note's definition changed since the lock file was written. A change in behaviour needs a new version (note@2), or a relock while the pack is unpublished. | fix: Either bump the note to @2, or rebuild with --relock if the pack is unpublished. The block changes `text label` to `text label tone=muted`, which is the behaviour change. | confusing: The message says 'a behaviour change', and I'm not sure if adding tone counts as one, but the lock digest changed.
- reader 2 (partly): note changed after it was locked. A behaviour change needs a new version (note@2), or a relock while the pack is unpublished. | fix: Revert to 'text label' (remove tone=muted), or rename the definition to note@2 and update provides. | confusing: I cannot tell whether tone=muted counts as a behaviour change, and the lock file's digests are opaque to me.
- reader 3 (yes): notes:note@1 changed since it was locked. A behaviour change needs a new version (@N+1), or a rebuild with --relock while the pack is unpublished. | fix: Change the pack to notes@2 and bump the note to note@2, or rebuild with --relock. | confusing: 

## E279 `mkp.pack-changed` warning at `packages/core/src/build.ts:392`

message: notes@1 changed since the lock was written; a published version must not change

block:
```
--- mkp.lock ---
{
 "packs": [
  {
   "pack": "notes",
   "version": 1,
   "digest": "sha256:f241199810fa8566dc89334f17d879eb89a3dbb4e4d3433266524fcf335b16f9"
  }
 ],
 "defs": {
  "notes:note@1": "sha256:d756add7afb1d1b33b50ce977e7673675400b351c7d088672d2cec763213d92e"
 }
}
--- manifest.mkp ---
pack notes@1 "Small notes for lessons."
  requires core@1
  provides note

--- note.mkp ---
note@1 "A short note with a label."
  in label text "the label"
  text label
  project md = label

--- note.fixture.json ---
{"widget":"note@1","cases":{"basic":{"props":{"label":"Hello"},"summary":"Hello"}}}
--- checked with ---
--lock mkp.lock
```

builder: The lock file holds opaque digests; an author cannot tell from the message what changed in the pack (I only added a fixture). It is a warning with no position.

- reader 1 (yes): The note's definition changed after the lock was written, but the published version 1 must not change. | fix: Restore the note definition to match the lock, or publish the change as note@2. | confusing: 
- reader 2 (partly): notes@1 has changed since the lock was written. A published version must not change. | fix: cannot infer (revert the change to note@1, or publish the change as note@2; relock only while the pack is unpublished) | confusing: The lock file's digests are opaque to me, so I cannot tell which change caused the mismatch.
- reader 3 (yes): notes@1 was changed after it was locked, and a published version must not change. | fix: Restore the original notes@1 files so the digest matches, or bump the pack to notes@2 and update the lock. | confusing: 

## E280 `mkp.pack-size` error at `packages/core/src/pack.ts:38`

message: pack.mkpack is 28.5 MB; a pack may be at most 25 MB

block:
```
pack.mkpack (a zip) holding:
--- manifest.mkp ---
pack notes@1 "Small notes for lessons."
  requires core@1
  provides note

--- note.mkp ---
note@1 "A short note with a label."
  in label text "the label"
  text label
  project md = label

--- a.png ---
<10 MB of random bytes>
--- b.png ---
<10 MB of random bytes>
--- c.png ---
<10 MB of random bytes>
```

builder: A zip bigger than 25 MB, made from three large images. Hard to hit by accident; message does not say which files are heavy, and its sizes are of the whole archive.

- reader 1 (yes): The pack is 28.5 MB, and a pack may be at most 25 MB. Three 10 MB images are too much. | fix: Remove one of the three 10 MB images so the total is about 18.5 MB. | confusing: 
- reader 2 (yes): The pack is 28.5 MB, over the 25 MB limit. | fix: Remove one of the three 10 MB PNG files. | confusing: 
- reader 3 (yes): The total pack is 28.5 MB, but the limit is 25 MB. | fix: Remove one 10 MB png file, or make the images smaller. | confusing: 

## E281 `mkp.pack-zip` error at `packages/core/src/pack.ts:50`

message: pack.mkpack is not a zip file

block:
```

(the .mkpack file holds the manifest text itself, not a zip)
```

builder: Easy: renaming a manifest to .mkpack. Message is plain.

- reader 1 (partly): The .mkpack file must be a zip archive, but this one holds plain text. | fix: Create the pack as a zip containing the manifest and files. | confusing: The block is a placeholder, so I can't see the real file.
- reader 2 (yes): pack.mkpack must be a zip archive. The block is a note, not a zip file. | fix: Zip the pack's manifest and .mkp files into pack.mkpack. | confusing: 
- reader 3 (no): The file is not a zip archive, so it cannot be read as a pack. | fix: cannot infer | confusing: The block is empty and only says that the .mkpack file holds the manifest text, so I cannot tell what the file contains.

## E282 `mkp.pack-zip` error at `packages/core/src/pack.ts:60`

message: pack.mkpack has a damaged central directory

block:
```
(a zip of the three files above whose central directory was damaged by a byte flip: the archive was cut and re-joined)
```

builder: Can only be produced by corrupting the archive by hand. The message cannot tell the author what to fix.

- reader 1 (partly): The zip's central directory, the index at the end of the file, is damaged, so the file can't be read. | fix: Rebuild the pack from the source files. | confusing: The block is only a description, so I can't see the bytes to repair.
- reader 2 (yes): The zip's central directory, the index at its end, was damaged, so the archive cannot be read. | fix: Rebuild pack.mkpack from the source files. | confusing: 
- reader 3 (partly): The zip archive's central directory (its index of files) is damaged, so the archive cannot be read correctly. | fix: Rebuild pack.mkpack from the source files. | confusing: I do not know whether the damage can be repaired in place, so rebuilding is my guess.

## E283 `mkp.pack-path` error at `packages/core/src/pack.ts:73`

message: pack.mkpack: "../note.mkp" is an absolute path or uses ".."; packs hold relative paths only

block:
```
pack.mkpack (a zip) holding:
--- manifest.mkp ---
pack notes@1 "Small notes for lessons."
  requires core@1
  provides note

--- note.mkp ---
note@1 "A short note with a label."
  in label text "the label"
  text label
  project md = label

--- note.fixture.json ---
{"widget":"note@1","cases":{"basic":{"props":{"label":"Hello"},"summary":"Hello"}}}
--- ../note.mkp ---
note@1 "A short note with a label."
  in label text "the label"
  text label
  project md = label

```

builder: Zip entry named ../note.mkp. The message says "absolute path or uses .." though only one holds here.

- reader 1 (yes): A pack must hold only relative paths. `../note.mkp` goes up a directory, and the file duplicates `note.mkp`. | fix: Delete the `--- ../note.mkp ---` file, since `note.mkp` already exists. | confusing: 
- reader 2 (yes): A file path in a pack must be relative and cannot use '..'. | fix: Put note.mkp at the root of the pack instead of ../note.mkp. | confusing: 
- reader 3 (yes): The file path '../note.mkp' goes up a directory, and packs may only hold relative paths inside them. | fix: Move the file into the pack as 'note.mkp' and remove the '../' path. | confusing: 

## E284 `mkp.pack-symlink` error at `packages/core/src/pack.ts:78`

message: pack.mkpack: "note-link.mkp" is a symlink; packs may not hold links

block:
```
pack.mkpack (a zip) holding:
--- manifest.mkp ---
pack notes@1 "Small notes for lessons."
  requires core@1
  provides note

--- note.mkp ---
note@1 "A short note with a label."
  in label text "the label"
  text label
  project md = label

--- note.fixture.json ---
{"widget":"note@1","cases":{"basic":{"props":{"label":"Hello"},"summary":"Hello"}}}
--- note-link.mkp ---
(a symbolic link)
```

builder: Only constructible by writing the zip with a symlink entry; the folder route throws a different error in the CLI before reaching the compiler.

- reader 1 (yes): Packs may not hold symbolic links, and note-link.mkp is one. | fix: Replace the link with a real copy of note.mkp in the pack. | confusing: 
- reader 2 (yes): note-link.mkp is a symbolic link, and packs may not contain links. | fix: Remove note-link.mkp from the pack, and put the real file in its place. | confusing: 
- reader 3 (yes): note-link.mkp is a symbolic link, and packs may not hold links. | fix: Replace note-link.mkp with a regular copy of the file it points to. | confusing: The block says '(a symbolic link)' rather than showing the real target, so I cannot tell what the copy should contain.

## E285 `mkp.pack-size` error at `packages/core/src/pack.ts:83`

message: pack.mkpack: "banner.png" is 11.0 MB; files may be at most 10 MB

block:
```
pack.mkpack (a zip) holding:
--- manifest.mkp ---
pack notes@1 "Small notes for lessons."
  requires core@1
  provides note

--- note.mkp ---
note@1 "A short note with a label."
  in label text "the label"
  text label
  project md = label

--- note.fixture.json ---
{"widget":"note@1","cases":{"basic":{"props":{"label":"Hello"},"summary":"Hello"}}}
--- banner.png ---
<11 MB of zero bytes>
```

builder: An 11 MB file of zeros: compresses to nothing so the zip is small but the file is over its limit.

- reader 1 (yes): The file banner.png is 11 MB, and the limit for a file is 10 MB. | fix: Reduce banner.png to under 10 MB. | confusing: 
- reader 2 (yes): banner.png is 11 MB, and a file in a pack may be at most 10 MB. | fix: Remove banner.png or replace it with a file of 10 MB or less. | confusing: 
- reader 3 (yes): The file banner.png is 11 MB, and a single file may be at most 10 MB. | fix: Replace banner.png with an image under 10 MB, or remove it. | confusing: 

## E286 `mkp.pack-manifest` error at `packages/core/src/pack.ts:149`

message: case308/pack has no manifest.mkp

block:
```
note@1 "A short note with a label."
  in label text "the label"
  text label
  project md = label

```

builder: Easy. Position is the pack folder, not a file. The label is the folder path, which for authors looks odd.

- reader 1 (partly): The pack has no `manifest.mkp`, but the block only shows the widget file, and I can't tell the pack's name. | fix: Add a manifest.mkp such as `pack <name>@1 "..."` with `requires core@1` and `provides note`. | confusing: The message says 'case308/pack', which I can't match to anything in the block.
- reader 2 (partly): A pack must have a manifest.mkp file, and this one has none. | fix: Add a manifest.mkp with the line: pack case308@1 "A pack." | confusing: The pack name case308 is given in the message, so I used it.
- reader 3 (yes): The pack has no manifest.mkp file, which every pack needs. | fix: Add a manifest.mkp with 'pack ...' and 'requires core@1'. | confusing: The block shows only the note file, so I am not sure whether the manifest exists elsewhere.

## E287 `mkp.pack-manifest` error at `packages/core/src/pack.ts:155`

message: manifest.mkp must start with "pack name@N" (or "profile name@N")

block:
```
--- manifest.mkp ---
notes@1 "Small notes for lessons."
  requires core@1
  provides note

--- note.mkp ---
note@1 "A short note with a label."
  in label text "the label"
  text label
  project md = label

```

builder: Forgetting the leading word "pack". The message quotes the right form.

- reader 1 (yes): The manifest must start with the keyword `pack` or `profile`, followed by name@N. | fix: pack notes@1 "Small notes for lessons." | confusing: 
- reader 2 (yes): manifest.mkp must begin with the word pack, then name@N. | fix: pack notes@1 "Small notes for lessons." | confusing: 
- reader 3 (yes): manifest.mkp must start with 'pack name@N' or 'profile name@N', and this file starts with 'notes@1'. | fix: pack notes@1 "Small notes for lessons." | confusing: 

## E288 `mkp.pack-requires` warning at `packages/core/src/pack.ts:174`

message: notes: the manifest should say "requires core@1"

block:
```
--- manifest.mkp ---
pack notes@1 "Small notes for lessons."
  provides note

--- note.mkp ---
note@1 "A short note with a label."
  in label text "the label"
  text label
  project md = label

```

builder: A warning only; shown only when checking the pack alone (it is hidden when a document is checked).

- reader 1 (yes): The manifest must say `requires core@1`, and it is missing. | fix:   requires core@1  (under the pack line) | confusing: 
- reader 2 (yes): The manifest does not require core@1, and it should. | fix: pack notes@1 "Small notes for lessons."
  requires core@1
  provides note | confusing: 
- reader 3 (yes): The manifest must declare that it requires core@1, and it does not. | fix: Add the line '  requires core@1' under the 'pack notes@1' line. | confusing: 

## E289 `mkp.pack-size` error at `packages/core/src/pack.ts:184`

message: banner.png is over 10 MB

block:
```
--- manifest.mkp ---
pack notes@1 "Small notes for lessons."
  requires core@1
  provides note

--- note.mkp ---
note@1 "A short note with a label."
  in label text "the label"
  text label
  project md = label

--- banner.png ---
<11 MB of zero bytes>
```

builder: Same limit as the zip case but a different message (no size shown) and wording ("is over 10 MB").

- reader 1 (yes): The image banner.png is 11 MB, and a single image may be at most 10 MB. | fix: Reduce banner.png to under 10 MB. | confusing: 
- reader 2 (yes): banner.png is over the 10 MB limit. | fix: Remove banner.png or replace it with a file of 10 MB or less. | confusing: 
- reader 3 (yes): banner.png is 11 MB, and a single file may be at most 10 MB. | fix: Replace banner.png with a smaller image. | confusing: 

## E290 `mkp.fixture-json` error at `packages/core/src/pack.ts:195`

message: note.fixture.json is not valid JSON: Expected double-quoted property name in JSON at position 63 (line 1 column 64)

block:
```
--- manifest.mkp ---
pack notes@1 "Small notes for lessons."
  requires core@1
  provides note

--- note.mkp ---
note@1 "A short note with a label."
  in label text "the label"
  text label
  project md = label

--- note.fixture.json ---
{"widget":"note@1","cases":{"basic":{"props":{"label":"Hello"},}}}
```

builder: A trailing comma in the JSON. The engine message (from JSON.parse) is passed through and is reasonably specific.

- reader 1 (yes): The fixture file is not valid JSON, because there is a trailing comma after the props object. | fix: {"widget":"note@1","cases":{"basic":{"props":{"label":"Hello"}}}} | confusing: 
- reader 2 (yes): The fixture JSON has a trailing comma after the props object, which JSON does not allow. | fix: {"widget":"note@1","cases":{"basic":{"props":{"label":"Hello"}}}} | confusing: 
- reader 3 (yes): The JSON has a trailing comma after the props object, which is not allowed. | fix: {"widget":"note@1","cases":{"basic":{"props":{"label":"Hello"}}}} | confusing: I removed the trailing comma. The message refers to position 63, which I did not check, so there may be another error.

## E291 `mkp.pack-svg` error at `packages/core/src/pack.ts:205`

message: logo.svg is not a safe SVG (DOCTYPE, entities or no <svg> root)

block:
```
--- manifest.mkp ---
pack notes@1 "Small notes for lessons."
  requires core@1
  provides note

--- note.mkp ---
note@1 "A short note with a label."
  in label text "the label"
  text label
  project md = label

--- logo.svg ---
<!DOCTYPE svg SYSTEM "svg.dtd">
<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle cx="5" cy="5" r="4"/></svg>

```

builder: A hand-saved SVG with a DOCTYPE line, as some editors write. The message lists what is wrong in a parenthesis without saying which of the three.

- reader 1 (yes): The SVG has a DOCTYPE, which is not allowed in a safe SVG. | fix: Remove the `<!DOCTYPE svg SYSTEM "svg.dtd">` line. | confusing: 
- reader 2 (yes): logo.svg has a DOCTYPE, which is not allowed in a safe SVG. | fix: Delete the '<!DOCTYPE svg SYSTEM "svg.dtd">' line. | confusing: 
- reader 3 (yes): logo.svg has a DOCTYPE line, which is not allowed in a safe SVG. | fix: Delete the line '<!DOCTYPE svg SYSTEM "svg.dtd">'. | confusing: 

## E292 `mkp.pack-file-type` error at `packages/core/src/pack.ts:211`

message: notes.txt: packs hold .mkp, .fixture.json and png, jpg, webp, svg or woff2 assets only

block:
```
pack.mkpack (a zip) holding:
--- manifest.mkp ---
pack notes@1 "Small notes for lessons."
  requires core@1
  provides note

--- note.mkp ---
note@1 "A short note with a label."
  in label text "the label"
  text label
  project md = label

--- note.fixture.json ---
{"widget":"note@1","cases":{"basic":{"props":{"label":"Hello"},"summary":"Hello"}}}
--- notes.txt ---
remember to publish

```

builder: Error in a zip, while the same file in a folder is only a warning at another line: the severity differs by container.

- reader 1 (yes): A pack may hold only .mkp, .fixture.json and image or font assets. `notes.txt` is a plain text file. | fix: Delete notes.txt from the pack. | confusing: 
- reader 2 (yes): Packs may hold only .mkp, .fixture.json and certain image or font files. notes.txt is not one. | fix: Remove notes.txt. | confusing: 
- reader 3 (yes): notes.txt is a file type that packs do not allow. | fix: Remove notes.txt from the pack, or move its content into a supported file. | confusing: 

## E293 `mkp.pack-file-type` warning at `packages/core/src/pack.ts:213`

message: notes.txt is not part of a pack and is left out

block:
```
--- manifest.mkp ---
pack notes@1 "Small notes for lessons."
  requires core@1
  provides note

--- note.mkp ---
note@1 "A short note with a label."
  in label text "the label"
  text label
  project md = label

--- notes.txt ---
remember to publish

```

builder: Warning, shown only when the pack is checked alone.

- reader 1 (yes): notes.txt is not part of any pack, so it is dropped from the build. | fix: Delete notes.txt, or move its content into a supported file type if it is needed. | confusing: 
- reader 2 (yes): notes.txt is not a pack file, so it is left out of the pack. | fix: Delete notes.txt, or move it outside the pack. | confusing: I cannot tell whether this is an error or only a warning.
- reader 3 (yes): notes.txt is not part of a pack, so it is left out of the build. | fix: Delete notes.txt, or move it outside the pack if it is not meant to be part of it. | confusing: The message says it is left out, not that it is an error, so the fix may not be needed.

## E294 `mkp.pack-size` error at `packages/core/src/pack.ts:216`

message: case317/pack holds 27.0 MB; a pack may be at most 25 MB

block:
```
--- manifest.mkp ---
pack notes@1 "Small notes for lessons."
  requires core@1
  provides note

--- note.mkp ---
note@1 "A short note with a label."
  in label text "the label"
  text label
  project md = label

--- a.png ---
<9 MB of random bytes>
--- b.png ---
<9 MB of random bytes>
--- c.png ---
<9 MB of random bytes>
```

builder: Three 9 MB images in a folder pack. Position is the manifest.

- reader 1 (yes): The pack holds 27 MB, over the 25 MB limit. | fix: Remove one of the 9 MB images. | confusing: 
- reader 2 (yes): The pack holds 27 MB, and the limit is 25 MB. | fix: Remove one of the three 9 MB PNG files, leaving 18 MB. | confusing: 
- reader 3 (yes): The pack holds 27 MB of files, but a pack may be at most 25 MB. | fix: Remove one of the three 9 MB PNG files, or make them smaller. | confusing: 

## E295 `mkp.pack-size` error at `packages/core/src/pack.ts:91`

message: pack.mkpack unpacks to 27.0 MB; a pack may be at most 25 MB

block:
```
pack.mkpack (a zip) holding:
--- manifest.mkp ---
pack notes@1 "Small notes for lessons."
  requires core@1
  provides note

--- note.mkp ---
note@1 "A short note with a label."
  in label text "the label"
  text label
  project md = label

--- note.fixture.json ---
{"widget":"note@1","cases":{"basic":{"props":{"label":"Hello"},"summary":"Hello"}}}
--- a.png ---
<9 MB of zero bytes>
--- b.png ---
<9 MB of zero bytes>
--- c.png ---
<9 MB of zero bytes>
```

builder: Three 9 MB files: each is allowed, together they exceed 25 MB. The archive is tiny, so the author may be puzzled by "unpacks to".

- reader 1 (yes): The pack unpacks to 27.0 MB, above the 25 MB limit. The three 9 MB images add up to 27 MB. | fix: Remove one of the 9 MB images, leaving about 18 MB. | confusing: 
- reader 2 (yes): Unpacked, the pack is 27 MB, over the 25 MB limit. | fix: Remove one of the three 9 MB PNG files. | confusing: 
- reader 3 (yes): The pack unpacks to 27 MB, which is over the 25 MB limit, even though the zip is smaller. | fix: Remove one of the 9 MB png files. | confusing: 

# Not triggered from a document or pack (still improve the wording)

- `packages/core/src/pack.ts:180` `mkp.pack-path`: "${path}" is not a safe relative path (Unreachable from the CLI: the folder reader converts backslashes to slashes and skips dot-names before the compiler sees the path, and a zip is checked earlier by the stricter zip reader (pack.ts:73). Only a host that passes a file map straight to compile() could hit it.)
- `packages/core/src/fixtures.ts:65` `mkp.fixture-shape`: <the shape problem, e.g. "cases is an object of named cases"> (The error is added to the compiler diagnostics after "mkp check" has already printed them, so a fixture file of the wrong shape (e.g. cases as a list) prints nothing but "has no valid fixture case". Not visible from check.sh output.)
- `packages/core/src/runtime/runtime.ts:444` `mkp.not-state`: ${name} is not state in ${caller label} (Runtime-only: raised while the page is running (Runtime), and no mkp command that check.sh can reach (check compiles documents and fixture cases but never starts a Runtime or plays steps) prints it. A ref input (name={ref}) naming something that is not a state cell in the caller; the compiler is expected to catch this earlier, so this is a late guard.)
- `packages/core/src/runtime/runtime.ts:449` `mkp.missing-input`: ${def.name} was not given ${input} (Runtime-only: raised while the page is running (Runtime), and no mkp command that check.sh can reach (check compiles documents and fixture cases but never starts a Runtime or plays steps) prints it. An input with no default left unset, evaluated on demand; compile-time input checks (mkp.input-missing style) fire first in documents.)
- `packages/core/src/runtime/runtime.ts:478` `mkp.host-input`: host input ${name}: ${err}; the default is used (Runtime-only: raised while the page is running (Runtime), and no mkp command that check.sh can reach (check compiles documents and fixture cases but never starts a Runtime or plays steps) prints it. A host supplies a value of the wrong type for a host input via runtime options (hosts map); not something a document or pack can set.)
- `packages/core/src/runtime/runtime.ts:771` `mkp.recursion`: ${def.name} goes deeper than 12 levels; the deepest level shows … (Runtime-only: raised while the page is running (Runtime), and no mkp command that check.sh can reach (check compiles documents and fixture cases but never starts a Runtime or plays steps) prints it. A recursive widget rendering beyond 12 levels while running; check does not render. Compile-time depth limit (mkp.limit, build.ts:380) covers non-recursive chains only.)
- `packages/core/src/runtime/runtime.ts:840` `mkp.arrow-missing`: arrow ${from} → ${to}: no element with id ${missing}; nothing is drawn (Runtime-only: raised while the page is running (Runtime), and no mkp command that check.sh can reach (check compiles documents and fixture cases but never starts a Runtime or plays steps) prints it. An arrow between element ids resolved at render time; ids are values (can be computed), so the compiler does not check them.)
- `packages/core/src/runtime/runtime.ts:865` `mkp.arrow-missing`: arrow ${from} → ${to}: no element with id ${via} to pass through; the path goes on without it (Runtime-only: raised while the page is running (Runtime), and no mkp command that check.sh can reach (check compiles documents and fixture cases but never starts a Runtime or plays steps) prints it. Same runtime resolution, for a via waypoint.)
- `packages/core/src/runtime/runtime.ts:1554` `mkp.action-target`: ${reveal|hide} ${id}: no such element; nothing happens (Runtime-only: raised while the page is running (Runtime), and no mkp command that check.sh can reach (check compiles documents and fixture cases but never starts a Runtime or plays steps) prints it. A reveal or hide action whose computed id matches no element when pressed.)
- `packages/core/src/runtime/runtime.ts:1589` `mkp.signal-rate`: signal ${name} dropped: more than 30 a second (Runtime-only: raised while the page is running (Runtime), and no mkp command that check.sh can reach (check compiles documents and fixture cases but never starts a Runtime or plays steps) prints it. More than 30 send actions per second; needs a running page and fast repeated input.)
- `packages/core/src/runtime/runtime.ts:1593` `mkp.signal-size`: signal ${name} dropped: its payload is over 16 KB (Runtime-only: raised while the page is running (Runtime), and no mkp command that check.sh can reach (check compiles documents and fixture cases but never starts a Runtime or plays steps) prints it. A send action whose payload serialises beyond 16 KB at runtime.)

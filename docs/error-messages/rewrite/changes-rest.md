# rest: message changes

Files: `packages/core/src/{pack,profile,build,fixtures}.ts`, `check/program.ts`, `runtime/runtime.ts`,
and `packages/cli/src/main.ts` (the fixture-shape bug only). Codes and severities are unchanged.
"After" texts are what the private CLI printed on the brief's blocks and the builder's trials (sizes are
now in MiB, the unit the 25 MB / 10 MB limits are defined in, so a 9,000,000-byte file shows as 8.6 MB).

## Profiles (profile.ts)

| id | code | before | after |
|---|---|---|---|
| E246 | mkp.profile | there is no profile "lesson" among the packs given | the profile lesson is not among the packs given to this build; found no profile among them. Give the build the pack whose manifest starts with "profile lesson@1" (--pack <its folder>), or check the document without --profile |
| (E246) | mkp.profile | (same text, when the name is a plain pack) | notes is a pack, not a profile, so a document can't be checked against it; found pack notes@1 at the top of its manifest. Give the build the profile you mean (a pack whose manifest starts with "profile name@N"), or … |
| E247 | mkp.front-type | front matter level must be int | front matter level must be a whole number (the lesson profile declares it int); found advanced. Write a whole number, e.g. level: 2 |
| E248 | mkp.front-unknown | the lesson profile has no front-matter field "author" | the lesson profile has no front-matter field author; found author: Sam. Remove the line, or declare the field in the profile's manifest (front author text). Its fields are title |
| E249 | mkp.role | "warmup" is not a section role of lesson (intro, example) | the section role warmup is not one of the lesson profile's roles (intro, example); found {role=warmup}. Write one of them, e.g. {role=intro}, or add warmup to the profile's roles line |
| (E249) | mkp.role | (same, for a profile with no roles) | the lesson profile declares no section roles; found {role=warmup}. Remove {role=warmup}, or add a line "roles warmup" to the profile's manifest |
| E250 | mkp.attr-type | weight must be choice(core\|extra) | the block attribute weight takes one of core, extra; found {weight=optional}. Write {weight=core} or {weight=extra} |
| E251 | mkp.rule.depth | sections go two deep at most | sections go two deep at most (profile rule: depth headings 2); found ### Detail, a level-3 heading. Use at most 2 # (## Detail), or make it bold text (\*\*Detail\*\*) |
| E252 | mkp.rule.first | a lesson starts with a heading | a lesson starts with a heading (profile rule: first body heading); found a paragraph first. Move the heading # Limits (line 6) above it, or add a heading at the top |
| E253 | mkp.rule.required | cite at least one source | cite at least one source (profile rule: required front.sources); found sources: [] (an empty list). Give at least one item, e.g. sources: ["Some text"] |
| E254 | mkp.rule.one-of | scope is topic or chapter | scope is topic or chapter (profile rule: one-of front.scope topic chapter); found unit. Write scope: topic or scope: chapter |
| E255 | mkp.rule.pattern | course ids are kebab-case | course ids are kebab-case (profile rule: pattern front.course ^[a-z-]+$); found Calculus 1, which does not match. Change it so it matches the pattern ^[a-z-]+$ (when the value's lower-case, hyphenated form matches, it is offered: "Calculus One" gives e.g. course: calculus-one) |
| E256 | mkp.rule.max-length | keep titles short | keep titles short (profile rule: max-length front.title 10); found Limits of functions, 19 characters long. Shorten it to 10 characters or fewer |
| E257 | mkp.rule.count | one to three examples | one to three examples (profile rule: count roles.example 1..3); found 0. Add 1 more section with {role=example}: a heading, then {role=example} on the line under it |
| E258 | mkp.rule.count | exactly two examples | exactly two examples (profile rule: count roles.example 2); found 1. Add 1 more section with {role=example}: a heading, then {role=example} on the line under it |
| E259 | mkp.rule.required | required front.sources | front matter sources is required (profile rule: required front.sources); found no sources in the front matter. Add it to the front matter, e.g. sources: ["Some text"] |
| E260 | mkp.profile | rule pattern front.course: "[a-z" is not a valid pattern | the pattern rule on front.course in the lesson profile is not a valid regular expression; found "[a-z" (unterminated character class). Correct the pattern on that rule line, e.g. rule pattern front.course "^[a-z-]+$" |
| E261 | mkp.profile | unknown rule "length"; rules are required, one-of, pattern, max-length, count, depth and first | the lesson profile has a rule named length, which MKP does not know; found rule length front.title. Write rule max-length front.title … instead, or use one of required, one-of, pattern, max-length, count, depth, first |

Every rule message keeps the profile author's own text first (or a generated demand when the rule has
none, as in E259), then names the rule, what was found and the fix. Count rules too high say
`Remove {role=x} from N sections`; blocks.X and list paths get their own wording.

## Packs, definitions and the lock (check/program.ts, build.ts)

| id | code | before | after |
|---|---|---|---|
| E262 | mkp.pack-duplicate | pack notes@1 is given twice | pack notes@1 is given to this build twice; found it from p1 both times. Give it once (remove one --pack), or, if they are different packs, give one a new name or version (pack notes@2) |
| E263 | mkp.duplicate-definition | note@1 is defined twice in pack notes | note@1 is defined twice in pack notes; found a second definition here, the first is at extra.mkp:1. Remove one of them, or give this one another name or a new version (note@2) |
| E268 | mkp.duplicate-type | type size is declared twice in pack notes | type size is defined twice in pack notes; found a second type size here, the first is at note.mkp:5. Remove one of them, or rename this one |
| E269 | mkp.duplicate-definition | interface scored@1 is declared twice in pack notes | interface scored@1 is defined twice in pack notes; found a second interface scored@1 here, the first is at note.mkp:5. Remove one of them, or give this one a new version (scored@2) |
| E264 | mkp.op-untyped | op + must type every parameter; dispatch uses them (6.22) | op + must give every parameter a type, since the types of the arguments decide which op + is used; found b with no type. Write each as name: type, e.g. op +(a: vec2, b: vec2): vec2 = … |
| E265 | mkp.untyped | fn double must type every parameter and its result: fn double(x: num): num = … | fn double must give a type to every parameter and to its result (after the closing bracket); found x with no type, and no result type. Write it as fn double(x: num): num = … (the example uses the fn's own parameter names and any types already given) |
| E266 | mkp.pack-reserved | the pack name "core" is reserved for the base set | the pack name core is taken by MKP's own base set of widgets; found pack core@1 in its manifest. Rename the pack, e.g. pack mywidgets@1, and keep its requires core@1 line |
| E267 | mkp.pack-depends | notes depends on chips@1, which this build was not given (pass it with --pack) | pack notes depends on chips@1, which is not among the packs given to this build; found depends chips@1. Give the build the chips pack too (--pack <its folder>), or remove chips@1 from the depends line if notes does not use it |
| (new case) | mkp.pack-depends | (a depends entry without @N got E267's text) | pack notes must name each pack it depends on as name@N; found depends chips. Write the version it needs, e.g. depends chips@1 |
| E270 | mkp.pack-depends | notes depends on chips@2; this build has chips@1 | pack notes depends on chips@2, but the chips pack given to this build is chips@1; found depends chips@2. Give the build chips@2 or later, or write depends chips@1 if notes works with it |
| E271 | mkp.capability | notes requires audio@1, which is not a known capability (core@1, gfx@1) | pack notes requires audio@1, which is not a capability MKP knows (a feature the page's provider must have: core@1, or gfx@1 for pixels and 3D); found requires audio@1. Remove audio@1 from the requires line (for core@2 / gfx: Write gfx@1) |
| E272 | mkp.pack-provides | notes provides "callout", but no definition, type, fn or constant has that name | pack notes provides callout, but nothing in the pack has that name (no widget, part, interface, type, fn, constant or token set); found provides callout. Remove callout from the provides line, or add a definition named callout to the pack, e.g. callout@1 "What it shows." |
| (E272) | mkp.pack-provides | notes provides "note,", but … | pack notes provides "note,", but nothing in the pack has that name (…); found provides "note,". Separate the names with spaces, not commas: provides note size (a near miss gets: Correct it to X) |
| E273 | mkp.reserved | column is a base widget name and is reserved | column is the name of a base widget, so a pack's widget may not be called column; found column@1 in pack extras. Rename the widget and its provides entry, e.g. mycolumn@1 and provides mycolumn |
| E274 | mkp.reserved | slot is a built-in node name (each, switch, …) and is reserved | slot is a word MKP itself uses in views (each, switch, case, else, slot, fill, controls, arrow), so a widget may not be called slot; found slot@1 in pack extras. Rename the widget and its provides entry, e.g. myslot@1 and provides myslot |
| E275 | mkp.capability-fallback | note requires audio@1; providers without it show its fallback | note requires audio@1, which is not a capability MKP knows (core@1, gfx@1), so the page shows the block's summary: text in its place; found requires audio@1. Remove that line if note works without it, or give every use a summary that says what it shows (for gfx@1 missing from the target: "which the target provider lacks (it has core@1)") |
| E276 | mkp.limit | level1 nests definitions 13 deep; at most 12 | definitions may be nested at most 12 deep, one using the next; found level1 nesting 13 deep (level1 → level2 → … → level13). Shorten the chain: write level13's view straight into level12 instead of using level13 there |
| E277 | mkp.name-clash | note is provided by notes and remarks; uses must be qualified as pack:note | note is provided by two packs, notes and remarks, so a bare note could mean either; found provides note in each manifest. Wherever note is used, write its pack before it, e.g. notes:note (a block opens with \`\`\`notes:note), or rename one of them |
| E278 | mkp.version-changed | notes:note@1 changed since it was locked; a behaviour change is a new version (@N+1), or build with --relock while the pack is unpublished | notes:note@1 has changed since mkp.lock recorded it; found a definition that differs from the locked one, and a locked version must keep its behaviour. Undo the change, or give it a new version (note@2); while the pack is unpublished, add unpublished to its manifest or rebuild with --relock |
| E279 | mkp.pack-changed | notes@1 changed since the lock was written; a published version must not change | pack notes@1 has changed since mkp.lock was written; found files that differ from the locked ones (one added, removed or edited), and a published version must not change. Undo the change, publish it as notes@2, or rebuild with --relock if it is unpublished |

## Pack files (pack.ts)

| id | code | before | after |
|---|---|---|---|
| E280 | mkp.pack-size | pack.mkpack is 28.5 MB; a pack may be at most 25 MB | pack.mkpack is larger than a pack may be (at most 25 MB); found 27.2 MB. Remove or shrink its largest files (images, fonts) and zip the pack again |
| E281 | mkp.pack-zip | pack.mkpack is not a zip file | pack.mkpack is not a zip file, and a .mkpack must be one; found plain text starting "pack notes@1". Zip the pack folder's files (manifest.mkp at the top), e.g. with mkp pack <folder>, or give the folder itself instead of the .mkpack (found is "an empty file" or "no zip directory at its end" for other files) |
| E282 | mkp.pack-zip | pack.mkpack has a damaged central directory | pack.mkpack is a damaged zip: its list of files (the central directory) breaks off; found bytes that are not a file entry at entry 3 of 3. Make the .mkpack again from the pack folder (mkp pack <folder>) |
| E283 | mkp.pack-path | pack.mkpack: "../note.mkp" is an absolute path or uses ".."; packs hold relative paths only | pack.mkpack: every file in a pack must sit inside it, at a relative path; found "../note.mkp", a path that goes up out of the pack with "..". Move the file into the pack folder (e.g. as note.mkp) and zip the pack again (absolute, drive-letter, backslash and "." paths each get their own reason) |
| E284 | mkp.pack-symlink | pack.mkpack: "note-link.mkp" is a symlink; packs may not hold links | pack.mkpack: a pack may hold only real files, not links; found "note-link.mkp", a symbolic link. Replace it with a copy of the file it points to, and zip the pack again |
| E285 | mkp.pack-size | pack.mkpack: "banner.png" is 11.0 MB; files may be at most 10 MB | pack.mkpack: a file in a pack may be at most 10 MB; found "banner.png" at 10.5 MB unpacked. Shrink it (e.g. compress the image or lower its resolution) or remove it |
| E295 | mkp.pack-size | pack.mkpack unpacks to 27.0 MB; a pack may be at most 25 MB | pack.mkpack unpacks to more than a pack may hold (at most 25 MB in all, however well it compresses); found 25.7 MB unpacked, mostly a.png (8.6 MB), b.png (8.6 MB), c.png (8.6 MB). Remove or shrink some of those files |
| E286 | mkp.pack-manifest | case308/pack has no manifest.mkp | case308/pack has no manifest.mkp, the file that names a pack and what it provides; found only note.mkp. Add manifest.mkp at the top of the pack, e.g. pack notes@1 "What the pack holds." and, under it, requires core@1 |
| (E286) | mkp.pack-manifest | (same, when the manifest is one folder down, e.g. a zip of the folder itself) | r has no manifest.mkp at its top, the file that names a pack; found one in a folder inside it, at inner/manifest.mkp. Give r/inner as the pack instead, or move manifest.mkp to the top of r (a zip: Zip the contents of the inner folder, not the folder itself …) |
| E287 | mkp.pack-manifest | manifest.mkp must start with "pack name@N" (or "profile name@N") | manifest.mkp must start with a line "pack name@N" (or "profile name@N" for a profile); found notes@1 "Small notes for lessons.". Add the word pack before it: pack notes@1 "Small notes for lessons." |
| E288 | mkp.pack-requires | notes: the manifest should say "requires core@1" | the manifest of pack notes should say requires core@1, since every pack builds on the base set; found no requires line. Add requires core@1 on the line under pack notes@1 |
| — (pack.ts:180) | mkp.pack-path | "${path}" is not a safe relative path | every file in a pack must sit inside it, at a relative path; found "<path>", <reason>. Use a path inside the pack with / between folders, e.g. <fixed path> |
| E289 | mkp.pack-size | banner.png is over 10 MB | a file in a pack may be at most 10 MB; found banner.png at 10.5 MB. Shrink it (e.g. compress the image or lower its resolution) or remove it from the pack |
| E290 | mkp.fixture-json | note.fixture.json is not valid JSON: Expected double-quoted property name in JSON at position 63 (line 1 column 64) | note.fixture.json is not valid JSON; found a comma just before \`}\` at line 1 column 64 (expected double-quoted property name). Remove that comma: JSON allows none after the last item (single quotes and a file that ends too soon get their own fix) |
| E291 | mkp.pack-svg | logo.svg is not a safe SVG (DOCTYPE, entities or no <svg> root) | logo.svg can't be used: a pack takes only plain SVGs, with an <svg> root and no DOCTYPE or entities; found a <!DOCTYPE …> line. Remove the <!DOCTYPE …> line; an SVG needs none (entity, wrong root and unreadable XML each get their own found/fix) |
| E292 | mkp.pack-file-type | notes.txt: packs hold .mkp, .fixture.json and png, jpg, webp, svg or woff2 assets only | notes.txt can't go in a pack, which holds only .mkp, .mkp.md and .fixture.json files and png, jpg, webp, svg or woff2 assets; found a .txt file. Remove it from the zip |
| E293 | mkp.pack-file-type | notes.txt is not part of a pack and is left out | notes.txt is left out of the pack, which holds only .mkp, .mkp.md and .fixture.json files and png, jpg, webp, svg or woff2 assets (and a README, LICENSE or CHANGELOG); found a .txt file. Move it out of the pack folder, or leave it if it is only for you |
| E294 | mkp.pack-size | case317/pack holds 27.0 MB; a pack may be at most 25 MB | case317/pack holds more than a pack may (at most 25 MB in all); found 25.7 MB, mostly a.png (8.6 MB), b.png (8.6 MB), c.png (8.6 MB). Remove or shrink some of those files |

## Fixture files (fixtures.ts, mkp.fixture-shape)

`fixtureShape(json, file?)` takes the file name now (optional, so the exported API still works).

| before | after (examples) |
|---|---|
| a fixture file is an object with "widget" and "cases" | note.fixture.json must hold one JSON object with "widget" and "cases"; found a list ([]). Write it as {"widget": "note@1", "cases": {"basic": {"props": {…}, "summary": "…"}}} |
| "widget" names the definition as name@N | "widget" in note.fixture.json must name the definition the cases are for, as name@N; found the text "note". Add its version: "widget": "note@1" |
| "cases" is an object of named cases | "cases" in note.fixture.json must be an object of named cases; found a list (["basic"]). Write e.g. "cases": {"basic": {"props": {…}, "summary": "…"}} |
| case a is not an object | case a in note.fixture.json must be an object; found the value 5. Write e.g. "a": {"props": {…}, "summary": "…"} |
| case a has an unknown key "prop" | case a in note.fixture.json has a key a case does not take; found "prop". Rename it to "props", or remove it; a case takes props, summary, play, expect, hosts |
| case a: props is an object | props of case a in note.fixture.json must be an object of input values; found a list ([]). Write e.g. "props": {"label": "Hello"} |
| case a: play is a list of steps | play of case a in note.fixture.json must be a list of steps; found an object ({}). Write e.g. "play": [{"press": "next"}] |
| case a: a play step is press, set, command (with args), wait or open | a play step of case a in note.fixture.json must be press, set, command (with args), wait or open; found the key "pres". Rename it to "press" |

## Runtime (runtime.ts; not reachable from `mkp check`)

| code | before | after |
|---|---|---|
| mkp.not-state | ${name} is not state in ${caller} | the input ${inp} of ${def} is bound to ${name} by reference, so ${name} must be a state or var of ${caller}; found no state or var ${name} there. Declare it there, or bind the input to a state that exists |
| mkp.missing-input | ${def} was not given ${inp} | ${def} needs its input ${inp}, which has no default; found no ${inp} where ${def} is used. Give it there (${inp}=…), or give the input a default in ${def} (in ${inp} <type> = …) |
| mkp.host-input | host input ${name}: ${err}; the default is used | the host's value for host input ${name} of ${def} has the wrong type, so its default is used; found <value> (expected …). Send a value of type <type> |
| mkp.recursion | ${def} goes deeper than 12 levels; the deepest level shows … | widgets may be nested at most 12 levels deep while the page runs; found ${def} at level ${depth}, so it shows "…" there instead. Stop the recursion sooner, e.g. with if= on a level input or by passing a shorter list each time |
| mkp.arrow-missing | arrow a → b: no element with id x; nothing is drawn | the arrow from a to b is not drawn, since each end must be an element's id; found no element with id x in ${widget} or the widgets inside it. Give that element id=x, or correct from= (or to=) |
| mkp.arrow-missing | arrow a → b: no element with id v to pass through; the path goes on without it | the arrow from a to b goes via v, so the path skips that point; found no element with id v in ${widget} or the widgets inside it. Give that element id=v, or remove it from via= |
| mkp.action-target | reveal x: no such element; nothing happens | reveal did nothing, since it names an element by id; found no element with id x in ${widget} (the id was worked out when it ran). Give an element id=x, or correct the expression that makes the id |
| mkp.signal-rate | signal s dropped: more than 30 a second | signal s was dropped: a page may send at most 30 signals a second; found more than 30 in the last second. Send it less often, e.g. on a press rather than on every change |
| mkp.signal-size | signal s dropped: its payload is over 16 KB | signal s was dropped: a signal's payload may be at most 16 KB; found 18.2 KB. Send less, e.g. an id or a count instead of whole records |
| mkp.cycle | ${name} depends on itself | the value ${name} depends on itself, through values that lead back to it, so it has no value; found a loop while working it out. Break the loop: make one value in it a state or an input instead of reading the others |
| mkp.unbound | "${name}" has no value in ${def} | ${name} has no value in ${def}: it is not an input, state, var or value there; found ${name} used in ${def}. Declare it in ${def}, or correct the name |
| mkp.nodes | more than 5,000 rendered nodes in ${widget} | a widget may draw at most 5,000 elements; found more than that in ${widget}. Draw fewer: show a long list a page at a time, or cut an each short |
| mkp.each | each over N items; at most M | an each may go over at most M items; found N in ${widget}. Give it a shorter list or range, e.g. one page of it at a time |
| mkp.duplicate-key | each produced the key "k" twice; keys must be unique | each item of an each needs its own key; found the key k twice in ${widget}. Make key= read something unique to each item, e.g. its index or an id field |
| mkp.duplicate-id | the id "x" appears twice in ${widget} | ids must be unique within a widget; found id x on two elements in ${widget}. Rename one, or inside an each compute it from the item, e.g. id=(…) with the item's index in it |
| mkp.duplicate-id | the arrow id "x" is found in N nested instances | an arrow end must name one element; found id x in N widgets nested in ${widget}, so it is unclear which is meant. Give the element you mean an id of its own, and use that |
| (Error, host API) | the bundle has no document definition | this bundle has no document definition, so there is nothing to draw; found only N pack definitions. Build the bundle from a document (mkp build doc.mkp.md --pack …), not from a pack alone |
| (Error, host API) | no widget block ${block} | there is no widget block ${block} in this document; found the blocks 0, 1. Pass a block's index (0 for the first) or its #anchor |
| (Error, fixture play set) | no state "k" in any widget block | no widget block has a state named k; found the states a, b. Set one of those, or write part/name for a state of a part inside the block |
| (Error, host API) | ${widget} declares no command "c" | ${widget} has no command c; found the commands a, b. Send one of those |
| (Error, host API) | command c: ${err} | the arguments of command c of ${widget} have the wrong shape (${err}). Send them as <type> |
| (Error, host API) | ${widget} declares no host input "h" | ${widget} has no host input h; found the host inputs a, b. Set one of those |
| (Error, host API) | host input h: ${err} | the value for host input h of ${widget} has the wrong type (${err}). Send a value of type <type> |
| (Error, host API) | host input h is over 64 KB | a host input's value may be at most 64 KB; found 70.3 KB for host input h of ${widget}. Send a smaller value, e.g. fewer items |

## Position fixes

- `mkp.profile` (E260 invalid pattern, E261 unknown rule): now at the rule's line in the profile's
  `manifest.mkp` (was document line 1).
- `mkp.pack-depends`, `mkp.capability`, `mkp.pack-provides` (E267, E270, E271, E272): now at the
  pack's real folder (was `notes/manifest.mkp`, the pack *name*, which is not a path) and at the
  `depends` / `requires` / `provides` line and column of the offending entry (was line 1). This
  needed the manifest text: `PackInfo.manifestText` (new optional field, set by `loadPack`).
- `mkp.pack-duplicate` (E262): at the second pack's manifest (had no position).
- `mkp.reserved` (E273, E274): at the widget's definition line (had no position).
- `mkp.name-clash` (E277): at the definition in the last pack that provides the name (had none).
- `mkp.version-changed` (E278): at the changed definition (had none).
- `mkp.pack-changed` (E279): at the pack's manifest (had none).
- `mkp.pack-reserved` (E266): at `<pack>/manifest.mkp` (was the pack folder itself).
- `mkp.pack-manifest` (E286): at `<pack>/manifest.mkp`, the file to create, or at the nested
  manifest when one is found a folder down (was the folder). E287: at the first written line of the
  manifest (was always line 1).
- `mkp.fixture-json` (E290): at the line and column the JSON parser stopped (was 1:1).
- `mkp.pack-svg` (E291): at the DOCTYPE / ENTITY / root line.
- `mkp.pack-symlink`, per-file `mkp.pack-size` in a zip (E284, E285): at `pack.mkpack/<entry>`
  (was `pack.mkpack`), like the zip `mkp.pack-file-type` already was.
- `mkp.rule.count` (E258 and others): when some of the counted sections exist, at the last one (too
  few) or the first extra one (too many), not document line 1.
- `mkp.fixture-shape`: at `<pack folder>/<file>` (was `<pack name>/<file>`, not a path).

## The fixture-shape bug

`mkp check --pack …` (no documents) printed `c.diags` and only then called `fixtureCases(c)`, which is
where `mkp.fixture-shape` is added, so it was never shown. `check()` in `packages/cli/src/main.ts` now
calls `fixtureCases(c)` before `report(c.diags)` (two lines swapped). The builder's trial case318
(`"cases": ["basic"]`) now prints the fixture-shape error at `case318/pack/note.fixture.json:1:1`.

Not changed, worth knowing: `mkp cases` has the same order (`report` at main.ts:339 runs before
`fixtureCases` at :345), so a malformed fixture is still silent there; `mkp check doc.mkp.md --pack …`
never reads fixtures, so it does not show the error either (by design, it reports pack errors only).

## Left alone

- `checkValue` messages ("expected a number, found …") are reused inside the host-input and command
  messages above; they were left as they are, since other callers may depend on their form.
- `mkp.pack-requires`, `mkp.name-clash`, `mkp.pack-changed`, `mkp.capability-fallback` and the folder
  `mkp.pack-file-type` are warnings, and `checkDocs` hides warnings when a document is checked: that
  is behaviour, not wording, and lives in main.ts outside the bug fix.
- Severity differences the builder noted (stray file: error in a zip, warning in a folder) are kept.
- `mkp.role` points at the heading line rather than the `{role=…}` line under it: the IR does not keep
  the attribute's line, and the fix belongs in check/doc.ts.
- The folder reader in main.ts uses `statSync`, so its symlink check never fires (a link is followed):
  outside the bug fix, not changed.
- Tests that match the old texts (to be updated): `arrow.test.ts` "leaves out a missing one with a
  warning" (/nope to pass through/), `language.test.ts` "takes commands, host inputs…" (/declares no
  command/) and "refuses a widget named like a built-in node" (/built-in node name/).

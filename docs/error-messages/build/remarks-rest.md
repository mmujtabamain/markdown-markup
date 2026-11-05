# Remarks: profile, pack, build and runtime sites

61 sites: 50 triggered, 11 not (9 runtime-only, 2 unreachable from the CLI).

## Hard to trigger
- Runtime warnings (runtime.ts, 9 sites): `mkp check` never starts a Runtime or plays fixture steps, so nothing at runtime can be seen with check.sh. Arrow, action-target and recursion mistakes (a typo in an id) are therefore invisible to the checking loop an author runs.
- `mkp.fixture-shape` (fixtures.ts:65) is raised after `check` has already printed its diagnostics, so it is swallowed; a malformed fixture only shows "has no valid fixture case". Looks like a real bug.
- `mkp.pack-path` in loadPack (pack.ts:180) cannot be reached from the CLI (the folder reader normalises backslashes and skips dot-names; zips are rejected earlier).
- Size limits (25 MB, 10 MB) need generated large files; zip-only ones (symlink, damaged directory, `..` entries) need a hand-built archive.
- Lock diagnostics need a lock file with digests; I trimmed it to the one pack and definition. The lock contents are opaque, so a reader cannot tell what changed.

## Patterns in the messages
- Pack-level diagnostics are hidden whenever a document is given (checkDocs reports errors only for the pack stage), so warnings (`pack-requires`, `name-clash`, `pack-changed`, file-type, `capability-fallback`) show only when checking the pack alone. An author checking a document never sees them.
- Position is often missing or coarse: `pack-duplicate`, `reserved`, `name-clash`, `version-changed` print no position; manifest errors point at line 1 of the manifest rather than the `provides`/`depends` line; profile pattern/rule errors point at document line 1 (the manifest holds the broken rule).
- Profile rule messages are only the author's own text from the rule (or "required front.sources" when none is given): they do not say which value was found. `front-type` and `attr-type` state the expectation but not the offending value.
- Inconsistent wording for the same idea: "defined twice" (widget) vs "declared twice" (interface, type); "is over 10 MB" (folder) vs "is 11.0 MB; files may be at most 10 MB" (zip); the same size limit is an error in a zip but only a warning for stray files in a folder.
- Good: `mkp.role` lists valid roles, `mkp.untyped` shows an example signature, `mkp.reserved` (built-in) lists the names, `mkp.capability` lists known capabilities, `mkp.profile` unknown-rule lists rules.
- Misleading or opaque: `mkp.op-untyped` cites "(6.22)", a spec section an author has no access to; `pack-path` says "absolute path or uses .." for either; `pack-svg` lists three causes without saying which; `pack-depends` suggests `--pack`, which is CLI-only.

## Language points that got in the way
- Manifest lists are space separated: `provides note, size` is read as the name "note," and gave a confusing `pack-provides` error alongside the intended one.
- Mixed severity: the same condition is an error or warning depending on container or on whether a document was passed.
- Rule/attr/role syntax in profiles is only documented in tests, not the authoring guide.

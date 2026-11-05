---
teaches: "a pack: a manifest that says what it provides, a definition with @N, a fixture case for each, and a document that uses a version"
gaps: [14, 15, 87, 88]
---
# Two runs

A pack is a folder of definitions with a `manifest.mkp`; `mkp check --pack examples/29-a-pack/pack`
checks every definition against its fixture cases, and `mkp build` writes a lock beside the
document that pins the version used.

```distance@1
km: 21.0975
label: A half marathon
summary: A half marathon's distance.
```

```distance
km: 10
label: A long run
summary: A ten-kilometre run.
```

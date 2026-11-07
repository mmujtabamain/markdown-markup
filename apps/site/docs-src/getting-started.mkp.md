---
description: What MKP is, how to get a release, and a first document checked and built.
---
# Getting started

MKP (Markdown Markup) is Markdown with widgets. A document, `name.mkp.md`, is ordinary Markdown
with **widget blocks** where the reader should do more than read: drag a slider, step through an
idea, check an answer. Every widget is composed from a small **base set** (layout, text, a few
controls, a canvas), so a document carries no HTML, JavaScript or CSS, and the compiler checks it
like code.

Readers without MKP still get clean Markdown: every widget says what it means as text.

> [!TIP]
> These pages are themselves written in MKP and compiled once, when they were written, to the
> static pages you are reading. Nothing here runs MKP in your browser.

## Get a release

Every release has the same three files, from
[GitHub releases](https://github.com/mmujtabamain/markdown-markup/releases):

| File | What it is |
| --- | --- |
| `mkp-cli.mjs` | The command line, in one file, for Node 20.19 or later. |
| `mkp-web-<version>.zip` | The files a web app imports. They import each other, so keep them in one folder. |
| `SHA256SUMS` | Checksums of the two. |

```sh
v=0.2.0; base=https://github.com/mmujtabamain/markdown-markup/releases/download/v$v
curl -LO $base/mkp-cli.mjs
curl -LO $base/mkp-web-$v.zip && mkdir -p vendor/mkp && unzip -j mkp-web-$v.zip -d vendor/mkp
```

The web zip holds:

- `mkp.js`, the core: it compiles, checks and runs documents and writes their Markdown. Its types are `mkp.d.ts`.
- `maths-engine.js`, which `mkp.js` loads the first time a document shows maths.
- `mkp-react.js`, which draws documents in a React app.
- `mkp-dom.js`, which draws documents in any other page or framework.

## A first document

Save this as `counter.mkp.md`. The `mkp` fence defines a widget, and the
`counter` fence below it places one, with its inputs in YAML:

````markdown
# A counter

```mkp
counter "A number the reader steps up or down."
  in start int = 0 "where it begins"
  var n int = start
  row gap=m align=center
    press label="one less"
      icon name=minus
      @click set n=(n - 1)
    text "\val{n}" font=mono size=large weight=bold
    press label="one more"
      icon name=plus
      @click set n=(n + 1)
  project md = "Count: " + format(n, 0)
```

```counter
start: 3
summary: A counter that starts at 3.
```
````

Check it, then build it:

```sh
node mkp-cli.mjs check counter.mkp.md
node mkp-cli.mjs build counter.mkp.md --target html --out out   # out/counter.html: open it
node mkp-cli.mjs build counter.mkp.md --target md --out out      # out/counter.md: "Count: 3"
```

`out/counter.html` is one offline page that draws the counter. `out/counter.md` is what a reader
without MKP gets, from the widget's `project md` line.

[Open it in the examples](../examples/#e=ex:05-counter) to change it and watch it redraw.

## Where next

- [Writing documents](writing.mkp.md): Markdown, widget blocks, shared state and containers.
- [Your own widgets](widgets.mkp.md): definitions, controls, expressions and events.
- [In your app](in-your-app.mkp.md): drawing documents in React, any other framework, or as pages.

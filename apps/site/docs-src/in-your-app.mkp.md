---
description: Drawing MKP documents in a React app, in any other framework or none with mkp-dom.js, or as static pages and Markdown with no app at all.
---
# In your app

There are three ways to show a document, from most to least interactive:

| Where | Use | What the reader gets |
| --- | --- | --- |
| A React app | `mkp-react.js` | The document, drawn live, in MKP's look or your components. |
| Any other page or framework | `mkp-dom.js` | The same, mounted into an element. |
| No app | `mkp build --target html`, `md` or `html-md` | One offline page, or plain Markdown. |

Each starts from the release's web files in one folder, say `vendor/mkp/`
([Getting started](getting-started.mkp.md#get-a-release)).

## Compile

A document is compiled into a bundle, either in the app or ahead of time:

```ts
import { compile } from './vendor/mkp/mkp.js';

const c = compile({ packs: [] });
const bundle = c.document(source, 'lesson.mkp.md');
if (!bundle) console.error(c.diags.errors);
```

Ahead of time, `mkp build lesson.mkp.md --target ir` writes `lesson.ir.json`, the same bundle as a
file. An app that only shows documents can import that and leave the compiler out.

## React

```tsx
import { MkpDocument } from './vendor/mkp/mkp-react.js';

export function Lesson({ bundle }) {
  return <MkpDocument bundle={bundle} theme="auto" options={{ onSignal: (e) => console.log(e.name, e.payload) }} />;
}
```

`MkpDocument` writes its own styles; there is nothing to import. Give it `tokens` to set your
colours, spaces and corners by name, `components` to draw the base set with your own design system,
and `theme` (`light`, `dark` or `auto`). It works in Next.js and every other React framework.

## Any other framework, or none

`mkp-dom.js` draws the same document into an element. It brings its own React, so the page needs
none:

```ts
import { mount } from './vendor/mkp/mkp-dom.js';

const view = mount(document.getElementById('lesson'), bundle, {
  theme: 'auto',
  tokens: { space: { m: { value: 12 } } },
  onSignal: (e) => console.log(e.name, e.payload),
});
view.update({ theme: 'dark' });   // the reader's place stays
view.setBundle(next);             // another document starts afresh
view.unmount();
```

`view.ready` resolves once the document is drawn. The maths engine loads first only when the
document has maths its build has not already typeset. The
[recipes](recipes.mkp.md) wrap this in a component for Vue, Svelte, Solid, Angular and Astro.

To show the text and widgets before any script runs, build the document's first paint too
(`mkp build lesson.mkp.md --target ir,fragment --out out`), put `lesson.fragment.html` in the
element on the server, and mount the same build's bundle with `hydrate: true`. `mount()` takes the
HTML over in place: nothing is swapped and nothing moves.

## Signals: the document talks to the app

A widget can tell the host app what the reader did: an answer checked, a step reached. It declares
a `signal` and `send`s it; the app hears it in `onSignal`:

```ts
onSignal: (e) => {
  // e.name: 'answered', e.payload: { correct: true, value: 'Oslo' }, e.block: which block sent it
  if (e.name === 'answered') saveProgress(e.payload);
}
```

[Check an answer](../examples/#e=ex:14-check-an-answer) in the examples sends one; its Signals
panel shows them as they arrive.

## No app: pages and Markdown

```sh
node mkp-cli.mjs build lesson.mkp.md --target html --out site      # site/lesson.html
node mkp-cli.mjs build lesson.mkp.md --target md --out site        # site/lesson.md
node mkp-cli.mjs build lesson.mkp.md --target html-md --out site   # site/lesson.md.html
```

- `html` is one offline page that draws the document, follows the reader's light or dark setting,
  and holds its Markdown for readers with scripts off.
- `md` is the Markdown a reader without MKP gets: every widget as its text. `--no-answers` leaves
  answers out.
- `html-md` is that Markdown drawn as HTML, maths as pictures, with no script at all.

These docs are built the `html-md` way: written in MKP, compiled once, served as static pages.

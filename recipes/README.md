# Recipes

MKP in Vue, Svelte, Solid, Angular, Astro and plain JS: one small app each, built on a release's web
files (`mkp-web-<version>.zip`). Each draws [`lesson.mkp.md`](lesson.mkp.md) with `mkp-dom.js`,
shows the document's signals in the app, changes theme without losing the reader's place, and
unmounts cleanly. The part to copy is each app's `MkpView`:

| Framework | The component | How the document is compiled |
| --- | --- | --- |
| Vue 3 | [`vue/src/MkpView.vue`](vue/src/MkpView.vue) | in the browser |
| Svelte 5 | [`svelte/src/MkpView.svelte`](svelte/src/MkpView.svelte) | in the browser |
| Solid | [`solid/src/MkpView.tsx`](solid/src/MkpView.tsx) | in the browser |
| Angular | [`angular/src/mkp-view.ts`](angular/src/mkp-view.ts) | in the browser |
| Astro | [`astro/src/components/MkpView.astro`](astro/src/components/MkpView.astro) | when the site is built |
| none | [`plain/main.js`](plain/main.js) | in the browser, no build step |

React apps use `mkp-react.js`'s `<MkpDocument>` directly (see `docs/integration-guide.md`).

```sh
npm ci
npm run setup        # web files built from this checkout; or: npm run setup -- --zip mkp-web-0.1.2.zip
npm run build
npx playwright install chromium && npm test
```

Node 22.23 or later (Angular 22 and Astro 7 need it). `setup` puts the web files in each recipe's
`src/vendor/mkp/` and the lesson beside them; neither is committed.

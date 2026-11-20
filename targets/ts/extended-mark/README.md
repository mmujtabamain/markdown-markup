# extended-mark

Extended Mark's compiler under the language's own name. It is the [xtmd](https://www.npmjs.com/package/xtmd) package
and nothing more: the `xtmd` command, the same JS API and the same Vite plugin. Install either; one
is enough.

```sh
npm i -g extended-mark     # or: npm i -g xtmd
xtmd check poll.xtmd
```

```js
import { build, check } from "extended-mark";   // the same as "xtmd"
import xtmd from "extended-mark/vite";           // the same as "xtmd/vite"
```

Both give the `xtmd` command, so install one of them globally, not both.

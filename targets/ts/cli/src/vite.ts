// A Vite plugin: `import page from "./sprint.xt.md"` gives the page's IR, compiled by xtmd
// when the app is built or served.

import type { Plugin } from "vite";
import { build, XtmdError, type Options } from "./index.js";

export default function xtmd(options: Options = {}): Plugin {
  return {
    name: "xtmd",
    enforce: "pre",
    async load(id) {
      const file = id.split("?")[0];
      if (!file.endsWith(".xt.md")) return null;
      this.addWatchFile(file);
      for (const p of options.packs ?? []) this.addWatchFile(p);
      try {
        const ir = await build(file, options);
        return { code: `export default ${JSON.stringify(ir)};`, map: null };
      } catch (e) {
        this.error(e instanceof XtmdError ? e.message : String(e));
      }
    },
  };
}

export { xtmd };

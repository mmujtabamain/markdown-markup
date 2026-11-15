// A Vite plugin: `import page from "./sprint.mkp.md"` gives the page's IR, compiled by mkp
// when the app is built or served.

import type { Plugin } from "vite";
import { build, MkpError, type Options } from "./index.js";

export default function mkp(options: Options = {}): Plugin {
  return {
    name: "mkp",
    enforce: "pre",
    async load(id) {
      const file = id.split("?")[0];
      if (!file.endsWith(".mkp.md")) return null;
      this.addWatchFile(file);
      for (const p of options.packs ?? []) this.addWatchFile(p);
      try {
        const ir = await build(file, options);
        return { code: `export default ${JSON.stringify(ir)};`, map: null };
      } catch (e) {
        this.error(e instanceof MkpError ? e.message : String(e));
      }
    },
  };
}

export { mkp };

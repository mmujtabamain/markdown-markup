import { defineConfig } from "vite";
import xtmd from "xtmd/vite";

export default defineConfig({
  // `import shop from "../../pages/shop.xt.md"` gives the page's IR, compiled by xtmd at build time
  plugins: [xtmd()],
  esbuild: { jsx: "automatic" },
  // @extended-mark/react is linked from the repo, with its own React for its tests: use this app's one
  resolve: { dedupe: ["react", "react-dom"] },
});

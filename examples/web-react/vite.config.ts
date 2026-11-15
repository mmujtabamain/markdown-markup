import { defineConfig } from "vite";
import mkp from "@mkp/cli/vite";

export default defineConfig({
  // `import shop from "../../pages/shop.mkp.md"` gives the page's IR, compiled by mkp at build time
  plugins: [mkp()],
  esbuild: { jsx: "automatic" },
  // @mkp/react is linked from the repo, with its own React for its tests: use this app's one
  resolve: { dedupe: ["react", "react-dom"] },
});

import { defineConfig } from "vite";
import xtmd from "xtmd/vite";

// `import shop from "../../pages/shop.xt.md"` gives the page's IR, compiled by xtmd at build time
export default defineConfig({ plugins: [xtmd()] });

import { defineConfig } from "vite";
import mkp from "@mkp/cli/vite";

// `import shop from "../../pages/shop.mkp.md"` gives the page's IR, compiled by mkp at build time
export default defineConfig({ plugins: [mkp()] });

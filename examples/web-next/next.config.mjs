import { fileURLToPath } from "node:url";
import { withXtmd } from "@extended-mark/next/config";

// the page (examples/pages) and the linked @extended-mark packages are outside this app: build from the repo
const root = fileURLToPath(new URL("../..", import.meta.url));

/** `import shop from "../../pages/shop.xtmd"` gives the page's IR, compiled by xtmd at build time. */
export default withXtmd({ turbopack: { root }, outputFileTracingRoot: root });

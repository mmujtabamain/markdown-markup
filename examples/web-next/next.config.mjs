import { fileURLToPath } from "node:url";
import { withMkp } from "@mkp/next/config";

// the page (examples/pages) and the linked @mkp packages are outside this app: build from the repo
const root = fileURLToPath(new URL("../..", import.meta.url));

/** `import shop from "../../pages/shop.mkp.md"` gives the page's IR, compiled by mkp at build time. */
export default withMkp({ turbopack: { root }, outputFileTracingRoot: root });

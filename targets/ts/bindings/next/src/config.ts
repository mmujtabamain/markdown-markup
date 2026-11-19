// `import page from "./sprint.xt.md"` in a Next.js app: the page's IR, compiled by the xtmd binary
// (through xtmd) when the app is built or served. One loader, given to both of Next's bundlers:
// Turbopack (`next dev` and `next build` by default since Next 16) and webpack (`--webpack`).

import { fileURLToPath } from "node:url";
import type { Options } from "xtmd";

/** The parts of a Next.js config this touches; the rest is passed through. */
export interface NextConfigLike {
  turbopack?: { rules?: Record<string, unknown>; [key: string]: unknown };
  webpack?: ((config: WebpackConfigLike, context: unknown) => WebpackConfigLike) | null;
  [key: string]: unknown;
}

interface WebpackConfigLike {
  module?: { rules?: unknown[] };
  [key: string]: unknown;
}

/** The loader's path, for a config that wires it in itself. */
export const loader = fileURLToPath(new URL("./loader.cjs", import.meta.url));

/** The Next.js config, with `.xt.md` files compiled to IR by xtmd. `packs` and `config` are xtmd's. */
export function withXtmd<C extends NextConfigLike>(config: C = {} as C, options: Options = {}): C {
  const use = { loader, options: { ...options } };
  const webpack = config.webpack;
  return {
    ...config,
    turbopack: {
      ...config.turbopack,
      rules: {
        ...config.turbopack?.rules,
        "*.xt.md": { loaders: [use], as: "*.js" },
      },
    },
    webpack(wp: WebpackConfigLike, context: unknown) {
      wp.module ??= {};
      wp.module.rules ??= [];
      wp.module.rules.push({ test: /\.xt\.md$/, use: [use], type: "javascript/auto" });
      return typeof webpack === "function" ? webpack(wp, context) : wp;
    },
  };
}

export type { Options } from "xtmd";

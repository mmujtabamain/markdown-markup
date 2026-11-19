// The loader webpack and Turbopack run for each `.xt.md` file: its IR, as a module. CommonJS, so
// both load it; xtmd is ESM, so it is imported when first needed.

interface LoaderContext {
  resourcePath: string;
  async(): (error: Error | null, content?: string) => void;
  getOptions?(): { packs?: string[]; config?: string };
  addDependency?(file: string): void;
}

function xtmdLoader(this: LoaderContext): void {
  const done = this.async();
  const options = this.getOptions?.() ?? {};
  for (const p of options.packs ?? []) this.addDependency?.(p);
  if (options.config) this.addDependency?.(options.config);
  import("xtmd")
    .then(({ build }) => build(this.resourcePath, options))
    .then(
      (ir) => done(null, `export default ${JSON.stringify(ir)};`),
      (e: unknown) => done(e instanceof Error ? e : new Error(String(e))),
    );
}

export = xtmdLoader;

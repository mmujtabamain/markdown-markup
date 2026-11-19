// `import page from "./x.xt.md"`: the page's IR, compiled by xtmd/vite.
declare module "*.xt.md" {
  const page: import("@extended-mark/runtime").ir.File;
  export default page;
}

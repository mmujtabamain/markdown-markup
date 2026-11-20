// `import page from "./x.xtmd"`: the page's IR, compiled by xtmd/vite.
declare module "*.xtmd" {
  const page: import("@extended-mark/runtime").ir.File;
  export default page;
}

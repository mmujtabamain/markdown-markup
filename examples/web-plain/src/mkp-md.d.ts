// `import page from "./x.mkp.md"`: the page's IR, compiled by @mkp/cli/vite.
declare module "*.mkp.md" {
  const page: import("@mkp/runtime").ir.File;
  export default page;
}

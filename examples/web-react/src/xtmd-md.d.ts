// `import page from "./x.xtmd"`: the page's IR, compiled by xtmd/vite.
declare module "*.xtmd" {
  const page: import("@extended-mark/react").ir.File;
  export default page;
}

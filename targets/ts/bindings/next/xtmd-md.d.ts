// `import page from "./sprint.xt.md"`: the page's IR. Reference it from a .d.ts in the app:
// /// <reference types="@extended-mark/next/xtmd-md" />
declare module "*.xt.md" {
  const page: import("./dist/index.js").ir.File;
  export default page;
}

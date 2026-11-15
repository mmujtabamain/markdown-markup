// `import page from "./sprint.mkp.md"`: the page's IR. Reference it from a .d.ts in the app:
// /// <reference types="@mkp/next/mkp-md" />
declare module "*.mkp.md" {
  const page: import("./dist/index.js").ir.File;
  export default page;
}

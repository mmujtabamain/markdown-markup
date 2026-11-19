import page from "./sprint.xt.md";

// the page's IR, compiled by xtmd when the app was built: a runtime mounts all of it
globalThis.xtmdPage = page;
document.body.dataset.module = page.ir.module;

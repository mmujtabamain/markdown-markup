import page from "./sprint.mkp.md";

// the page's IR, compiled by mkp when the app was built: a runtime mounts all of it
globalThis.mkpPage = page;
document.body.dataset.module = page.ir.module;

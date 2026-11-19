// For server components: a page's Markdown as HTML, with the values it starts with, where only its
// content is wanted (a feed, a description, an email). <XtmdDoc> itself renders the page on the
// server. No DOM, and no React: it runs anywhere Node does.

export { blocksHtml, escapeHtml, pageHtml } from "@extended-mark/embed/html";

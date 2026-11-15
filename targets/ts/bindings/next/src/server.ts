// For server components: a page's Markdown as HTML, with the values it starts with, to put in
// <MkpPage html={…}> so search engines and readers without JavaScript get the page's content.
// No DOM, and no React: it runs anywhere Node does.

export { blocksHtml, escapeHtml, pageHtml } from "@mkp/embed/html";

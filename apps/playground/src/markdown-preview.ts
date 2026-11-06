// The Markdown preview: @mkp/page's Markdown-as-HTML, with raw HTML let through DOMPurify, since a
// shared link can carry any document.

import DOMPurify from 'dompurify';
import { markdownToHtml as draw, type PreviewOptions } from '@mkp/page';

export type { PreviewOptions };

export function markdownToHtml(md: string, opts: PreviewOptions = {}): string {
  return draw(md, { ...opts, sanitize: (html) => DOMPurify.sanitize(html, { ADD_ATTR: ['target'], FORBID_TAGS: ['style', 'form'], FORBID_ATTR: ['onerror', 'onload'] }) });
}

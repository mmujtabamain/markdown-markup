// docs-plugin.ts's modules: the docs, compiled when the site is built
declare module 'virtual:mkp-docs' {
  import type { IRBundle } from '@mkp/core';
  export interface DocEntry {
    slug: string;
    label: string;
    title: string;
    headings: { depth: number; text: string; id: string }[];
  }
  export const docs: DocEntry[];
  export const load: Record<string, () => Promise<{ default: IRBundle }>>;
}

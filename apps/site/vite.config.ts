import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

const root = fileURLToPath(new URL('../../', import.meta.url));
const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * What's new, built with the site (scripts/whats-new.mjs writes .generated/): every release's text in
 * the page's HTML before its script runs, and the Atom feed beside it.
 */
function whatsNew(): Plugin {
  const gen = (f: string) => at(`.generated/${f}`);
  return {
    name: 'mkp-whats-new',
    transformIndexHtml(html, ctx) {
      if (!ctx.filename.replace(/\\/g, '/').endsWith('whats-new/index.html') || !existsSync(gen('whats-new.html'))) return html;
      return html.replace('<div id="root"></div>', `<div id="root">${readFileSync(gen('whats-new.html'), 'utf8')}</div>`);
    },
    generateBundle() {
      if (existsSync(gen('feed.xml'))) this.emitFile({ type: 'asset', fileName: 'whats-new/feed.xml', source: readFileSync(gen('feed.xml'), 'utf8') });
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.endsWith('/whats-new/feed.xml') || !existsSync(gen('feed.xml'))) return next();
        res.setHeader('Content-Type', 'application/atom+xml');
        res.end(readFileSync(gen('feed.xml')));
      });
    },
  };
}

export default defineConfig({
  // GitHub Pages serves the build from /markdown-markup/
  base: process.env.PLAYGROUND_BASE ?? '/',
  plugins: [react(), tailwindcss(), whatsNew()],
  resolve: {
    alias: {
      '@mkp/core': at('../../packages/core/src/index.ts'),
      '@mkp/react': at('../../packages/react/src/index.tsx'),
      '@mkp/shadcn': at('../../packages/shadcn/src/index.tsx'),
      '@mkp/page': at('../../packages/page/src/index.ts'),
      '@': at('src'),
    },
  },
  define: { __PG_COMMIT__: JSON.stringify((process.env.GITHUB_SHA ?? '').slice(0, 7)) },
  server: { fs: { allow: [root] }, port: 5181, strictPort: true },
  // the DevBench preview serves the built playground with `vite preview` behind its own host name
  preview: { port: 5182, strictPort: true, allowedHosts: ['.preview.devbench.sh'] },
  // four app pages: the landing page at /, the examples (the playground) at examples/, what's new
  // at whats-new/ (each release drawn live), and migrations/ (moving from one release to the next). The docs are static pages in public/docs/, written
  // in MKP and compiled once (pnpm site:docs)
  build: { chunkSizeWarningLimit: 6000, target: 'es2022', rollupOptions: { input: { index: at('index.html'), examples: at('examples/index.html'), 'whats-new': at('whats-new/index.html'), migrations: at('migrations/index.html') } } },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
});

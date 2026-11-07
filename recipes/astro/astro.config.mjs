import { defineConfig } from 'astro/config';

// MKP's maths engine is one large file, loaded only when a document shows maths
export default defineConfig({ vite: { build: { chunkSizeWarningLimit: 3000 } } });

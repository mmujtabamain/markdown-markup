import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

// MKP's maths engine is one large file, loaded only when a document shows maths
export default defineConfig({ plugins: [solid()], build: { chunkSizeWarningLimit: 3000 } });

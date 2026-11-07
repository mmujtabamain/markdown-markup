import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

// MKP's maths engine is one large file, loaded only when a document shows maths
export default defineConfig({ plugins: [svelte()], build: { chunkSizeWarningLimit: 3000 } });

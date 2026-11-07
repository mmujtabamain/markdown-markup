import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

// MKP's maths engine is one large file, loaded only when a document shows maths
export default defineConfig({ plugins: [vue()], build: { chunkSizeWarningLimit: 3000 } });

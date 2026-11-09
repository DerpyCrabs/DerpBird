import { defineConfig } from 'vite';
import { effectweb } from '@effectweb/compiler/vite';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  plugins: [effectweb(), tailwindcss()],
  base: './',
  // Stylus dispatches AST visitors using constructor.name.
  worker: { format: 'iife', rollupOptions: { output: { codeSplitting: false, keepNames: true } } },
  build: { target: 'es2023', sourcemap: true },
});

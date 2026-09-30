import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { strictPort: true },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      output: {
        // The Markdown renderer drags in the highlight.js language set; keeping
        // it in its own chunk keeps the main bundle small.
        // Vite 8 only accepts the function form here (the object shorthand
        // was removed with the Rollup upgrade).
        manualChunks(id) {
          if (/node_modules\/(react-markdown|remark-gfm|rehype-highlight|highlight\.js)\//.test(id)) {
            return "markdown";
          }
          return undefined;
        }
      }
    }
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./vitest.setup.ts"
  }
});

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
    setupFiles: "./vitest.setup.ts",
    // 只收 src 下的单测。Playwright 的 e2e/*.spec.ts 也叫 .spec，
    // 不显式收窄的话 vitest 会去跑它们——而它们需要真实浏览器与
    // 一个跑着的预览服务器，在 jsdom 里只会以一堆看不懂的错误失败。
    include: ["src/**/*.test.{ts,tsx}"]
  }
});

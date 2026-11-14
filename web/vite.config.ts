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
    // 只收 *.test.*。Playwright 的 e2e/*.spec.ts 也叫 .spec，不显式收窄的话
    // vitest 会去跑它们——而它们需要真实浏览器与一个跑着的预览服务器，在
    // jsdom 里只会以一堆看不懂的错误失败。
    //
    // e2e/ 下只收纯函数单测（`round-gg-expectations.test.ts`）：它只算夹具
    // 期望值、不碰浏览器，放在 e2e 旁边才不会与它服务的 spec 分家。
    include: ["src/**/*.test.{ts,tsx}", "e2e/**/*.test.{ts,tsx}"]
  }
});
